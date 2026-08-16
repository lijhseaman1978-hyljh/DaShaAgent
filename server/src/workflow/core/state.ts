// workflow/core/state.ts
// V3 Phase 3 - Step 4 §二/§十二：Workflow 运行态状态机。
// 计划书 §十二 的 Agent 生命周期：Boot → Initialize → Listen → Receive Event → Plan → Execute → Learn → Sleep → Wake → Repeat。
// 本文件承担其中「一次 Workflow 执行」的状态记录，与 agent-loop/state.ts（单次 Agent Loop 状态）互补。

import type { Workflow, WorkflowStep } from './workflow';
import type { AgentTask } from './task';

export type WorkflowRunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
export type StepRunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

export interface StepRun {
  stepId: string;
  name: string;
  action: string;
  status: StepRunStatus;
  taskId?: string;
  startedAt?: number;
  finishedAt?: number;
  output?: any;
  error?: string;
}

export interface WorkflowRunSnapshot {
  runId: string;
  workflowId: string;
  workflowName: string;
  status: WorkflowRunStatus;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  durationMs?: number;
  steps: StepRun[];
  error?: string;
  progress: { done: number; total: number; percent: number };
}

let runSeq = 0;

export class WorkflowRun {
  readonly runId: string;
  readonly workflow: Workflow;
  status: WorkflowRunStatus = 'pending';
  readonly createdAt = Date.now();
  startedAt?: number;
  finishedAt?: number;
  error?: string;
  readonly steps: Map<string, StepRun> = new Map();

  constructor(workflow: Workflow) {
    runSeq += 1;
    this.runId = `run_${Date.now().toString(36)}_${runSeq.toString(36)}`;
    this.workflow = workflow;
    for (const s of workflow.steps) {
      this.steps.set(s.id, { stepId: s.id, name: s.name, action: s.action, status: 'pending' });
    }
  }

  start(): void {
    this.status = 'running';
    this.startedAt = Date.now();
  }

  beginStep(step: WorkflowStep, task: AgentTask): void {
    const sr = this.steps.get(step.id);
    if (!sr) return;
    sr.status = 'running';
    sr.taskId = task.id;
    sr.startedAt = Date.now();
  }

  finishStep(stepId: string, output: any): void {
    const sr = this.steps.get(stepId);
    if (!sr) return;
    sr.status = 'completed';
    sr.output = output;
    sr.finishedAt = Date.now();
  }

  failStep(stepId: string, error: string, optional = false): void {
    const sr = this.steps.get(stepId);
    if (!sr) return;
    sr.status = optional ? 'skipped' : 'failed';
    sr.error = error;
    sr.finishedAt = Date.now();
  }

  finish(status: WorkflowRunStatus = 'completed', error?: string): void {
    this.status = status;
    this.error = error;
    this.finishedAt = Date.now();
  }

  /** 是否所有非可选步骤都已完成 */
  allDone(): boolean {
    return [...this.steps.values()].every((s) => s.status === 'completed' || s.status === 'skipped');
  }

  /** 是否有硬失败 */
  hasFailure(): boolean {
    return [...this.steps.values()].some((s) => s.status === 'failed');
  }

  snapshot(): WorkflowRunSnapshot {
    const steps = [...this.steps.values()];
    const done = steps.filter((s) => s.status === 'completed' || s.status === 'skipped').length;
    return {
      runId: this.runId,
      workflowId: this.workflow.id,
      workflowName: this.workflow.name,
      status: this.status,
      createdAt: this.createdAt,
      startedAt: this.startedAt,
      finishedAt: this.finishedAt,
      durationMs: this.finishedAt && this.startedAt ? this.finishedAt - this.startedAt : undefined,
      steps,
      error: this.error,
      progress: { done, total: steps.length, percent: steps.length ? Math.round((done / steps.length) * 100) : 0 },
    };
  }
}

/** Agent 长期运行的宏观生命周期（计划书 §十二） */
export type AgentLifecycleState = 'boot' | 'initialize' | 'listen' | 'plan' | 'execute' | 'learn' | 'sleep' | 'stopped';

export class LifecycleTracker {
  private state: AgentLifecycleState = 'boot';
  private readonly history: Array<{ state: AgentLifecycleState; at: number }> = [];

  set(next: AgentLifecycleState): void {
    if (next === this.state) return;
    this.state = next;
    this.history.push({ state: next, at: Date.now() });
    if (this.history.length > 200) this.history.shift();
  }

  get(): AgentLifecycleState { return this.state; }
  timeline(limit = 50) { return this.history.slice(-limit); }
}
