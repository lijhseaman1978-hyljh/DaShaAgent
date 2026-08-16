// self-improve/patternDetector.ts — Tier 3: 重复模式检测 → 自动修复提案
//
// 跟踪 .learnings/ 中同类错误的重复次数。
// 同一 Pattern-Key 出现 3+ 次 → 自动生成修复提案 → 写入 PROPOSALS.md。
// 用户审核后说"执行提案 003" → agent 按提案改代码。

import { readFileSync, existsSync, writeFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

export interface FixProposal {
  id: string;
  patternKey: string;
  pattern: string;        // 模式描述
  occurrences: number;    // 出现次数
  firstSeen: number;
  lastSeen: number;
  suggestedAction: string;
  affectedFiles: string[];
  status: 'pending' | 'applied' | 'rejected';
  sourceEntryIds: string[];
}

const LEARNINGS_DIR = join(process.cwd(), 'data', 'workspace', '.learnings');
const PROPOSALS_FILE = join(LEARNINGS_DIR, 'PROPOSALS.md');

const PATTERN_KEY_RE = /Pattern-Key:\s*(\S+)/g;
const RECUR_RE = /Recurrence-Count:\s*(\d+)/;
const FIRST_SEEN_RE = /First-Seen:\s*(\S+)/;
const LAST_SEEN_RE = /Last-Seen:\s*(\S+)/;
const SUMMARY_RE = /### Summary\n(.+?)(?=\n\n|\n###|\n\*\*)/s;
const SUGGESTED_RE = /### Suggested (?:Action|Fix)\n(.+?)(?=\n\n|\n###|\n\*\*)/s;
const RELATED_RE = /Related Files:\s*(.+)/;
const STATUS_RE = /\*\*Status\*\*:\s*(pending|in_progress)/i;

// ── 扫描 .learnings/ 按 Pattern-Key 聚合 ──
export function scanPatterns(): FixProposal[] {
  const proposals: FixProposal[] = [];
  const seen = new Set<string>();

  const files = ['ERRORS.md', 'LEARNINGS.md'];
  for (const fn of files) {
    const p = join(LEARNINGS_DIR, fn);
    if (!existsSync(p)) continue;
    const content = readFileSync(p, 'utf-8');

    const entries = content.split(/\n## \[/).slice(1);
    for (const entry of entries) {
      // 跳过已解决
      if (entry.includes('**Status**: resolved') || entry.includes('**Status**: wont_fix')) continue;

      // 提取 Pattern-Key
      let pkeyMatch: RegExpExecArray | null;
      const re = new RegExp(PATTERN_KEY_RE.source, 'g');
      while ((pkeyMatch = re.exec(entry)) !== null) {
        const key = pkeyMatch[1];
        if (seen.has(key)) continue;

        const recMatch = entry.match(RECUR_RE);
        const occurrences = recMatch ? parseInt(recMatch[1], 10) : 1;

        // 只有出现 3+ 次才生成提案
        if (occurrences < 3) continue;

        seen.add(key);

        const summaryMatch = entry.match(SUMMARY_RE);
        const suggestMatch = entry.match(SUGGESTED_RE);
        const relatedMatch = entry.match(RELATED_RE);
        const firstMatch = entry.match(FIRST_SEEN_RE);
        const lastMatch = entry.match(LAST_SEEN_RE);

        const idMatch = entry.match(/^([A-Z]+-\d{8}-\d{3})\]/);
        const entryId = idMatch ? idMatch[1] : 'unknown';

        proposals.push({
          id: `PROP-${String(proposals.length + 1).padStart(3, '0')}`,
          patternKey: key,
          pattern: summaryMatch ? summaryMatch[1].trim().slice(0, 200) : key,
          occurrences,
          firstSeen: firstMatch ? Date.parse(firstMatch[1]) || Date.now() : Date.now(),
          lastSeen: lastMatch ? Date.parse(lastMatch[1]) || Date.now() : Date.now(),
          suggestedAction: suggestMatch ? suggestMatch[1].trim().slice(0, 500) : '待分析',
          affectedFiles: relatedMatch
            ? relatedMatch[1].split(',').map((f: string) => f.trim()).filter(Boolean)
            : [],
          status: 'pending',
          sourceEntryIds: [entryId],
        });
      }
    }
  }

  return proposals;
}

// ── 写入 PROPOSALS.md ──
export function writeProposals(proposals: FixProposal[]): string {
  if (!existsSync(LEARNINGS_DIR)) mkdirSync(LEARNINGS_DIR, { recursive: true });

  const existingIds = new Set<string>();
  if (existsSync(PROPOSALS_FILE)) {
    const old = readFileSync(PROPOSALS_FILE, 'utf-8');
    const ids = old.match(/## \[PROP-\d{3}\]/g);
    if (ids) ids.forEach(id => existingIds.add(id.replace('## [', '').replace(']', '')));
  }

  // 只追加新提案
  const newProposals = proposals.filter(p => !existingIds.has(p.id));
  if (newProposals.length === 0) {
    // 更新状态：检查是否有已存在的提案需要刷新
    if (!existsSync(PROPOSALS_FILE)) {
      writeFileSync(PROPOSALS_FILE, '# 自动修复提案\n\n以下提案由 patternDetector 自动生成。审核后说"执行提案 XXX"即可应用。\n\n---\n', 'utf-8');
    }
    return PROPOSALS_FILE;
  }

  if (!existsSync(PROPOSALS_FILE)) {
    writeFileSync(PROPOSALS_FILE, '# 自动修复提案\n\n以下提案由 patternDetector 自动生成。审核后说"执行提案 XXX"即可应用。\n\n---\n', 'utf-8');
  }

  for (const p of newProposals) {
    const entry = `
## [${p.id}] ${p.patternKey}

**状态**: ${p.status === 'pending' ? '⏳ 待审核' : p.status === 'applied' ? '✅ 已应用' : '❌ 已拒绝'}
**出现次数**: ${p.occurrences}
**首次**: ${new Date(p.firstSeen).toISOString().slice(0, 10)}
**最近**: ${new Date(p.lastSeen).toISOString().slice(0, 10)}

### 模式描述
${p.pattern}

### 建议修复
${p.suggestedAction}

### 涉及文件
${p.affectedFiles.length ? p.affectedFiles.map(f => `- ${f}`).join('\n') : '- 待确定'}

### 来源条目
${p.sourceEntryIds.map(id => `- ${id}`).join('\n')}

### 执行方式
审核通过后说 "执行提案 ${p.id}" 即自动修改代码 + 跑类型检查。

---
`;
    appendFileSync(PROPOSALS_FILE, entry, 'utf-8');
  }

  return PROPOSALS_FILE;
}

// ── 一键扫描+写入 ──
export function runPatternCheck(): { proposals: FixProposal[]; file: string; count: number } {
  const proposals = scanPatterns();
  const file = writeProposals(proposals);
  return { proposals, file, count: proposals.length };
}
