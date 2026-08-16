// self-improve/promptInjector.ts — Tier 2: 学习注入回系统提示词
//
// 从 learningEngine + .learnings/ 提取活跃学习规则，
// 注入 AgentLoop.buildSystem() 的系统提示词中。
// 让模型在每次任务前自动"记住"从过往错误中学到的教训。

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export interface ActiveRule {
  id: string;
  priority: 'critical' | 'high' | 'medium';
  category: 'correction' | 'best_practice' | 'insight' | 'knowledge_gap';
  rule: string;       // 一行简洁规则（注入 prompt）
  source: string;     // 来源（LRN-xxx / ERR-xxx）
  occurrences: number; // 出现次数
  lastSeen: number;   // 最近一次出现时间戳
}

const LEARNINGS_DIR = join(process.cwd(), 'data', 'workspace', '.learnings');

// ── 规则提取正则 ──
// 从 .learnings/ 文件中提取 Summary 字段作为规则
const SUMMARY_RE = /### Summary\n(.+?)(?=\n\n|\n###|\n\*\*)/gs;
const PRIORITY_RE = /\*\*Priority\*\*:\s*(critical|high|medium)/i;
const PATTERN_KEY_RE = /Pattern-Key:\s*(\S+)/;
const RECUR_RE = /Recurrence-Count:\s*(\d+)/;
const LAST_SEEN_RE = /Last-Seen:\s*(\S+)/;
const STATUS_RE = /\*\*Status\*\*:\s*(pending|in_progress)/i;

/** 从 .learnings/ 提取待处理的高价值规则 */
export function extractActiveRules(maxRules: number = 8): ActiveRule[] {
  const rules: ActiveRule[] = [];

  const files = ['ERRORS.md', 'LEARNINGS.md'];
  for (const fn of files) {
    const p = join(LEARNINGS_DIR, fn);
    if (!existsSync(p)) continue;
    const content = readFileSync(p, 'utf-8');

    // 按条目分段
    const entries = content.split(/\n## \[/).slice(1);
    for (const entry of entries) {
      // 跳过已解决的
      if (entry.includes('**Status**: resolved') || entry.includes('**Status**: wont_fix')) continue;

      const idMatch = entry.match(/^([A-Z]+-\d{8}-\d{3})\]/);
      const id = idMatch ? idMatch[1] : 'unknown';
      const priorityMatch = entry.match(PRIORITY_RE);
      const priority = (priorityMatch ? priorityMatch[1] : 'medium') as ActiveRule['priority'];

      const summaryMatch = SUMMARY_RE.exec(entry);
      SUMMARY_RE.lastIndex = 0;
      let rule = summaryMatch ? summaryMatch[1].trim() : '';
      if (!rule) continue;

      // 截断过长规则
      if (rule.length > 150) rule = rule.slice(0, 150) + '...';

      const pkeyMatch = entry.match(PATTERN_KEY_RE);
      const recMatch = entry.match(RECUR_RE);
      const lastSeenMatch = entry.match(LAST_SEEN_RE);

      const category: ActiveRule['category'] =
        entry.includes('correction') || entry.includes('correction') ? 'correction' :
        entry.includes('best_practice') ? 'best_practice' :
        entry.includes('knowledge_gap') ? 'knowledge_gap' : 'insight';

      rules.push({
        id,
        priority,
        category,
        rule,
        source: id,
        occurrences: recMatch ? parseInt(recMatch[1], 10) : 1,
        lastSeen: lastSeenMatch ? Date.parse(lastSeenMatch[1]) || Date.now() : Date.now(),
      });
    }
  }

  // 按 priority + occurrences 排序，取 top N
  const order: Record<string, number> = { critical: 0, high: 1, medium: 2 };
  rules.sort((a, b) => {
    const po = order[a.priority] - order[b.priority];
    if (po !== 0) return po;
    return b.occurrences - a.occurrences;
  });

  return rules.slice(0, maxRules);
}

/** 硬编码的铁规（不依赖 .learnings/，始终注入） */
const HARD_RULES: string[] = [
  'RULE-001: 生成任何文档后，必须用 fs_list 验证文件存在，确认后才可汇报"已完成"。绝不编造文件路径或大小。',
  'RULE-002: 办公文档任务优先加载 offline-office 技能，不可跳过直接硬写。',
  'RULE-003: 工具执行结果中 tool 消息与其前置 assistant+tool_calls 必须配对，不可让 tool 消息成为孤儿。',
  'RULE-004: 同一工具不要用不同猜测参数反复重试（尤其 fs_read 猜路径）；一次失败就换方式。',
];

/** 生成 [自进化规则] 提示块，插入系统提示词 */
export function buildSelfEvolvePrompt(userInput: string, maxRules: number = 8): string {
  const dynamic = extractActiveRules(maxRules);
  if (dynamic.length === 0 && HARD_RULES.length === 0) return '';

  const lines: string[] = [];
  lines.push('\n【自进化规则 —— 从过往错误中自动学习】');
  lines.push('以下规则来自你的历史任务复盘，请严格遵守：');
  lines.push('');

  // 硬编码铁规（固定注入）
  for (const r of HARD_RULES) {
    lines.push(`- 🔒 ${r}`);
  }

  // 动态规则（从 .learnings/ 提取）
  if (dynamic.length > 0) {
    lines.push('');
    lines.push('近期学习到的规则：');
    for (const r of dynamic) {
      const marker = r.priority === 'critical' ? '🔴' : r.priority === 'high' ? '🟡' : '📘';
      lines.push(`- ${marker} [${r.source}] ${r.rule}`);
    }
  }

  lines.push('');
  lines.push('如果你注意到之前的这些规则在本次任务中应当触发但被你忽略了，请在回答前先纠正自己。');

  return lines.join('\n');
}
