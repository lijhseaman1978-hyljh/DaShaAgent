// workflow/queue/taskQueue.ts
// V3 Phase 3 - Step 4 §五：Task Queue（优先级任务队列）。
// 计划书原文：push 后按 priority 降序排序，pop 取队首，size 返回长度。
// 并排扩展：容量上限、去重、终结态归档、统计、事件广播（供 Dashboard 实时看队列）。

import { eventBus } from '../../kernel/eventBus';
import { metrics } from '../../observability';
import type { AgentTask } from '../core/task';
import { isTerminal, taskSummary } from '../core/task';

export interface TaskQueueOptions {
  /** 队列容量上限，超出时丢弃最低优先级任务。0 = 不限制 */
  capacity?: number;
  /** 已完成任务归档保留条数 */
  archiveLimit?: number;
}

export class TaskQueue {
  private queue: AgentTask[] = [];
  /** 正在被 Worker 执行的任务 */
  private readonly inflight = new Map<string, AgentTask>();
  /** 已终结任务归档（供 API 查询历史） */
  private archive: AgentTask[] = [];

  private readonly capacity: number;
  private readonly archiveLimit: number;

  constructor(opts: TaskQueueOptions = {}) {
    this.capacity = opts.capacity ?? 0;
    this.archiveLimit = opts.archiveLimit ?? 200;
  }

  // ── 计划书 §五 原文三方法 ──

  push(task: AgentTask): void {
    // 去重：同 id 已在队列 / 执行中则忽略
    if (this.queue.some((t) => t.id === task.id) || this.inflight.has(task.id)) return;

    this.queue.push(task);
    this.queue.sort((a, b) => b.priority - a.priority || a.createdAt - b.createdAt);

    if (this.capacity > 0 && this.queue.length > this.capacity) {
      const dropped = this.queue.splice(this.capacity);
      for (const d of dropped) {
        d.status = 'cancelled';
        d.error = '队列已满，任务被丢弃';
        this.archiveTask(d);
      }
      metrics.increment('workflow.queue.dropped', dropped.length);
    }

    metrics.increment('workflow.queue.pushed');
    metrics.set('workflow.queue.size', this.queue.length);
    eventBus.emit('workflow.task.queued', taskSummary(task));
  }

  pop(): AgentTask | undefined {
    const task = this.queue.shift();
    if (task) {
      task.status = 'running';
      task.startedAt = Date.now();
      task.attempts = (task.attempts ?? 0) + 1;
      this.inflight.set(task.id, task);
      metrics.increment('workflow.queue.popped');
      metrics.set('workflow.queue.size', this.queue.length);
      eventBus.emit('workflow.task.started', taskSummary(task));
    }
    return task;
  }

  size(): number {
    return this.queue.length;
  }

  // ── 并排扩展 ──

  /** 查看队首但不取出 */
  peek(): AgentTask | undefined { return this.queue[0]; }

  /** 待执行任务快照 */
  pending(): AgentTask[] { return [...this.queue]; }

  /** 执行中任务快照 */
  running(): AgentTask[] { return [...this.inflight.values()]; }

  /** 归档（已终结）任务，最新在前 */
  history(limit = 50): AgentTask[] { return this.archive.slice(0, limit); }

  /** 全域查找一个任务（队列 / 执行中 / 归档） */
  find(id: string): AgentTask | undefined {
    return this.queue.find((t) => t.id === id) ?? this.inflight.get(id) ?? this.archive.find((t) => t.id === id);
  }

  /** Worker 执行完成后回收 */
  complete(task: AgentTask, result: any): void {
    this.inflight.delete(task.id);
    task.status = 'completed';
    task.result = result;
    task.finishedAt = Date.now();
    task.durationMs = task.startedAt ? task.finishedAt - task.startedAt : undefined;
    this.archiveTask(task);
    metrics.increment('workflow.task.completed');
    eventBus.emit('workflow.task.completed', taskSummary(task));
  }

  /** Worker 执行失败；仍可重试则重新入队 */
  fail(task: AgentTask, error: string, retry: boolean): void {
    this.inflight.delete(task.id);
    task.error = error;
    if (retry) {
      task.status = 'pending';
      task.startedAt = undefined;
      this.queue.push(task);
      this.queue.sort((a, b) => b.priority - a.priority || a.createdAt - b.createdAt);
      metrics.increment('workflow.task.retried');
      metrics.set('workflow.queue.size', this.queue.length);
      eventBus.emit('workflow.task.retry', taskSummary(task));
      return;
    }
    task.status = 'failed';
    task.finishedAt = Date.now();
    task.durationMs = task.startedAt ? task.finishedAt - task.startedAt : undefined;
    this.archiveTask(task);
    metrics.increment('workflow.task.failed');
    eventBus.emit('workflow.task.failed', taskSummary(task));
  }

  /** 取消一个尚未执行的任务 */
  cancel(id: string): boolean {
    const i = this.queue.findIndex((t) => t.id === id);
    if (i < 0) return false;
    const [t] = this.queue.splice(i, 1);
    t.status = 'cancelled';
    t.finishedAt = Date.now();
    this.archiveTask(t);
    metrics.set('workflow.queue.size', this.queue.length);
    eventBus.emit('workflow.task.cancelled', taskSummary(t));
    return true;
  }

  /** 清空待执行队列（不影响执行中任务） */
  clear(): number {
    const n = this.queue.length;
    for (const t of this.queue) { t.status = 'cancelled'; this.archiveTask(t); }
    this.queue = [];
    metrics.set('workflow.queue.size', 0);
    return n;
  }

  stats() {
    return {
      pending: this.queue.length,
      running: this.inflight.size,
      archived: this.archive.length,
      completed: this.archive.filter((t) => t.status === 'completed').length,
      failed: this.archive.filter((t) => t.status === 'failed').length,
      cancelled: this.archive.filter((t) => t.status === 'cancelled').length,
      topPriority: this.queue[0]?.priority ?? null,
    };
  }

  private archiveTask(task: AgentTask): void {
    if (!isTerminal(task)) return;
    this.archive.unshift(task);
    if (this.archive.length > this.archiveLimit) this.archive.length = this.archiveLimit;
  }
}
