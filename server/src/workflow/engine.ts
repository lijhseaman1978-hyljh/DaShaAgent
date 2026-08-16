// workflow/engine.ts
// V3 Phase 3 - Step 4 §一/§十/§十二：Workflow Engine —— 架构图最顶层的总装件。
//
//                          AGENT OS
//                              │
//                      Workflow Engine        ← 本文件
//                              │
//                ┌─────────────┼─────────────┐
//            Task Queue    Scheduler    Event Bus
//                └─────────────┼─────────────┘
//                              │
//                      Autonomous Worker
//                              │
//                          Agent Loop
//
// 说明：计划书 §二 的目录清单只列了 core/queue/scheduler/trigger/worker 五组零件，
//       但 §一 架构图把 "Workflow Engine" 画在最顶层、§十 又要求「启动后 Worker/Scheduler/Event 一起进入待命」。
//       本文件即那个总装层：把五组零件接成一台常驻机器，对外只暴露 start / submit / runWorkflow / status。

import { eventBus } from '../kernel/eventBus';
import { logger, metrics } from '../observability';
import { LifecycleTracker, WorkflowRun, type WorkflowRunSnapshot } from './core/state';
import { createTask, taskSummary, type AgentTask, type TaskSource } from './core/task';
import { topoLayers, validateWorkflow, type Workflow, type WorkflowStep } from './core/workflow';
import { TaskQueue } from './queue/taskQueue';
import { WorkflowScheduler } from './scheduler/scheduler';
import { CronTrigger, type CronCallback } from './trigger/cronTrigger';
import { EventTrigger } from './trigger/eventTrigger';
import { AgentWorker, type RunnableAgent } from './worker/agentWorker';

export interface WorkflowEngineOptions {
  /** Worker 轮询间隔 */
  pollMs?: number;
  /** Worker 并发数 */
  concurrency?: number;
  /** Scheduler tick 间隔 */
  tickMs?: number;
  /** 队列容量 */
  capacity?: number;
  /** 桥接进 EventTrigger 的内核事件主题 */
  bridgeTopics?: string[];
  /** 是否 unref 内部定时器（默认 false：引擎在跑就 hold 住进程，符合「常驻」语义） */
  unref?: boolean;
}

interface Waiter {
  resolve: (task: AgentTask) => void;
  reject: (err: Error) => void;
}

export class WorkflowEngine {
  readonly queue: TaskQueue;
  readonly scheduler: WorkflowScheduler;
  readonly trigger: EventTrigger;
  readonly worker: AgentWorker;
  readonly lifecycle = new LifecycleTracker();

  private readonly workflows = new Map<string, Workflow>();
  private readonly runs = new Map<string, WorkflowRun>();
  private readonly waiters = new Map<string, Waiter>();
  private started = false;
  private wired = false;

  constructor(agent: RunnableAgent, opts: WorkflowEngineOptions = {}) {
    this.lifecycle.set('boot');
    this.queue = new TaskQueue({ capacity: opts.capacity ?? 0 });
    this.scheduler = new WorkflowScheduler({ tickMs: opts.tickMs ?? 1000, unref: opts.unref });
    this.trigger = new EventTrigger();
    this.worker = new AgentWorker(this.queue, agent, {
      pollMs: opts.pollMs ?? 1000,
      concurrency: opts.concurrency ?? 1,
      name: 'autonomous-worker',
      unref: opts.unref,
    });
    this.trigger.bridge(opts.bridgeTopics ?? ['agent.paused', 'agent.resumed', 'agent.killed']);
    this.wireTaskSettlement();
    this.lifecycle.set('initialize');
  }

  // ── §十：系统启动后 Worker / Scheduler / Event 全部待命 ──

  start(): void {
    if (this.started) return;
    this.started = true;
    this.worker.start();
    this.scheduler.start();
    this.lifecycle.set('listen');
    logger.info('WorkflowEngine', 'Engine started', {
      workflows: this.workflows.size,
      jobs: this.scheduler.list().length,
    });
    eventBus.emit('workflow.engine.started', { workflows: this.workflows.size });
  }

  async stop(): Promise<void> {
    if (!this.started) return;
    this.started = false;
    this.scheduler.stop();
    await this.worker.stop();
    this.lifecycle.set('stopped');
    eventBus.emit('workflow.engine.stopped', {});
  }

  isRunning(): boolean { return this.started; }

  // ── 任务投递 ──

  /** 直接投递一个自然语言目标。 */
  submit(goal: string, opts: { priority?: number; source?: TaskSource; maxAttempts?: number; meta?: Record<string, any> } = {}): AgentTask {
    const task = createTask(goal, opts);
    this.queue.push(task);
    return task;
  }

  /** 投递并等待其终结，返回任务对象（含 result / error）。 */
  async submitAndWait(goal: string, opts: { priority?: number; source?: TaskSource; timeoutMs?: number } = {}): Promise<AgentTask> {
    const task = this.submit(goal, opts);
    return this.waitFor(task.id, opts.timeoutMs);
  }

  /** 等待某个任务终结。 */
  waitFor(taskId: string, timeoutMs = 120_000): Promise<AgentTask> {
    const existing = this.queue.find(taskId);
    if (existing && (existing.status === 'completed' || existing.status === 'failed' || existing.status === 'cancelled')) {
      return Promise.resolve(existing);
    }
    return new Promise<AgentTask>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters.delete(taskId);
        reject(new Error(`等待任务 ${taskId} 超时（${timeoutMs}ms）`));
      }, timeoutMs);
      timer.unref?.();
      this.waiters.set(taskId, {
        resolve: (t) => { clearTimeout(timer); resolve(t); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      });
    });
  }

  // ── §三：Workflow 注册与执行 ──

  registerWorkflow(wf: Workflow): { ok: boolean; errors: string[] } {
    const errors = validateWorkflow(wf);
    if (errors.length) return { ok: false, errors };
    this.workflows.set(wf.id, wf);
    eventBus.emit('workflow.registered', { id: wf.id, name: wf.name, steps: wf.steps.length });
    return { ok: true, errors: [] };
  }

  getWorkflow(id: string): Workflow | undefined { return this.workflows.get(id); }
  listWorkflows(): Workflow[] { return [...this.workflows.values()]; }

  /**
   * 执行一条 Workflow：按拓扑分层，逐层投递 TaskQueue、逐层等待。
   * 层内的步骤会同时进队列，由 Worker 按并发额度消费。
   */
  async runWorkflow(workflowId: string, opts: { timeoutMs?: number } = {}): Promise<WorkflowRunSnapshot> {
    const wf = this.workflows.get(workflowId);
    if (!wf) throw new Error(`未注册的 Workflow: ${workflowId}`);

    const run = new WorkflowRun(wf);
    this.runs.set(run.runId, run);
    run.start();
    this.lifecycle.set('plan');
    metrics.increment('workflow.run.started');
    logger.info('WorkflowEngine', 'Workflow started', { workflow: wf.name, runId: run.runId, steps: wf.steps.length });
    eventBus.emit('workflow.run.started', { runId: run.runId, workflowId: wf.id, name: wf.name });

    this.lifecycle.set('execute');
    try {
      for (const layer of topoLayers(wf)) {
        const waits = layer.map((step) => this.dispatchStep(run, wf, step, opts.timeoutMs));
        const settled = await Promise.all(waits);

        // 硬失败（非 optional）→ 整条流程终止
        const hardFail = settled.find((s) => s.failed && !s.optional);
        if (hardFail) {
          run.finish('failed', `步骤「${hardFail.step.name}」失败：${hardFail.error}`);
          metrics.increment('workflow.run.failed');
          eventBus.emit('workflow.run.failed', { runId: run.runId, step: hardFail.step.id, error: hardFail.error });
          this.lifecycle.set('listen');
          return run.snapshot();
        }
      }
      run.finish('completed');
      metrics.increment('workflow.run.completed');
      logger.info('WorkflowEngine', 'Workflow completed', { workflow: wf.name, runId: run.runId });
      eventBus.emit('workflow.run.completed', { runId: run.runId, workflowId: wf.id });
    } catch (e: any) {
      run.finish('failed', String(e?.message ?? e));
      metrics.increment('workflow.run.failed');
      logger.error('WorkflowEngine', 'Workflow crashed', { runId: run.runId, error: run.error });
    } finally {
      this.lifecycle.set(this.worker.isIdle() ? 'sleep' : 'listen');
    }
    return run.snapshot();
  }

  private async dispatchStep(
    run: WorkflowRun,
    wf: Workflow,
    step: WorkflowStep,
    timeoutMs?: number,
  ): Promise<{ step: WorkflowStep; failed: boolean; optional: boolean; error?: string }> {
    const task = createTask(step.action, {
      priority: step.priority ?? wf.priority ?? 0,
      source: 'workflow',
      workflowId: wf.id,
      stepId: step.id,
      maxAttempts: (step.retries ?? 0) + 1,
      meta: { runId: run.runId, stepName: step.name },
    });
    run.beginStep(step, task);
    this.queue.push(task);

    try {
      const settled = await this.waitFor(task.id, timeoutMs);
      if (settled.status === 'completed') {
        run.finishStep(step.id, settled.result);
        return { step, failed: false, optional: !!step.optional };
      }
      const err = settled.error ?? `任务状态 ${settled.status}`;
      run.failStep(step.id, err, !!step.optional);
      return { step, failed: true, optional: !!step.optional, error: err };
    } catch (e: any) {
      const err = String(e?.message ?? e);
      run.failStep(step.id, err, !!step.optional);
      return { step, failed: true, optional: !!step.optional, error: err };
    }
  }

  getRun(runId: string): WorkflowRunSnapshot | undefined { return this.runs.get(runId)?.snapshot(); }
  listRuns(limit = 20): WorkflowRunSnapshot[] {
    return [...this.runs.values()].sort((a, b) => b.createdAt - a.createdAt).slice(0, limit).map((r) => r.snapshot());
  }

  // ── §七：Cron 触发 ──

  /**
   * 注册定时触发。goalOrCallback 可以是：
   *   - 字符串目标 → 到点自动 submit 一个任务
   *   - 'workflow:<id>' → 到点自动跑一条 Workflow
   *   - 回调函数 → 完全自定义
   */
  cron(spec: string | number, goalOrCallback: string | CronCallback, opts: { name?: string; priority?: number } = {}): CronTrigger {
    const cb: CronCallback =
      typeof goalOrCallback === 'function'
        ? goalOrCallback
        : async () => {
            if (goalOrCallback.startsWith('workflow:')) {
              const id = goalOrCallback.slice('workflow:'.length);
              return this.runWorkflow(id);
            }
            return this.submit(goalOrCallback, { priority: opts.priority ?? 0, source: 'cron' });
          };
    const trig = new CronTrigger(spec, cb, { name: opts.name });
    this.scheduler.add(trig);
    return trig;
  }

  // ── §八：事件触发 ──

  /**
   * 注册事件触发。handlerOrGoal 可以是：
   *   - 字符串（支持 {{key}} 占位，从事件 data 取值）→ 自动 submit
   *   - 'workflow:<id>' → 自动跑 Workflow
   *   - 回调函数 → 完全自定义
   */
  on(event: string, handlerOrGoal: string | ((data: any, event: string) => any)): () => void {
    if (typeof handlerOrGoal === 'function') return this.trigger.on(event, handlerOrGoal);

    return this.trigger.on(event, async (data) => {
      if (handlerOrGoal.startsWith('workflow:')) {
        return this.runWorkflow(handlerOrGoal.slice('workflow:'.length));
      }
      const goal = handlerOrGoal.replace(/\{\{(\w+)\}\}/g, (_, k) => String(data?.[k] ?? ''));
      return this.submit(goal, { source: 'event', meta: { event, data } });
    });
  }

  /** 对外投递一个事件（等价于计划书 §八 的 eventBus.emit("file.upload", {...})） */
  emit(event: string, data: any = {}): number {
    return this.trigger.emit(event, data);
  }

  // ── 状态汇总（Dashboard / API） ──

  status() {
    return {
      running: this.started,
      lifecycle: this.lifecycle.get(),
      queue: this.queue.stats(),
      worker: this.worker.stats(),
      scheduler: { running: this.scheduler.isRunning(), jobs: this.scheduler.list() },
      triggers: { events: this.trigger.stats(), recent: this.trigger.history(10) },
      workflows: this.listWorkflows().map((w) => ({ id: w.id, name: w.name, steps: w.steps.length, description: w.description })),
      runs: this.listRuns(5),
    };
  }

  tasks(limit = 50) {
    return {
      pending: this.queue.pending().map(taskSummary),
      running: this.queue.running().map(taskSummary),
      history: this.queue.history(limit).map(taskSummary),
    };
  }

  /** 把 TaskQueue 的终结事件转成 waiter 的 resolve —— Workflow 层能感知步骤何时完成。 */
  private wireTaskSettlement(): void {
    if (this.wired) return;
    this.wired = true;
    const settle = (payload: any) => {
      const id = payload?.id;
      if (!id) return;
      const w = this.waiters.get(id);
      if (!w) return;
      this.waiters.delete(id);
      const task = this.queue.find(id);
      if (task) w.resolve(task);
      else w.reject(new Error(`任务 ${id} 已终结但无法回查`));
    };
    eventBus.on('workflow.task.completed', settle);
    eventBus.on('workflow.task.failed', settle);
    eventBus.on('workflow.task.cancelled', settle);
  }
}
