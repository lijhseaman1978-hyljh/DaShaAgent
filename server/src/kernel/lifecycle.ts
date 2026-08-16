// kernel/lifecycle.ts
// Agent 生命周期状态机。
// 计划书 Step 1.4：创建 Agent 生命周期
// 状态可被 UI / 日志 / 监控系统观察。

export enum AgentState {
  CREATED = 'created',
  INITIALIZED = 'initialized',
  THINKING = 'thinking',
  PLANNING = 'planning',
  EXECUTING = 'executing',
  REFLECTING = 'reflecting',
  IDLE = 'idle',
  ERROR = 'error',
}
