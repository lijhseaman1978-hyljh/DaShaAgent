// evolution/sessionResume.ts — 方案二：跨会话智能恢复
//
// 新会话启动时，自动加载最近对话摘要，生成"上下文速览"：
//   - 最近 3 次对话的概要
//   - 未完成的任务
//   - 用户当时关注的领域
//
// 这样 Agent 醒来时不需要用户重新说"上次那个报告继续"，
// 而是自动问："船长，上次的 SIRE 审计还差第三部分，要继续吗？"
//
// 接入点：unified.ts 启动时调用 buildSessionResume()

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

interface SessionContext {
  date: string;
  time: string;
  summary: string;
  goal: string;
  success: boolean;
  domain: string;
  pendingTask?: string;
  keyFiles?: string[];
}

const REFLECTIONS_DIR = join(process.cwd(), 'data', 'reflections');
const MEMORY_DIR = join(process.cwd(), 'data', 'memory');

// ── 对话文件格式匹配 ──
const DIALOG_RE = /^\d{4}-\d{2}-\d{2}\.jsonl$/;
const SUMMARY_RE = /"summary"\s*:\s*"([^"]+)"/g;
const GOAL_RE = /"goal"\s*:\s*"([^"]+)"/g;

/** 从 reflections JSONL 提取最近会话上下文 */
function extractFromReflections(limit: number = 5): SessionContext[] {
  const results: SessionContext[] = [];
  if (!existsSync(REFLECTIONS_DIR)) return results;

  const files = readdirSync(REFLECTIONS_DIR)
    .filter(f => f.endsWith('.jsonl'))
    .sort()
    .reverse()
    .slice(0, 3); // 最近 3 天

  for (const fn of files) {
    try {
      const content = readFileSync(join(REFLECTIONS_DIR, fn), 'utf-8');
      const lines = content.split('\n').filter(Boolean);
      // 取最后 5 条
      for (const line of lines.slice(-5)) {
        try {
          const entry = JSON.parse(line);
          if (!entry.goal) continue;
          results.push({
            date: fn.replace('.jsonl', ''),
            time: new Date(entry.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
            summary: (entry.summary || '').slice(0, 120),
            goal: (entry.goal || '').slice(0, 100),
            success: !!entry.success,
            domain: detectDomain(entry.goal + ' ' + (entry.summary || '')),
          });
          if (results.length >= limit) break;
        } catch { /* 跳过损坏行 */ }
      }
    } catch { /* 跳过损坏文件 */ }
    if (results.length >= limit) break;
  }
  return results;
}

/** 从 memory/ 每日笔记提取未完成任务 */
function extractPendingTasks(): string[] {
  const tasks: string[] = [];
  if (!existsSync(MEMORY_DIR)) return tasks;

  try {
    const files = readdirSync(MEMORY_DIR)
      .filter(f => f.endsWith('.md'))
      .sort()
      .reverse()
      .slice(0, 2); // 最近 2 天

    for (const fn of files) {
      const content = readFileSync(join(MEMORY_DIR, fn), 'utf-8');
      // 查找待处理标记
      const pendingRe = /[-•]\s*(?:待处理|未完成|TODO|进行中|Blocked|⚠️|🔴|未完).+/gi;
      let m;
      while ((m = pendingRe.exec(content)) !== null) {
        tasks.push(m[0].trim().replace(/^[-•]\s*/, ''));
      }
    }
  } catch { /* 忽略 */ }
  return tasks.slice(0, 3);
}

/** 从 data/logs.jsonl 提取近期关键词 */
function extractRecentKeywords(): string[] {
  const keywords = new Set<string>();
  const logPath = join(process.cwd(), 'data', 'logs.jsonl');
  if (!existsSync(logPath)) return [];

  try {
    const content = readFileSync(logPath, 'utf-8');
    const lines = content.split('\n').filter(Boolean).slice(-200);
    const KW_RE = /船舶|船长|SIRE|SOLAS|公众号|爆文|报告|DOCX|Word|证书|CII|海事|引水|股票|A股|模组|游戏/gi;
    for (const line of lines) {
      let m;
      while ((m = KW_RE.exec(line)) !== null) keywords.add(m[0]);
    }
  } catch { /* 忽略 */ }
  return Array.from(keywords).slice(0, 8);
}

// ── 领域检测 ──
const DOMAIN_SIGNALS: Array<[RegExp, string]> = [
  [/船舶|船长|SIRE|SOLAS|MARPOL|CII|引水|PSC|港口|船级|ISM|DOC|VRA|Noon|压载|油轮/i, '海事航运'],
  [/公众号|爆文|微信|排版|封面|粉丝|草稿/i, '公众号运营'],
  [/代码|脚本|API|TypeScript|Python|HTML|CSS|编译|Git/i, '编程开发'],
  [/AI|Agent|LLM|模型|Prompt|自动化|Cron/i, 'AI与自动化'],
  [/股票|A股|基金|投资|行情|涨停|跌停/i, '投资理财'],
  [/游戏|SH3|潜艇|模组|MOD|S3D|Silent/i, '游戏与娱乐'],
];

function detectDomain(text: string): string {
  for (const [re, domain] of DOMAIN_SIGNALS) {
    if (re.test(text)) return domain;
  }
  return '通用';
}

// ── 公共 API ──

export interface ResumeContext {
  recentSessions: SessionContext[];
  pendingTasks: string[];
  activeDomains: string[];
  recentKeywords: string[];
  generatedAt: number;
}

/** 构建跨会话恢复上下文 */
export function buildResumeContext(): ResumeContext {
  return {
    recentSessions: extractFromReflections(5),
    pendingTasks: extractPendingTasks(),
    activeDomains: extractDomainsFromRecent(),
    recentKeywords: extractRecentKeywords(),
    generatedAt: Date.now(),
  };
}

function extractDomainsFromRecent(): string[] {
  const sessions = extractFromReflections(5);
  const domainCounts: Record<string, number> = {};
  for (const s of sessions) {
    domainCounts[s.domain] = (domainCounts[s.domain] || 0) + 1;
  }
  return Object.entries(domainCounts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 3)
    .map(([d]) => d);
}

/** 生成注入系统提示词的上下文速览 */
export function buildResumePrompt(ctx: ResumeContext): string {
  const lines: string[] = ['\n【跨会话上下文 — 上次我们做到哪了】'];

  // 最近会话
  if (ctx.recentSessions.length) {
    lines.push(`最近 ${ctx.recentSessions.length} 次对话概要：`);
    for (const s of ctx.recentSessions.slice(0, 3)) {
      const icon = s.success ? '✅' : '⚠️';
      lines.push(`  ${icon} ${s.date} ${s.time} | ${s.domain} | ${s.goal.slice(0, 60)}`);
    }
  }

  // 未完成任务
  if (ctx.pendingTasks.length) {
    lines.push(`\n⚠️ 待处理事项：`);
    for (const t of ctx.pendingTasks) lines.push(`  - ${t}`);
  }

  // 活跃领域
  if (ctx.activeDomains.length) {
    lines.push(`\n活跃领域: ${ctx.activeDomains.join('，')}`);
  }

  // 引导语
  if (ctx.pendingTasks.length) {
    lines.push(`\n*注意：上次有未完成的任务。如果用户开始对话，可以主动询问是否需要继续。*`);
  } else if (ctx.recentSessions.length) {
    lines.push(`\n*注意：这是新会话。如果用户提及相关话题，可引用上述上下文展现连续性。*`);
  }

  return lines.join('\n') + '\n';
}
