// workflow/core/task.ts
// V3 Phase 3 - Step 4 §四：Task 数据结构。
// 棕地说明：与 V2 的 scheduler/JobDef（定时简报任务）、agent-os/scheduler/JobDef（间隔任务）并存。
//           那两者描述「什么时候跑一个 prompt」，本文件描述「一个待执行的 Agent 目标单元」——语义不同，不互相替代。

/** 计划书 §四 原文四态；扩展 cancelled 用于 Human Override / 队列清理。 */
export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

/** 任务来源：便于 Dashboard 区分「谁把任务塞进队列的」。 */
export type TaskSource = 'manual' | 'cron' | 'event' | 'workflow' | 'system';

export interface AgentTask {
  // ── 计划书 §四 原文字段 ──
  id: string;
  goal: string;
  priority: number;
  status: TaskStatus;
  createdAt: number;

  // ── 并排扩展：生产可观测 / 可重试所需 ──
  source?: TaskSource;
  /** 归属的 Workflow（由 WorkflowEngine 展开步骤时写入） */
  workflowId?: string;
  /** 归属的 WorkflowStep id */
  stepId?: string;
  startedAt?: number;
  finishedAt?: number;
  attempts?: number;
  maxAttempts?: number;
  result?: any;
  error?: string;
  /** 执行耗时（ms） */
  durationMs?: number;
  meta?: Record<string, any>;
}

let seq = 0;

/** 生成任务 id：时间戳 + 自增，避免同毫秒碰撞。 */
export function nextTaskId(prefix = 'task'): string {
  seq += 1;
  return `${prefix}_${Date.now().toString(36)}_${seq.toString(36)}`;
}

export interface CreateTaskOptions {
  priority?: number;
  source?: TaskSource;
  workflowId?: string;
  stepId?: string;
  maxAttempts?: number;
  meta?: Record<string, any>;
  id?: string;
}

/** 工厂：补齐默认值，保证队列里的任务字段完整。 */
export function createTask(goal: string, opts: CreateTaskOptions = {}): AgentTask {
  return {
    id: opts.id ?? nextTaskId(),
    goal,
    priority: opts.priority ?? 0,
    status: 'pending',
    createdAt: Date.now(),
    source: opts.source ?? 'manual',
    workflowId: opts.workflowId,
    stepId: opts.stepId,
    attempts: 0,
    maxAttempts: opts.maxAttempts ?? 1,
    meta: opts.meta,
  };
}

/** 是否已终结（不会再被 Worker 拾取）。 */
export function isTerminal(task: AgentTask): boolean {
  return task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled';
}

/** 是否还能重试（reflection / executor 失败后由 Worker 判定）。 */
export function canRetry(task: AgentTask): boolean {
  return (task.attempts ?? 0) < (task.maxAttempts ?? 1);
}

/** 精简视图，供 API / Dashboard 序列化（去掉可能很大的 result 主体）。 */
export function taskSummary(task: AgentTask) {
  return {
    id: task.id,
    goal: task.goal,
    priority: task.priority,
    status: task.status,
    source: task.source,
    workflowId: task.workflowId,
    stepId: task.stepId,
    createdAt: task.createdAt,
    startedAt: task.startedAt,
    finishedAt: task.finishedAt,
    durationMs: task.durationMs,
    attempts: task.attempts,
    maxAttempts: task.maxAttempts,
    error: task.error,
  };
}
