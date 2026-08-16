// self-improve/autoLogger.ts — Tier 1: 自动错误捕获 → 自动记日志
//
// 桥接 AgentLoop 的 ReflectionPhase 与 .learnings/ 日志系统。
// 由引擎在每次任务完成后强制触发，不依赖模型"主动想起来"。

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface CaptureEntry {
  goal: string;
  success: boolean;
  toolCallCount: number;
  summary: string;
  lesson?: string;
  timestamp?: number;
}

const LEARNINGS_DIR = join(process.cwd(), 'data', 'workspace', '.learnings');

function ensureDir(d: string) {
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
}
function ensureFile(p: string, header: string) {
  if (!existsSync(p)) writeFileSync(p, header + '\n', 'utf-8');
}

function nextSeq(filePath: string, prefix: string, dateStr: string): number {
  try {
    const content = readFileSync(filePath, 'utf-8');
    const re = new RegExp(`\\[${prefix}-${dateStr}-(\\d{3})\\]`, 'g');
    let max = 0; let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) { const n = parseInt(m[1], 10); if (n > max) max = n; }
    return max + 1;
  } catch { return 1; }
}

function genId(prefix: string, ts: number, seq: number): string {
  return `${prefix}-${new Date(ts).toISOString().slice(0, 10).replace(/-/g, '')}-${String(seq).padStart(3, '0')}`;
}
function slug(s: string): string {
  return s.slice(0, 40).replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
}

// ── 公共 API ──

export function captureReflection(entry: CaptureEntry): void {
  ensureDir(LEARNINGS_DIR);
  const ts = entry.timestamp || Date.now();
  const dateStr = new Date(ts).toISOString().slice(0, 10).replace(/-/g, '');
  const iso = new Date(ts).toISOString();

  if (!entry.success) {
    const f = join(LEARNINGS_DIR, 'ERRORS.md');
    ensureFile(f, '# Errors\n\nCommand failures and integration errors.\n\n---\n');
    const id = genId('ERR', ts, nextSeq(f, 'ERR', dateStr));
    appendFileSync(f, `\n## [${id}] ${slug(entry.goal)}\n\n` +
      `**Logged**: ${iso}\n**Priority**: ${entry.toolCallCount === 0 ? 'critical' : 'high'}\n` +
      `**Status**: pending\n**Area**: backend\n\n` +
      `### Summary\n${entry.lesson || '任务失败: ' + entry.goal.slice(0, 80)}\n\n` +
      `### Error\n\`\`\`\nGoal: ${entry.goal}\nSuccess: false\nToolCalls: ${entry.toolCallCount}\n` +
      `Summary: ${entry.summary.slice(0, 300)}\n\`\`\`\n\n` +
      `### Context\n- 任务目标: ${entry.goal.slice(0, 120)}\n- 工具调用: ${entry.toolCallCount} 次\n` +
      `- 原因: ${entry.lesson || '未知'}\n\n` +
      `### Metadata\n- Source: auto-capture\n- Tags: auto-captured, failure\n\n---\n`, 'utf-8');
  } else if (entry.lesson) {
    const f = join(LEARNINGS_DIR, 'LEARNINGS.md');
    ensureFile(f, '# Learnings\n\n---\n');
    const id = genId('LRN', ts, nextSeq(f, 'LRN', dateStr));
    appendFileSync(f, `\n## [${id}] insight\n\n` +
      `**Logged**: ${iso}\n**Priority**: medium\n**Status**: pending\n**Area**: backend\n\n` +
      `### Summary\n${entry.lesson || entry.summary.slice(0, 200)}\n\n` +
      `### Details\n- 任务: ${entry.goal.slice(0, 200)}\n- 工具调用: ${entry.toolCallCount} 次\n- 结果: 成功\n\n` +
      `### Metadata\n- Source: auto-capture\n- Tags: auto-captured\n\n---\n`, 'utf-8');
  }
}

export function captureFeatureRequest(desc: string, ctx?: string): void {
  ensureDir(LEARNINGS_DIR);
  const f = join(LEARNINGS_DIR, 'FEATURE_REQUESTS.md');
  ensureFile(f, '# Feature Requests\n\n---\n');
  const ts = Date.now();
  const dateStr = new Date(ts).toISOString().slice(0, 10).replace(/-/g, '');
  const id = genId('FEAT', ts, nextSeq(f, 'FEAT', dateStr));
  appendFileSync(f, `\n## [${id}] ${slug(desc)}\n\n` +
    `**Logged**: ${new Date(ts).toISOString()}\n**Priority**: medium\n**Status**: pending\n\n` +
    `### Requested Capability\n${desc}\n\n### User Context\n${ctx || '用户提出此需求'}\n\n---\n`, 'utf-8');
}
