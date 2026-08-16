// api/index.ts
// V3 Phase 3 - Step 2：Agent Control Center 导出。
// 与 gateway/web.ts（V2 生产网关）并排存在，端口与路由命名空间均独立。

export { AgentController } from './agent.controller';
export type { ControllableRuntime, TaskRecord, TaskStatus, AgentControllerOptions } from './agent.controller';
export { createControlApp, startControlServer } from './controlServer';
export type { ControlServerHandle, ControlServerOptions } from './controlServer';
