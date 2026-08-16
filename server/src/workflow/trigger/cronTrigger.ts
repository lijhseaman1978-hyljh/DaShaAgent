// workflow/trigger/cronTrigger.ts
// V3 Phase 3 - Step 4 §七：Cron Agent —— 「每天 8 点自动分析」。
// 计划书原文：constructor(hour, callback) + start() 里 setInterval 每分钟判断 now.getHours() === hour。
//
// 并排扩展（原文实现的两个坑，生产必须补）：
//   1. 原文在整点那一小时内每分钟都会触发一次（触发 60 次）。这里用 lastFiredKey 做同窗去重。
//   2. 原文只支持「小时」粒度。这里加上 minute，并支持 daily / weekly / monthly 规格串，
//      与 V2 scheduler/index.ts 的 cron 方言保持一致（daily HH:MM / weekly MON HH:MM / monthly D HH:MM）。
// 同时实现 ScheduledJob 协议（shouldRun/execute），可直接 scheduler.add(cronTrigger) 交给 WorkflowScheduler 统一 tick，
// 也可独立 start() 自带 setInterval（忠实计划书用法）。

import { eventBus } from '../../kernel/eventBus';
import { logger } from '../../observability';
import type { ScheduledJob } from '../scheduler/scheduler';

export type CronCallback = (ctx: { firedAt: number; spec: string }) => any | Promise<any>;

export interface CronSpec {
  freq: 'daily' | 'weekly' | 'monthly' | 'interval';
  hour?: number;
  minute?: number;
  /** weekly: 0=SUN..6=SAT；monthly: 1..31 */
  day?: number;
  /** interval 模式的间隔（ms） */
  everyMs?: number;
}

const DAY_MAP: Record<string, number> = { SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6 };

/** 解析 'daily 08:00' / 'weekly MON 09:00' / 'monthly 1 10:00' / 'every 30s' / 'every 5m' */
export function parseCronSpec(spec: string): CronSpec | null {
  const parts = spec.trim().split(/\s+/);
  const freq = (parts[0] ?? '').toLowerCase();

  if (freq === 'every') {
    const m = /^(\d+)(ms|s|m|h)$/.exec(parts[1] ?? '');
    if (!m) return null;
    const n = Number(m[1]);
    const unit = m[2];
    const mult = unit === 'ms' ? 1 : unit === 's' ? 1000 : unit === 'm' ? 60_000 : 3_600_000;
    return { freq: 'interval', everyMs: n * mult };
  }

  const hm = /^(\d{1,2}):(\d{2})$/.exec(parts[parts.length - 1] ?? '');
  if (!hm) return null;
  const hour = Number(hm[1]);
  const minute = Number(hm[2]);
  if (hour > 23 || minute > 59) return null;

  if (freq === 'daily') return { freq: 'daily', hour, minute };
  if (freq === 'weekly') {
    const d = DAY_MAP[(parts[1] ?? '').toUpperCase()];
    if (d === undefined) return null;
    return { freq: 'weekly', day: d, hour, minute };
  }
  if (freq === 'monthly') {
    const d = parseInt(parts[1] ?? '1', 10);
    if (!Number.isFinite(d) || d < 1 || d > 31) return null;
    return { freq: 'monthly', day: d, hour, minute };
  }
  return null;
}

export class CronTrigger implements ScheduledJob {
  readonly id: string;
  readonly name: string;
  readonly specText: string;
  private readonly spec: CronSpec;
  private readonly callback: CronCallback;
  private timer: NodeJS.Timeout | null = null;
  /** 同一时间窗只触发一次的去重键 */
  private lastFiredKey = '';
  private lastIntervalAt = 0;
  fireCount = 0;

  /**
   * 忠实计划书原文用法：new CronTrigger(8, () => agent.run('分析今日市场'))
   * 扩展用法：      new CronTrigger('daily 08:00', cb, { name: '每日市场分析' })
   */
  constructor(hourOrSpec: number | string, callback: CronCallback, opts: { name?: string; id?: string } = {}) {
    this.callback = callback;
    if (typeof hourOrSpec === 'number') {
      this.spec = { freq: 'daily', hour: hourOrSpec, minute: 0 };
      this.specText = `daily ${String(hourOrSpec).padStart(2, '0')}:00`;
    } else {
      const parsed = parseCronSpec(hourOrSpec);
      if (!parsed) throw new Error(`无效的 cron 规格: ${hourOrSpec}`);
      this.spec = parsed;
      this.specText = hourOrSpec;
    }
    this.id = opts.id ?? `cron_${this.specText.replace(/\s+/g, '_')}`;
    this.name = opts.name ?? `CronTrigger(${this.specText})`;
  }

  /** ScheduledJob 协议：交给 WorkflowScheduler 统一 tick 时调用 */
  shouldRun(now: Date = new Date()): boolean {
    if (this.spec.freq === 'interval') {
      const every = this.spec.everyMs ?? 60_000;
      if (now.getTime() - this.lastIntervalAt < every) return false;
      this.lastIntervalAt = now.getTime();
      return true;
    }

    if (now.getHours() !== this.spec.hour || now.getMinutes() !== (this.spec.minute ?? 0)) return false;
    if (this.spec.freq === 'weekly' && now.getDay() !== this.spec.day) return false;
    if (this.spec.freq === 'monthly' && now.getDate() !== this.spec.day) return false;

    // 同一分钟窗口只触发一次
    const key = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${now.getHours()}-${now.getMinutes()}`;
    if (key === this.lastFiredKey) return false;
    this.lastFiredKey = key;
    return true;
  }

  async execute(): Promise<any> {
    this.fireCount += 1;
    const firedAt = Date.now();
    logger.info('CronTrigger', 'Fired', { spec: this.specText, name: this.name });
    eventBus.emit('workflow.cron.fired', { id: this.id, name: this.name, spec: this.specText, firedAt });
    return this.callback({ firedAt, spec: this.specText });
  }

  /** 忠实计划书原文：自带 setInterval（60s 粒度；interval 模式用自身间隔）。 */
  start(): void {
    if (this.timer) return;
    const period = this.spec.freq === 'interval' ? Math.min(this.spec.everyMs ?? 60_000, 60_000) : 60_000;
    this.timer = setInterval(() => {
      if (this.shouldRun(new Date())) void this.execute();
    }, period);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** 测试/演示：无视时间窗直接触发一次 */
  async fireNow(): Promise<any> {
    return this.execute();
  }
}
