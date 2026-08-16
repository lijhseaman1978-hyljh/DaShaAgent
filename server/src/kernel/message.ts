// kernel/message.ts
// 统一 Agent 通信格式。
// 计划书 Step 1.5：创建 Agent Message
// 所有 Agent 之间 / 模块之间的消息都走这个结构。

import { randomUUID } from 'node:crypto';

export interface AgentMessage {
  id: string;
  from: string;
  to: string;
  type: string;
  payload: any;
  timestamp: number;
}

export function createMessage(
  from: string,
  to: string,
  type: string,
  payload: any,
): AgentMessage {
  return {
    id: randomUUID(),
    from,
    to,
    type,
    payload,
    timestamp: Date.now(),
  };
}
