// workflow/index.ts
// V3 Phase 3 - Step 4：Workflow Engine + Long Running Autonomous Agent Runtime 统一出口。
//
// 棕地并存声明（不删不降级）：
//   - scheduler/index.ts        V2 生产定时简报调度器（cron + jobs.json 持久化）—— 保留，未改动
//   - agent-os/scheduler/       V2 骨架 interval 调度器 —— 保留，未改动
//   - multiagent/scheduler.ts   AgentScheduler（任务→Agent 路由）—— 保留，未改动
//   - agents/collaboration/workflow.ts  V2 多智能体协作 Workflow —— 保留，未改动
//   本目录是 Step 4 教程层的第五套实现，专注「常驻自治：队列 + 调度 + 事件 + 后台 Worker」。

export type { WorkflowStep, Workflow } from './core/workflow';
export { defineWorkflow, WorkflowBuilder, validateWorkflow, topoLayers } from './core/workflow';

export type { TaskStatus, TaskSource, AgentTask, CreateTaskOptions } from './core/task';
export { createTask, nextTaskId, isTerminal, canRetry, taskSummary } from './core/task';

export type { WorkflowRunStatus, StepRunStatus, StepRun, WorkflowRunSnapshot, AgentLifecycleState } from './core/state';
export { WorkflowRun, LifecycleTracker } from './core/state';

export { TaskQueue } from './queue/taskQueue';
export type { TaskQueueOptions } from './queue/taskQueue';

export { WorkflowScheduler } from './scheduler/scheduler';
export type { ScheduledJob, SchedulerOptions } from './scheduler/scheduler';

export { CronTrigger, parseCronSpec } from './trigger/cronTrigger';
export type { CronSpec, CronCallback } from './trigger/cronTrigger';

export { EventTrigger, eventTrigger } from './trigger/eventTrigger';
export type { TriggerHandler, TriggerRecord } from './trigger/eventTrigger';

export { AgentWorker } from './worker/agentWorker';
export type { RunnableAgent, AgentWorkerOptions } from './worker/agentWorker';

export { WorkflowEngine } from './engine';
export type { WorkflowEngineOptions } from './engine';

import { WorkflowEngine, type WorkflowEngineOptions } from './engine';
import type { RunnableAgent } from './worker/agentWorker';

/** 一行拉起一台常驻 Agent 机器（计划书 §十）。 */
export function createWorkflowEngine(agent: RunnableAgent, opts: WorkflowEngineOptions = {}): WorkflowEngine {
  return new WorkflowEngine(agent, opts);
}
