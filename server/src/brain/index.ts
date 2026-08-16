// brain/index.ts
// Brain Engine 统一出口（★ V3 多模型大脑）。
// 计划书 Phase 1 - Step 4 八、导出
// ── 版本分工契约 ──
//   • 本目录 = V3 大脑（Brain/ContextBuilder/Reasoner/decision/taskGraph），被 core/orchestrator.ts、
//     scheduler/index.ts、kernel/runtime.ts 真实引用，是生产在跑的多模型推理层。
//   • agent/brain/ 是另一套 V2 大脑（planner/decision/reasoning/taskGraph），仅被 kernel/runtime.ts
//     演示引用，与 V3 大脑并存、不互相替换。
//   • 两者职责不同：V3=brain/* 多模型编排；V2=agent/brain/* 单模型决策。并存是设计意图。

export * from './brain';
export * from './planner';
export * from './reasoner';
export * from './decision';
export * from './taskGraph';
export * from './contextBuilder';
