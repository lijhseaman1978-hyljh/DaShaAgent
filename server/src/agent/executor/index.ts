// agent/executor/index.ts
// Executor 执行核心统一出口（★ V2 生产执行器）。
// 计划书 Step 3：创建 Executor 总入口
// ── 版本分工契约 ──
//   • 本目录 = V2 执行器（executor/retry/recovery/toolSelector），被 core/agentLoop.ts（生产主引擎）
//     与 kernel/runtime.ts（OS/control 演示）共同引用，是反思链路(Evaluator/Critic)的实际载体。
//   • 顶层 executor/ 是另一套 V1 执行器（已确认 retry.ts 等为死代码），勿与本目录混淆。
//   • 改动前先确认调用方：agentLoop.ts 生产在用，删/改需谨慎。

export * from './executor';
export * from './toolSelector';
export * from './executionContext';
export * from './retry';
export * from './recovery';
