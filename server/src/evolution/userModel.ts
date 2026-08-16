// evolution/userModel.ts — 方案一：用户画像自动生长
//
// 不再等用户说"记住"，每次对话后自动分析行为变化：
//   ① 偏好变化 → 自动更新 UserModel
//   ② 新关注领域 → 自动扩展
//   ③ 习惯模式 → 自动识别
//
// 接入点：AgentLoop.reflect() 结束后调用 evolveUserModel()

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Provider, ChatMessage } from '../core/types';

// ── 用户画像数据结构 ──
export interface UserModel {
  version: number;
  updatedAt: number;
  // 基本信息（从 profile 同步，不自动改）
  name: string;
  role: string;
  // 偏好（自动演化）
  preferences: {
    reportFormat: 'table' | 'paragraph' | 'bullet' | 'mixed';
    tone: 'formal' | 'casual' | 'concise';
    detailLevel: 'brief' | 'normal' | 'detailed';
    codeStyle: 'full_script' | 'inline' | 'conceptual';
    responseStyle: 'action_first' | 'plan_first' | 'ask_first';
  };
  // 关注领域（自动扩展，带权重）
  domains: Record<string, DomainProfile>;
  // 习惯模式（自动识别）
  habits: HabitPattern[];
  // 进化轨迹
  evolution: {
    totalConversations: number;
    preferenceChanges: number;
    newDomains: number;
    habitsDetected: number;
    lastAnalysisAt: number;
  };
}

export interface DomainProfile {
  weight: number;       // 0-1
  firstSeen: number;
  lastSeen: number;
  keywords: string[];
  taskTypes: string[];
}

export interface HabitPattern {
  pattern: string;
  frequency: 'daily' | 'weekly' | 'on_demand';
  lastTriggered: number;
  autoReminder: boolean;
  confidence: number;
}

const USER_MODEL_PATH = join(process.cwd(), 'data', 'user-model.json');

function defaultModel(): UserModel {
  return {
    version: 1, updatedAt: Date.now(), name: '', role: '',
    preferences: { reportFormat: 'paragraph', tone: 'casual', detailLevel: 'normal', codeStyle: 'full_script', responseStyle: 'action_first' },
    domains: {}, habits: [],
    evolution: { totalConversations: 0, preferenceChanges: 0, newDomains: 0, habitsDetected: 0, lastAnalysisAt: 0 },
  };
}

export function loadUserModel(): UserModel {
  try {
    if (existsSync(USER_MODEL_PATH)) {
      const raw = JSON.parse(readFileSync(USER_MODEL_PATH, 'utf-8'));
      return { ...defaultModel(), ...raw, preferences: { ...defaultModel().preferences, ...(raw.preferences || {}) } };
    }
  } catch { /* 损坏则重置 */ }
  return defaultModel();
}

export function saveUserModel(model: UserModel): void {
  const dir = join(process.cwd(), 'data');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  model.updatedAt = Date.now();
  writeFileSync(USER_MODEL_PATH, JSON.stringify(model, null, 2), 'utf-8');
}

// ── 偏好关键词 → 值映射 ──
const PREFERENCE_HINTS: Record<string, Array<{ re: RegExp; value: string }>> = {
  reportFormat: [
    { re: /表格|table|列表|用表/i, value: 'table' },
    { re: /段落|分段|自然语言|叙述/i, value: 'paragraph' },
    { re: /要点|简洁|bullet|列几条|重点/i, value: 'bullet' },
  ],
  tone: [
    { re: /正式|官方|规范|专业|严谨/i, value: 'formal' },
    { re: /随便|轻松|口语|自然|别太正式/i, value: 'casual' },
    { re: /简练|精简|压缩|缩写|别啰嗦/i, value: 'concise' },
  ],
  detailLevel: [
    { re: /详细|完整|全面|深入|说清楚/i, value: 'detailed' },
    { re: /简单|概括|大概|简要|摘要|别写太多/i, value: 'brief' },
  ],
};

// ── 领域关键词库（无 LLM 快速匹配）──
const DOMAIN_KEYWORDS: Record<string, string[]> = {
  '海事航运': ['船舶', '船长', '引水', 'SIRE', 'SOLAS', 'MARPOL', 'CII', '干坞', '特检', 'PSC', '巴哈马', 'IMO', '船级社', 'KR', 'ISM', 'DOC', 'VRA', 'Noon Report', '引航', '航道', '压载', '油轮'],
  '公众号运营': ['公众号', '爆文', '微信', '粉丝', '阅读量', '排版', '封面', '草稿', '发布'],
  '编程开发': ['代码', '脚本', 'API', 'TypeScript', 'Python', 'HTML', 'CSS', 'PHP', '数据库', 'SQL', 'Git', 'Docker', '编译'],
  'AI与自动化': ['AI', 'Agent', 'LLM', '模型', 'Prompt', '自动化', 'Cron', '定时', '大模型', '深度学习'],
  '投资理财': ['股票', 'A股', '基金', '投资', '行情', '大盘', '涨停', '跌停', '上证'],
  '家庭与生活': ['花店', '芍药', '家里', '孩子', '老婆', '家庭', '老家', '菏泽'],
  '游戏与娱乐': ['游戏', 'SH3', '潜艇', '模组', 'MOD', 'S3D', 'Silent', 'Hunter'],
};

// ── 习惯模式库 ──
const HABIT_PATTERNS = [
  { re: /船期|船位|航行|航线|ETA|到港|离港/i, pattern: '船期查询', freq: 'on_demand' as const },
  { re: /公众号|爆文|发文|文章|排版|封面/i, pattern: '公众号爆文', freq: 'daily' as const },
  { re: /报告|REPORT|文档|生成文档|Word|DOCX/i, pattern: '报告生成', freq: 'weekly' as const },
  { re: /证书|DOC|ISM|检查|审核|审计|合规/i, pattern: '合规检查', freq: 'weekly' as const },
];

// ── 快速领域匹配 ──
function fastDomainMatch(input: string): { domain: string; keywords: string[] }[] {
  const results: { domain: string; keywords: string[] }[] = [];
  for (const [domain, keywords] of Object.entries(DOMAIN_KEYWORDS)) {
    const matched = keywords.filter(kw => input.includes(kw));
    if (matched.length >= 2) results.push({ domain, keywords: matched });
  }
  return results;
}

// ── 公共 API ──

/** 每次对话后调用：自动分析并更新用户画像 */
export async function evolveUserModel(
  conversationSummary: string,
  userInput: string,
  taskSuccess: boolean,
  provider?: Provider,
): Promise<UserModel> {
  const model = loadUserModel();
  model.evolution.totalConversations++;
  model.evolution.lastAnalysisAt = Date.now();

  // ── 轻量分析（无 LLM 调用）──
  // 1. 偏好变化
  for (const [field, hints] of Object.entries(PREFERENCE_HINTS)) {
    for (const { re, value } of hints) {
      if (re.test(userInput)) {
        const old = (model.preferences as any)[field];
        if (old !== value) { (model.preferences as any)[field] = value; model.evolution.preferenceChanges++; }
        break;
      }
    }
  }

  // 2. 领域匹配
  const matched = fastDomainMatch(userInput + ' ' + conversationSummary);
  for (const { domain, keywords } of matched) {
    if (!model.domains[domain]) {
      model.domains[domain] = { weight: 0.3, firstSeen: Date.now(), lastSeen: Date.now(), keywords, taskTypes: [taskSuccess ? 'successful' : 'attempted'] };
      model.evolution.newDomains++;
    } else {
      model.domains[domain].weight = Math.min(1, model.domains[domain].weight + 0.1);
      model.domains[domain].lastSeen = Date.now();
      for (const kw of keywords) { if (!model.domains[domain].keywords.includes(kw)) model.domains[domain].keywords.push(kw); }
    }
  }

  // 衰减旧领域
  const now = Date.now();
  for (const d of Object.values(model.domains)) {
    if ((now - d.lastSeen) / 86400000 > 30) d.weight = Math.max(0, d.weight - 0.05);
  }

  // 3. 习惯检测
  for (const { re, pattern, freq } of HABIT_PATTERNS) {
    if (re.test(userInput)) {
      const existing = model.habits.find(h => h.pattern === pattern);
      if (existing) {
        existing.lastTriggered = Date.now();
        existing.confidence = Math.min(1, existing.confidence + 0.1);
        if (existing.confidence > 0.7) existing.autoReminder = true;
      } else {
        model.habits.push({ pattern, frequency: freq, lastTriggered: Date.now(), autoReminder: false, confidence: 0.3 });
        model.evolution.habitsDetected++;
      }
    }
  }

  // 深度分析（异步，不阻塞）
  if (provider && conversationSummary.length > 50) {
    deepAnalyze(model, conversationSummary, provider).catch(() => {});
  }

  saveUserModel(model);
  return model;
}

// ── 深度 LLM 分析 ──
const ANALYZE_PROMPT = `分析以下对话摘要，只输出 JSON：
{
  "preferenceSignals": [{"field":"reportFormat|tone|detailLevel|codeStyle|responseStyle","newValue":"...","confidence":0.7,"evidence":"..."}],
  "domainSignals": [{"domain":"...","keywords":["..."],"taskType":"...","isNew":true|false}],
  "habitSignals": [{"pattern":"...","frequency":"daily|weekly|on_demand","confidence":0.7}]
}
对话摘要: `;

async function deepAnalyze(model: UserModel, summary: string, provider: Provider): Promise<void> {
  try {
    const msg: ChatMessage = await provider.chat({
      messages: [
        { role: 'system', content: '你是用户行为分析器。只输出 JSON，不要其他文字。' },
        { role: 'user', content: ANALYZE_PROMPT + summary.slice(0, 3000) },
      ],
      stream: false,
    });
    const text = (msg.content || '').trim();
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return;
    const a = JSON.parse(m[0]);
    if (a.preferenceSignals) for (const s of a.preferenceSignals) {
      if (s.confidence > 0.6 && s.field && s.newValue) { (model.preferences as any)[s.field] = s.newValue; model.evolution.preferenceChanges++; }
    }
    if (a.domainSignals) for (const s of a.domainSignals) {
      if (s.domain && s.keywords && !model.domains[s.domain]) {
        model.domains[s.domain] = { weight: 0.5, firstSeen: Date.now(), lastSeen: Date.now(), keywords: s.keywords, taskTypes: [] };
        model.evolution.newDomains++;
      }
    }
    if (a.habitSignals) for (const s of a.habitSignals) {
      if (s.pattern && !model.habits.find(h => h.pattern === s.pattern)) {
        model.habits.push({ pattern: s.pattern, frequency: s.frequency || 'on_demand', lastTriggered: Date.now(), autoReminder: false, confidence: s.confidence || 0.5 });
        model.evolution.habitsDetected++;
      }
    }
    saveUserModel(model);
  } catch { /* 静默失败 */ }
}

/** 生成用户画像摘要（注入系统提示词） */
export function buildUserModelPrompt(model: UserModel): string {
  const lines: string[] = ['\n【用户画像 — 自动演化中】'];
  const p = model.preferences;
  const descs: string[] = [];
  if (p.reportFormat !== 'paragraph') descs.push(`默认用${p.reportFormat === 'table' ? '表格' : '要点'}格式`);
  if (p.tone !== 'casual') descs.push(`语气偏${p.tone === 'formal' ? '正式' : p.tone === 'concise' ? '简练' : '自如'}`);
  if (p.detailLevel !== 'normal') descs.push(`回答${p.detailLevel === 'detailed' ? '尽量详细' : '尽量简洁'}`);
  if (p.responseStyle !== 'action_first') descs.push(`响应风格: ${p.responseStyle === 'plan_first' ? '先给方案再执行' : '先询问再执行'}`);
  if (descs.length) lines.push(`偏好: ${descs.join('，')}`);

  const active = Object.entries(model.domains).filter(([_, d]) => d.weight > 0.3).sort(([_, a], [__, b]) => b.weight - a.weight).slice(0, 5);
  if (active.length) lines.push(`活跃领域: ${active.map(([d]) => d).join('，')}`);

  const reminders = model.habits.filter(h => h.autoReminder && h.confidence > 0.7);
  if (reminders.length) lines.push(`已识别习惯: ${reminders.map(h => `[${h.pattern}，${h.frequency === 'daily' ? '每日' : '每周'}执行]`).join('，')}`);

  lines.push(`进化: ${model.evolution.totalConversations}次对话，${model.evolution.preferenceChanges}次偏好调整，${model.evolution.newDomains}个新领域`);
  return lines.join('\n') + '\n';
}
