// skills/index.ts
// V3 Phase 1 - Step 9 §二：Skill 层统一出口（教程层：core + factory + builtin）。
//
// 注意：本 barrel 只导出 Step 9 的可执行技能协议。文档型技能包的扫描器
//       （skills/loader.ts，返回 core/types 里的另一个 Skill 类型）保持独立导入路径，
//       避免两个同名 Skill 类型在同一 barrel 里打架。

export type { Skill } from './core/skill';
export { SkillRegistry } from './core/registry';
export { SkillManager } from './core/manager';

export { CapabilityAnalyzer } from './factory/analyzer';
export { SkillGenerator } from './factory/generator';
export { SkillInstaller } from './factory/installer';
export { SkillFactory } from './factory/factory';

export { CodingSkill } from './builtin/coding.skill';
export { ResearchSkill } from './builtin/research.skill';
export { BrowserSkill } from './builtin/browser.skill';
