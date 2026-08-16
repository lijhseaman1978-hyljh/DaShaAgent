// evolution/successMiner.ts — 方案三：从成功中学习
//
// 不只抓失败，也抓成功。成功的经验也值得沉淀：
//   ① 工具组合 → "处理海事报告 → 先用 knowledge-search 查公约 → 再用 offline-office"
//   ② 格式偏好 → "用户喜欢表格 > 段落"
//   ③ Prompt 模式 → "反转驱动写作对爆文有效"
//
// 接入点：AgentLoop.reflect() 成功后调用 mineSuccess()

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

// ── 数据结构 ──
export interface SuccessPattern {
  id: string;
  taskType: string;         // 任务类型（报告生成/公众号爆文/代码开发/信息查询）
  toolChain: string[];      // 使用的工具链（按顺序）
  formatUsed: string;       // 输出格式
  successRate: number;      // 成功率（0-1）
  avgTokens: number;        // 平均 Token 消耗
  avgTime: number;          // 平均耗时（秒）
  occurrences: number;      // 出现次数
  lastUsed: number;         // 最近使用时间
  tips: string[];           // 提炼的技巧
}

export interface ToolEffectiveness {
  toolName: string;
  taskTypes: Record<string, { uses: number; successes: number; avgTokens: number }>;
  overallSuccessRate: number;
  bestFor: string[];        // 最适合什么任务
}

const PATTERNS_PATH = join(process.cwd(), 'data', 'success-patterns.json');
const EFFECTIVENESS_PATH = join(process.cwd(), 'data', 'tool-effectiveness.json');

// ── 任务类型自动分类 ──
const TASK_CLASSIFIERS: Array<[RegExp, string]> = [
  [/报告|REPORT|文档|DOCX|Word|生成报告|写报告/i, '报告生成'],
  [/公众号|爆文|文章|发文|排版|封面|内容创作/i, '公众号内容创作'],
  [/代码|脚本|程序|函数|模块|TypeScript|Python|PHP|开发|实现/i, '代码开发'],
  [/搜索|查询|查找|查一下|什么是|怎么|为什么/i, '信息查询'],
  [/分析|审计|评估|审查|检查|review/i, '分析审计'],
  [/配置|部署|安装|启动|设置|环境/i, '配置部署'],
  [/海事|船|SIRE|SOLAS|CII|引水|港口|公约|证书/i, '海事业务'],
  [/游戏|SH3|模组|MOD|S3D|潜艇/i, '游戏开发'],
];

function classifyTask(goal: string, userInput: string): string {
  const combined = goal + ' ' + userInput;
  for (const [re, type] of TASK_CLASSIFIERS) {
    if (re.test(combined)) return type;
  }
  return '通用任务';
}

// ── 工具链归一化 ──
function normalizeToolChain(toolNames: string[]): string[] {
  // 去重 + 标准化名称
  const seen = new Set<string>();
  return toolNames.filter(n => {
    if (seen.has(n)) return false;
    seen.add(n);
    return true;
  });
}

// ── 公共 API ──

export function loadSuccessPatterns(): SuccessPattern[] {
  try {
    if (existsSync(PATTERNS_PATH)) return JSON.parse(readFileSync(PATTERNS_PATH, 'utf-8'));
  } catch { /* 损坏则重置 */ }
  return [];
}

export function saveSuccessPatterns(patterns: SuccessPattern[]): void {
  const dir = join(process.cwd(), 'data');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(PATTERNS_PATH, JSON.stringify(patterns, null, 2), 'utf-8');
}

export function loadToolEffectiveness(): ToolEffectiveness[] {
  try {
    if (existsSync(EFFECTIVENESS_PATH)) return JSON.parse(readFileSync(EFFECTIVENESS_PATH, 'utf-8'));
  } catch { /* 损坏则重置 */ }
  return [];
}

export function saveToolEffectiveness(eff: ToolEffectiveness[]): void {
  const dir = join(process.cwd(), 'data');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(EFFECTIVENESS_PATH, JSON.stringify(eff, null, 2), 'utf-8');
}

// ── 成功经验挖掘 ──

export interface MineInput {
  goal: string;
  userInput: string;
  toolNames: string[];       // 本次使用的工具列表（顺序）
  outputFormat: string;      // 输出格式（table/paragraph/markdown/html/code）
  tokensUsed: number;        // Token 消耗
  durationMs: number;        // 耗时
  tipHints?: string[];       // 人工或 AI 总结的技巧
}

export function mineSuccess(input: MineInput): void {
  const taskType = classifyTask(input.goal, input.userInput);
  const toolKey = normalizeToolChain(input.toolNames).join(' → ') || 'no-tools';

  // ── 更新 SuccessPatterns ──
  const patterns = loadSuccessPatterns();

  // 找匹配模式（同任务类型 + 同工具链）
  let pattern = patterns.find(p => p.taskType === taskType && p.toolChain.join(' → ') === toolKey);
  if (!pattern) {
    pattern = {
      id: `SP-${Date.now().toString(36)}`,
      taskType,
      toolChain: normalizeToolChain(input.toolNames),
      formatUsed: input.outputFormat,
      successRate: 1.0,
      avgTokens: input.tokensUsed,
      avgTime: input.durationMs,
      occurrences: 1,
      lastUsed: Date.now(),
      tips: input.tipHints || [],
    };
    patterns.push(pattern);
  } else {
    // 指数加权更新
    const alpha = 0.3; // 新数据权重
    pattern.successRate = pattern.successRate * (1 - alpha) + 1.0 * alpha; // 本次是成功
    pattern.avgTokens = pattern.avgTokens * (1 - alpha) + input.tokensUsed * alpha;
    pattern.avgTime = pattern.avgTime * (1 - alpha) + input.durationMs * alpha;
    pattern.occurrences++;
    pattern.lastUsed = Date.now();
    if (input.outputFormat !== pattern.formatUsed) {
      pattern.formatUsed = input.outputFormat; // 更新格式偏好
    }
    if (input.tipHints?.length) {
      for (const tip of input.tipHints) {
        if (!pattern.tips.includes(tip)) pattern.tips.push(tip);
      }
    }
  }

  // 限制总模式数量（保留最常用的 50 个）
  if (patterns.length > 50) {
    patterns.sort((a, b) => b.occurrences - a.occurrences);
    patterns.splice(50);
  }

  saveSuccessPatterns(patterns);

  // ── 更新 ToolEffectiveness ──
  const effs = loadToolEffectiveness();
  for (const toolName of input.toolNames) {
    let eff = effs.find(e => e.toolName === toolName);
    if (!eff) {
      eff = {
        toolName,
        taskTypes: {},
        overallSuccessRate: 0,
        bestFor: [],
      };
      effs.push(eff);
    }
    if (!eff.taskTypes[taskType]) {
      eff.taskTypes[taskType] = { uses: 0, successes: 0, avgTokens: 0 };
    }
    const t = eff.taskTypes[taskType];
    t.uses++;
    t.successes++;
    t.avgTokens = t.avgTokens * 0.7 + input.tokensUsed * 0.3;

    // 重新计算整体成功率
    let totalUses = 0, totalSuccesses = 0;
    for (const v of Object.values(eff.taskTypes)) { totalUses += v.uses; totalSuccesses += v.successes; }
    eff.overallSuccessRate = totalUses > 0 ? totalSuccesses / totalUses : 0;

    // 更新最适合的任务类型
    eff.bestFor = Object.entries(eff.taskTypes)
      .sort(([, a], [, b]) => b.successes - a.successes)
      .slice(0, 3)
      .map(([t]) => t);
  }

  saveToolEffectiveness(effs);
}

// ── 生成最佳实践提示词 ──

export function buildBestPracticesPrompt(): string {
  const patterns = loadSuccessPatterns()
    .filter(p => p.occurrences >= 3)
    .sort((a, b) => b.occurrences - a.occurrences)
    .slice(0, 5);

  if (!patterns.length) return '';

  const lines: string[] = ['\n【已验证的最佳实践 — 从成功经验中提炼】'];

  for (const p of patterns) {
    const toolDesc = p.toolChain.length ? `工具链: ${p.toolChain.join(' → ')}` : '无需工具调用';
    lines.push(`${
      p.taskType} | ${toolDesc} | 成功率 ${(p.successRate * 100).toFixed(0)}% | 已验证 ${p.occurrences} 次`);
    if (p.tips.length) {
      lines.push(`  技巧: ${p.tips.slice(0, 3).join('；')}`);
    }
  }

  // 工具效率排行
  const effs = loadToolEffectiveness()
    .filter(e => Object.values(e.taskTypes).reduce((s, t) => s + t.uses, 0) >= 5)
    .sort((a, b) => b.overallSuccessRate - a.overallSuccessRate)
    .slice(0, 5);

  if (effs.length) {
    lines.push('\n工具效率排行:');
    for (const e of effs) {
      lines.push(`  ${e.toolName}: 成功率 ${(e.overallSuccessRate * 100).toFixed(0)}%，最适合 ${e.bestFor.join('/')}`);
    }
  }

  return lines.join('\n') + '\n';
}
