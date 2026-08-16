// evolution/index.ts — 进化层统一出口
//
// Phase 7: 三方案集成
//   方案一: userModel.ts     — 用户画像自动生长
//   方案二: sessionResume.ts — 跨会话智能恢复
//   方案三: successMiner.ts  — 从成功中学习
//
// Phase 4 - Step 1: 自我进化引擎（新增）
//   能力缺口自动捕获 + Skill 注册表 + Skill Factory 自动造技能
//   统一从 evolutionEngine.ts 导出

export {
  evolveUserModel,
  loadUserModel,
  saveUserModel,
  buildUserModelPrompt,
} from './userModel';
export type { UserModel, DomainProfile, HabitPattern } from './userModel';

export {
  buildResumeContext,
  buildResumePrompt,
} from './sessionResume';
export type { ResumeContext } from './sessionResume';

export {
  mineSuccess,
  loadSuccessPatterns,
  loadToolEffectiveness,
  buildBestPracticesPrompt,
} from './successMiner';
export type { SuccessPattern, ToolEffectiveness, MineInput } from './successMiner';

// ===== Phase 4 - Step 1：自我进化引擎（能力缺口 + Skill 注册表 + Skill Factory）=====
export {
  // 1. 能力缺口自动捕获
  recordGap,
  markGapResolved,
  listOpenGaps,
  listAllGaps,
  // 2. Skill 注册表
  registerSkill,
  recordSkillCall,
  listSkills,
  listWeakSkills,
  findSkillByCapability,
  // 3. Skill Factory 自动造技能 + 报告
  autoFactory,
  buildEvolutionReport,
  saveEvolutionReport,
} from './evolutionEngine';
export type { CapabilityGap } from './capabilityGap';
export type { SkillStat } from './skillRegistry';
export type { FactoryResult } from './evolutionEngine';