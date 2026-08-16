// agent/brain/index.ts
// Brain 大脑统一出口（V2 单模型决策大脑）。
// 计划书 Step 2-六：创建 Brain 总入口
// ── 版本分工契约 ──
//   • 本目录 = V2 大脑（planner/decision/reasoning/taskGraph），仅被 kernel/runtime.ts（演示）引用。
//   • 顶层 brain/ 是 V3 多模型大脑（生产在跑），二者并存不替换。
//   • 如未来要让 V2 大脑进生产，需先在 core/orchestrator.ts 接线，勿直接删 V3 版。

export * from './planner';
export * from './taskGraph';
export * from './reasoning';
export * from './decision';
