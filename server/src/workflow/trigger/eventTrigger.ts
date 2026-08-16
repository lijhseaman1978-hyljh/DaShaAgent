// workflow/trigger/eventTrigger.ts
// V3 Phase 3 - Step 4 §八：Event Trigger —— Agent 监听事件（文件上传 → 自动分析）。
// 计划书原文：handlers 字典 + on(event, cb) + emit(event, data)。
//
// 并排扩展（原文的三个限制，生产必须补）：
//   1. 原文 handlers[event] = callback 会覆盖同事件的旧处理器 → 改为数组，支持多订阅。
//   2. 原文无法取消订阅 → 补 off / once。
//   3. 与 kernel/eventBus 隔离 → 补 bridge()，把内核事件桥接进来，
//      让 Agent 能对 agent.paused / workflow.task.completed 等系统事件做出反应。
//
// 棕地说明：kernel/eventBus 是「模块间通信总线」（内部广播）；EventTrigger 是「外部事件 → Agent 自主行动」的入口层，
//           二者并存，通过 bridge() 单向连接，不改动 eventBus 任何代码。

import { eventBus } from '../../kernel/eventBus';
import { logger, metrics } from '../../observability';

export type TriggerHandler = (data: any, event: string) => any | Promise<any>;

interface Subscription {
  handler: TriggerHandler;
  once: boolean;
  id: number;
}

export interface TriggerRecord {
  event: string;
  data: any;
  at: number;
  handled: number;
}

export class EventTrigger {
  /** 计划书原文属性名保留（只读视图见 handlerNames()） */
  private readonly handlerMap = new Map<string, Subscription[]>();
  private readonly bridged = new Set<string>();
  private readonly recent: TriggerRecord[] = [];
  private seq = 0;
  private historyLimit = 100;

  /** 计划书 §八：on(event, callback) */
  on(event: string, callback: TriggerHandler): () => void {
    return this.subscribe(event, callback, false);
  }

  /** 只触发一次 */
  once(event: string, callback: TriggerHandler): () => void {
    return this.subscribe(event, callback, true);
  }

  private subscribe(event: string, handler: TriggerHandler, once: boolean): () => void {
    this.seq += 1;
    const sub: Subscription = { handler, once, id: this.seq };
    const list = this.handlerMap.get(event) ?? [];
    list.push(sub);
    this.handlerMap.set(event, list);
    return () => this.offById(event, sub.id);
  }

  /** 取消订阅：不传 handler 则清空该事件全部订阅 */
  off(event: string, handler?: TriggerHandler): void {
    if (!handler) { this.handlerMap.delete(event); return; }
    const list = (this.handlerMap.get(event) ?? []).filter((s) => s.handler !== handler);
    if (list.length) this.handlerMap.set(event, list);
    else this.handlerMap.delete(event);
  }

  private offById(event: string, id: number): void {
    const list = (this.handlerMap.get(event) ?? []).filter((s) => s.id !== id);
    if (list.length) this.handlerMap.set(event, list);
    else this.handlerMap.delete(event);
  }

  /**
   * 计划书 §八：emit(event, data)。
   * 返回处理器数量，便于测试断言；异步 handler 的异常被捕获，不影响其他订阅。
   */
  emit(event: string, data: any = {}): number {
    const subs = this.handlerMap.get(event);
    const record: TriggerRecord = { event, data, at: Date.now(), handled: subs?.length ?? 0 };
    this.recent.unshift(record);
    if (this.recent.length > this.historyLimit) this.recent.length = this.historyLimit;

    metrics.increment('workflow.event.emitted');
    if (!subs || subs.length === 0) return 0;

    for (const sub of [...subs]) {
      if (sub.once) this.offById(event, sub.id);
      try {
        const r = sub.handler(data, event);
        if (r && typeof (r as any).catch === 'function') {
          (r as Promise<any>).catch((e) =>
            logger.error('EventTrigger', 'Async handler failed', { event, error: String(e?.message ?? e) }),
          );
        }
      } catch (e: any) {
        logger.error('EventTrigger', 'Handler failed', { event, error: String(e?.message ?? e) });
      }
    }
    metrics.increment('workflow.event.handled', subs.length);
    return subs.length;
  }

  /**
   * 把内核 eventBus 上的事件桥接进本 Trigger，使 Agent 可以对系统内部事件自主反应。
   * 例：trigger.bridge(['agent.killed', 'workflow.task.failed'])
   */
  bridge(topics: string[]): void {
    for (const topic of topics) {
      if (this.bridged.has(topic)) continue;
      this.bridged.add(topic);
      eventBus.on(topic, (data) => { this.emit(topic, data); });
    }
  }

  /** 已注册的事件名 */
  events(): string[] { return [...this.handlerMap.keys()]; }

  /** 每个事件的订阅数 */
  stats(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [k, v] of this.handlerMap) out[k] = v.length;
    return out;
  }

  /** 最近触发记录（Dashboard 用） */
  history(limit = 20): TriggerRecord[] { return this.recent.slice(0, limit); }

  clear(): void {
    this.handlerMap.clear();
    this.recent.length = 0;
  }
}

/** 全局单例，供 runtime / API 直接投递外部事件。 */
export const eventTrigger = new EventTrigger();
