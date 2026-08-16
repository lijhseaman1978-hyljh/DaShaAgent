// server/src/control.ts
// V3 Phase 3 - Step 2：Agent Control Center 独立启动入口（npm run control）。
//
// 棕地说明：生产入口 server.ts（V2 网关，AH_PORT=8787）保持不变，本入口另起端口
//   AH_CONTROL_PORT（默认 3001），两者可同时运行、互不干扰。

import { AgentRuntime } from './kernel/runtime';
import { startControlServer } from './api';

async function main() {
  const runtime = new AgentRuntime();
  await runtime.boot();

  const port = Number(process.env.AH_CONTROL_PORT || 3001);
  // agents / skills 取自 runtime 内部的 Multi-Agent 团队（Phase 1 Step 8/9 装配）
  const team = () => (runtime as any).agents;
  const handle = await startControlServer(runtime, {
    port,
    agents: () => team()?.getTeam?.().map((a: any) => ({ id: a.id, name: a.name, role: a.role })) ?? [],
    skills: () => team()?.skills?.list?.().map((s: any) => ({ name: s?.name ?? String(s) })) ?? [],
    cognitive: () => (runtime as any).getCognitive?.() ?? null,
  });

  console.log(`\n  Control Center 已就绪 → ${handle.url}`);
  console.log('  REST : GET /api/status | POST /api/task | GET /api/memory | GET /api/skills | GET /api/agents');
  console.log('  控制 : POST /api/agent/pause | resume | kill | reset');
  console.log('  实时 : WS /ws\n');

  const shutdown = async (sig: string) => {
    console.log(`\n[ControlCenter] ${sig} 收到，正在关闭…`);
    await handle.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((e) => {
  console.error('[ControlCenter] 启动失败:', e);
  process.exit(1);
});
