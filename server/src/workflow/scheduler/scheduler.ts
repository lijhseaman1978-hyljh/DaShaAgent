// workflow/scheduler/scheduler.ts
// V3 Phase 3 - Step 4 §六：Scheduler（调度器）—— 决定「什么时候执行」。
// 计划书原文：jobs[] + add(job) + start() 里 setInterval 轮询 job.shouldRun() → job.execute()。
//
// 棕地说明：项目里已有三套调度器，本类与它们并存、职责不同：
//   1. scheduler/index.ts        —— V2 生产定时简报（cron 表达式 + jobs.json 持久化 + LLM 直出 Markdown）
//   2. agent-os/scheduler/       —— V2 骨架层 interval 调度（每个 job 独立 setInterval）
//   3. multiagent/scheduler.ts   —— AgentScheduler：任务→Agent 的「派给谁」路由，不涉及时间
//   4. 本类 WorkflowScheduler    —— Step 4 教程层：单一 tick 轮询 + shouldRun 协议，驱动 Trigger/Workflow 投递任务队列
// 为避免与 1/2 的 `Scheduler` 同名冲突，类名取 WorkflowScheduler，并在文件末尾按计划书原文别名导出 Scheduler。

import { eventBus } from '../../kernel/eventBus';
import { logger, metrics } from '../../observability';

/**
 * 计划书 §六 的 job 协议：只要求 shouldRun() / execute()。
 *
 * 注意 start/stop 的语义：Scheduler 只通过统一 tick 驱动 job，**不会**替 job 调 start()。
 * 否则像 CronTrigger 这种自带 setInterval 的 job 会被「双重计时」（自己一份 + tick 一份）。
 * stop() 仅在 remove()/stop() 时调用，用于回收 job 自己可能持有的资源。
 */
export interface ScheduledJob {
  id?: string;
  name?: string;
  shouldRun(now?: Date): boolean;
  execute(): any | Promise<any>;
  start?(): void;
  stop?(): void;
}

export interface SchedulerOptions {
  /** 轮询间隔，计划书原文为 1000ms */
  tickMs?: number;
  /** 是否 unref tick 定时器（默认 false，即调度器在跑就 hold 住进程 —— 长驻语义） */
  unref?: boolean;
}

interface JobRecord {
  job: ScheduledJob;
  id: string;
  name: string;
  runs: number;
  errors: number;
  lastRunAt?: number;
  lastError?: string;
  /** 防重入：上一次 execute 尚未 settle 时跳过 */
  busy: boolean;
}

export class WorkflowScheduler {
  private readonly records: JobRecord[] = [];
  private timer: NodeJS.Timeout | null = null;
  private readonly tickMs: number;
  private readonly unref: boolean;
  private running = false;
  private seq = 0;

  constructor(opts: SchedulerOptions = {}) {
    this.tickMs = opts.tickMs ?? 1000;
    this.unref = opts.unref === true;
  }

  /** 计划书 §六：add(job) */
  add(job: ScheduledJob): string {
    this.seq += 1;
    const id = job.id ?? `job_${this.seq}`;
    this.records.push({
      job,
      id,
      name: job.name ?? id,
      runs: 0,
      errors: 0,
      busy: false,
    });
    return id;
  }

  remove(id: string): boolean {
    const i = this.records.findIndex((r) => r.id === id);
    if (i < 0) return false;
    this.records[i].job.stop?.();
    this.records.splice(i, 1);
    return true;
  }

  /** 计划书 §六：start() —— 单一 tick 轮询所有 job */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.timer = setInterval(() => { void this.tick(); }, this.tickMs);
    if (this.unref) this.timer.unref?.();
    logger.info('Scheduler', 'Started', { jobs: this.records.length, tickMs: this.tickMs });
    eventBus.emit('workflow.scheduler.started', { jobs: this.records.length });
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const r of this.records) r.job.stop?.();
    logger.info('Scheduler', 'Stopped', { jobs: this.records.length });
    eventBus.emit('workflow.scheduler.stopped', { jobs: this.records.length });
  }

  isRunning(): boolean { return this.running; }

  /** 手动跑一轮（测试 / 演示用，避免必须等 tick） */
  async tick(now: Date = new Date()): Promise<number> {
    let fired = 0;
    for (const r of this.records) {
      if (r.busy) continue;
      let due = false;
      try { due = r.job.shouldRun(now); }
      catch (e: any) { r.errors += 1; r.lastError = String(e?.message ?? e); continue; }
      if (!due) continue;

      fired += 1;
      r.busy = true;
      r.runs += 1;
      r.lastRunAt = Date.now();
      metrics.increment('workflow.scheduler.fired');
      try {
        await r.job.execute();
      } catch (e: any) {
        r.errors += 1;
        r.lastError = String(e?.message ?? e);
        metrics.increment('workflow.scheduler.errors');
        logger.error('Scheduler', 'Job failed', { job: r.name, error: r.lastError });
      } finally {
        r.busy = false;
      }
    }
    return fired;
  }

  list() {
    return this.records.map((r) => ({
      id: r.id,
      name: r.name,
      runs: r.runs,
      errors: r.errors,
      lastRunAt: r.lastRunAt,
      lastError: r.lastError,
      busy: r.busy,
    }));
  }

  /** 计划书原文属性名 jobs，保留只读视图供外部检视 */
  get jobs(): ScheduledJob[] { return this.records.map((r) => r.job); }
}

// 计划书 §六 原文类名别名导出。
export { WorkflowScheduler as Scheduler };
