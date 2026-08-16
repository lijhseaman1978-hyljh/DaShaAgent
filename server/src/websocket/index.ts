// websocket/index.ts
// V3 Phase 3 - Step 2：WebSocket 广播层导出。
// 与 gateway/web.ts 的 V2 生产 WS 通道并存，命名空间独立。

export { AgentEventBus, agentEventBus } from './eventBus';
export type { AgentEvent } from './eventBus';
