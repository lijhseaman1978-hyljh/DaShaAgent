// self-improve/index.ts — 四层自进化架构统一出口
//
// Tier 1: autoLogger    — 自动错误捕获 → 自动记日志
// Tier 2: promptInjector — 学习注入回系统提示词
// Tier 3: patternDetector — 重复模式检测 → 自动修复提案
// Tier 4: regressionGuard — 能力回归测试 + 自动回滚建议

export { captureReflection, captureFeatureRequest } from './autoLogger';
export type { CaptureEntry } from './autoLogger';

export { buildSelfEvolvePrompt, extractActiveRules } from './promptInjector';
export type { ActiveRule } from './promptInjector';

export { scanPatterns, writeProposals, runPatternCheck } from './patternDetector';
export type { FixProposal } from './patternDetector';

export {
  registerCapabilityTest,
  runBaseline,
  runRegressionCheck,
  formatRegressionSummary,
  setupDefaultCapabilityTests,
} from './regressionGuard';
export type { RegressionResult, CapabilityTest } from './regressionGuard';
