// src/index.ts
// DaShaAgent OS v3.0 —— 系统入口。
// 计划书：Phase 1 - Step 1 十一、创建系统入口
//
// 职责：引导内核（Kernel/Runtime/EventBus/Config）→ 打印 SYSTEM READY → 执行首个目标。
// 说明：本入口是 V3 Agent OS 的启动器；生产 HTTP 服务入口仍为 server/src/server.ts。

import { AgentRuntime } from './kernel';

async function main(): Promise<void> {
  const runtime = new AgentRuntime();

  await runtime.boot();

  // 目标可由命令行覆盖：tsx server/src/index.ts "你的目标"
  const goal = process.argv.slice(2).join(' ').trim() || 'Hello Agent OS';
  await runtime.run(goal);
}

main().catch((err) => {
  console.error('[DaShaAgent OS] 启动失败:', err);
  process.exitCode = 1;
});
