// workflow/worker/agentWorker.ts
// V3 Phase 3 - Step 4 §九：Agent Worker —— 后台执行核心（常驻消费任务队列）。
// 计划书原文：start() 里 setInterval 每秒 queue.pop()，有任务就 await agent.run(task.goal)。
//
// 并排扩展（原文实现的四个坑）：
//   1. 原文 setInterval + async 回调会重入（上一个任务没跑完，下一秒又 pop 一个）→ 用自驱动 loop + concurrency 闸门。
//   2. 原文没有 stop() → 补停机（含等待在飞任务收敛）。
//   3. 原文不回写任务状态 → 接 TaskQueue.complete/fail，串起 pending→running→completed/failed。
//   4. 原文无视 Human Override → 接 kernel/control 的 agentControl，pause 时不再拾取新任务，kill 时收敛退出。

import { agentControl } from '../../kernel/control';
import { eventBus } from '../../kernel/eventBus';
import { logger, metrics, tracer } from '../../observability';
import type { AgentTask } from '../core/task';
import { canRetry, taskSummary } from '../core/task';
import type { TaskQueue } from '../queue/taskQueue';

/** Worker 依赖的最小 Agent 契约：只要有 run(goal) 即可（AgentLoop / MultiAgentRuntime / 任意封装都满足）。 */
export interface RunnableAgent {
  run(goal: string): Promise<any>;
}

export interface AgentWorkerOptions {
  /** 轮询间隔（ms），计划书原文 1000 */
  pollMs?: number;
  /** 并发执行上限 */
  concurrency?: number;
  /** Worker 名称，便于多 Worker 场景区分 */
  name?: string;
  /** 是否尊重 Human Override（默认 true） */
  respectControl?: boolean;
  /**
   * 是否 unref 轮询定时器（默认 false）。
   * 默认 ref 住事件循环 —— 这是「常驻 Agent」的语义：引擎在跑，进程就不该退出。
   * 早期版本默认 unref，结果 await runWorkflow() 期间 Node 判定无活跃句柄直接退出，流程永远等不到结果。
   */
  unref?: boolean;
}

export class AgentWorker {
  /** 计划书原文属性名 */
  running = false;

  readonly name: string;
  private readonly queue: TaskQueue;
  private readonly agent: RunnableAgent;
  private readonly pollMs: number;
  private readonly concurrency: number;
  private readonly respectControl: boolean;
  private readonly unref: boolean;

  private timer: NodeJS.Timeout | null = null;
  private active = 0;
  private processed = 0;
  private succeeded = 0;
  private failed = 0;
  private idleTicks = 0;
  private readonly inflightIds = new Set<string>();

  constructor(queue: TaskQueue, agent: RunnableAgent, opts: AgentWorkerOptions = {}) {
    this.queue = queue;
    this.agent = agent;
    this.pollMs = opts.pollMs ?? 1000;
    this.concurrency = Math.max(1, opts.concurrency ?? 1);
    this.name = opts.name ?? 'worker-1';
    this.respectControl = opts.respectControl !== false;
    this.unref = opts.unref === true;
  }

  /** 计划书 §九：start() */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.timer = setInterval(() => { void this.pump(); }, this.pollMs);
    if (this.unref) this.timer.unref?.();
    logger.info('AgentWorker', 'Started', { name: this.name, concurrency: this.concurrency, pollMs: this.pollMs });
    eventBus.emit('workflow.worker.started', { name: this.name, concurrency: this.concurrency });
    // 立刻先抽一次，别白等第一个 tick
    void this.pump();
  }

  /** 停机：停止拾取新任务，等待在飞任务收敛（最长 waitMs）。 */
  async stop(waitMs = 5000): Promise<void> {
    if (!this.running) return;
    this.running = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    const deadline = Date.now() + waitMs;
    while (this.active > 0 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
    }
    logger.info('AgentWorker', 'Stopped', { name: this.name, processed: this.processed });
    eventBus.emit('workflow.worker.stopped', { name: this.name, processed: this.processed });
  }

  /**
   * 抽干队列直到空或达到 maxTasks（演示 / 测试用，不必等 setInterval）。
   * 返回实际处理的任务数。
   */
  async drain(maxTasks = Infinity): Promise<number> {
    let n = 0;
    while (n < maxTasks && this.queue.size() > 0) {
      const task = this.queue.pop();
      if (!task) break;
      await this.runTask(task);
      n += 1;
    }
    return n;
  }

  /** 一次泵取：在并发额度内尽可能多拾取任务。 */
  private async pump(): Promise<void> {
    if (!this.running) return;
    if (this.respectControl && (agentControl.paused || agentControl.killed)) return;

    let picked = 0;
    while (this.active < this.concurrency && this.queue.size() > 0) {
      const task = this.queue.pop();
      if (!task) break;
      picked += 1;
      void this.runTask(task);
    }
    if (picked === 0) {
      this.idleTicks += 1;
      if (this.idleTicks % 60 === 0) metrics.increment('workflow.worker.idle.minute');
    } else {
      this.idleTicks = 0;
    }
  }

  private async runTask(task: AgentTask): Promise<void> {
    this.active += 1;
    this.inflightIds.add(task.id);
    const span = tracer.start('AgentWorker.task', { taskId: task.id, goal: task.goal, worker: this.name });
    metrics.increment('workflow.worker.started');
    logger.info('AgentWorker', 'Task picked', { worker: this.name, taskId: task.id, goal: task.goal }, span.id);

    try {
      const result = await this.agent.run(task.goal);
      this.queue.complete(task, result);
      this.succeeded += 1;
      metrics.increment('workflow.worker.completed');
      tracer.end(span, { status: 'completed' });
      logger.info('AgentWorker', 'Task completed', { worker: this.name, taskId: task.id }, span.id);
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      const retry = canRetry(task);
      this.queue.fail(task, msg, retry);
      if (!retry) this.failed += 1;
      metrics.increment(retry ? 'workflow.worker.retry' : 'workflow.worker.failed');
      tracer.fail(e, span);
      logger.error('AgentWorker', 'Task failed', { worker: this.name, taskId: task.id, error: msg, retry }, span.id);
    } finally {
      this.active -= 1;
      this.inflightIds.delete(task.id);
      this.processed += 1;
    }
  }

  stats() {
    return {
      name: this.name,
      running: this.running,
      concurrency: this.concurrency,
      pollMs: this.pollMs,
      active: this.active,
      processed: this.processed,
      succeeded: this.succeeded,
      failed: this.failed,
      inflight: [...this.inflightIds],
      queueSize: this.queue.size(),
    };
  }

  /** 当前是否空闲（无在飞任务且队列为空）—— 用于 §十二 的 Sleep 判定 */
  isIdle(): boolean {
    return this.active === 0 && this.queue.size() === 0;
  }

  /** 最近一次任务摘要（Dashboard 用） */
  lastTasks(limit = 5) {
    return this.queue.history(limit).map(taskSummary);
  }
}
