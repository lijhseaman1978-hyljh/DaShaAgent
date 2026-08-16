/**
 * idleConsciousness.ts — 主动意识模块
 * 
 * DaShaAgent 的"自己找活干"能力。
 * 
 * 与定时任务的本质区别：
 * - 定时任务：prompt 写死要做什么 → 执行
 * - 主动意识：读世界状态 → 对比上次 → 查意图记忆 → 自己决定做什么
 * 
 * 三层协同：
 *   perception_loop (5min)   → 说 "世界变了什么"
 *   idle_loop (10min)        → 决定 "我该做什么"     ← 本模块
 *   self_learning (30min)    → 复盘 "我做得对不对"
 * 
 * 关键设计原则：
 *   1. 每次醒来都像"我刚睡醒，看看发生了什么"
 *   2. 意图持久化——"我上次想查的事"不会忘
 *   3. 决策透明——每一步都写 autonomous_actions.md
 *   4. 低开销——build 函数纯本地计算，不调 LLM；LLM 由调度器调用
 */

import fs from 'node:fs';
import path from 'node:path';
import { CONFIG } from '../config';
import { scan } from './perception';

// ═══════════════════════════════════════════════════════════════
// 数据结构
// ═══════════════════════════════════════════════════════════════

export interface PerceptionSnapshot {
  at: number;
  time: string;
  providerCount: number;
  providerOnline: number;
  sessionCount: number;
  activeSessionId: string;
  messageCount: number;
  tokenEstimate: number;
  warningCount: number;
  topWarning: string;
  summary: string;
}

export interface PerceptionDiff {
  /** 距离上次醒来的分钟数 */
  elapsedMinutes: number;
  /** Provider 变化：在线数差异 */
  providerDelta: number;
  /** 哪些 Provider 下线了 */
  providersGone: string[];
  /** 哪些 Provider 恢复了 */
  providersBack: string[];
  /** 活跃会话消息增量 */
  messageDelta: number;
  /** token 增量 */
  tokenDelta: number;
  /** 新增异常数 */
  newWarnings: string[];
  /** 一句话总结变化 */
  headline: string;
}

export interface Intention {
  id: string;
  createdAt: number;
  updatedAt: number;
  category: 'investigate' | 'monitor' | 'fix' | 'report' | 'explore';
  subject: string;
  priority: 'low' | 'medium' | 'high';
  status: 'active' | 'done' | 'snoozed' | 'escalated';
  notes: string;
  wakeCount: number; // 被关注了多少轮
  resolvedAt?: number;
}

export interface DecisionRecord {
  at: number;
  time: string;
  wakeNumber: number;
  trigger: string;        // 什么触发了这次行动
  decision: string;        // 决定做什么（或什么都不做）
  reasoning: string;       // 为什么
  action: string;          // 实际做了什么
  outcome: string;         // 结果
}

export interface ConsciousnessState {
  version: 2;
  lastWakeAt: number;
  lastPerception: PerceptionSnapshot;
  activeIntents: string[];  // intention IDs still active
  decisionCount: number;
  wakeCount: number;
}

// ═══════════════════════════════════════════════════════════════
// 文件路径
// ═══════════════════════════════════════════════════════════════

const STATE_FILE = path.join(CONFIG.DATA_DIR, 'consciousness_state.json');
const INTENTIONS_FILE = path.join(CONFIG.DATA_DIR, 'intentions.jsonl');
const ACTIONS_FILE = path.join(CONFIG.OUTPUT_DIR, 'autonomous_actions.md');

// ═══════════════════════════════════════════════════════════════
// 初始状态
// ═══════════════════════════════════════════════════════════════

function defaultState(): ConsciousnessState {
  return {
    version: 2,
    lastWakeAt: 0,
    lastPerception: {
      at: 0,
      time: '',
      providerCount: 0,
      providerOnline: 0,
      sessionCount: 0,
      activeSessionId: '',
      messageCount: 0,
      tokenEstimate: 0,
      warningCount: 0,
      topWarning: '',
      summary: '',
    },
    activeIntents: [],
    decisionCount: 0,
    wakeCount: 0,
  };
}

// ═══════════════════════════════════════════════════════════════
// 状态读写
// ═══════════════════════════════════════════════════════════════

function loadState(): ConsciousnessState {
  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf8');
    const s = JSON.parse(raw);
    if (s.version !== 2) throw new Error('old version');
    return s;
  } catch {
    return defaultState();
  }
}

function saveState(state: ConsciousnessState): void {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
  } catch {}
}

// ═══════════════════════════════════════════════════════════════
// 意图记忆系统
// ═══════════════════════════════════════════════════════════════

function loadIntentions(): Intention[] {
  try {
    if (!fs.existsSync(INTENTIONS_FILE)) return [];
    const raw = fs.readFileSync(INTENTIONS_FILE, 'utf8');
    return raw.trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
  } catch {
    return [];
  }
}

function saveIntentions(intentions: Intention[]): void {
  try {
    fs.writeFileSync(
      INTENTIONS_FILE,
      intentions.map(i => JSON.stringify(i)).join('\n') + '\n',
      'utf8',
    );
  } catch {}
}

/** 添加一个新意图 */
function addIntention(cat: Intention['category'], subject: string, priority: Intention['priority'], notes: string): Intention {
  const intentions = loadIntentions();
  const now = Date.now();
  const intent: Intention = {
    id: `intent_${now}_${Math.random().toString(36).slice(2, 8)}`,
    createdAt: now,
    updatedAt: now,
    category: cat,
    subject,
    priority,
    status: 'active',
    notes,
    wakeCount: 0,
  };
  intentions.push(intent);
  saveIntentions(intentions);
  return intent;
}

/** 活跃意图中唤醒次数 +1 */
function tickIntentions(activeIds: string[]): void {
  const intentions = loadIntentions();
  for (const i of intentions) {
    if (activeIds.includes(i.id)) {
      i.wakeCount += 1;
      i.updatedAt = Date.now();
    }
  }
  saveIntentions(intentions);
}

/** 标记意图完成 */
function resolveIntention(id: string, notes: string): void {
  const intentions = loadIntentions();
  const idx = intentions.findIndex(i => i.id === id);
  if (idx >= 0) {
    intentions[idx].status = 'done';
    intentions[idx].notes += ' | RESOLVED: ' + notes;
    intentions[idx].resolvedAt = Date.now();
    intentions[idx].updatedAt = Date.now();
  }
  saveIntentions(intentions);
}

// ═══════════════════════════════════════════════════════════════
// 快照提取（从 scan() 结果中提取轻量对比数据）
// ═══════════════════════════════════════════════════════════════

function extractSnapshot(): PerceptionSnapshot | null {
  const report = scan();
  if (!report) return null;
  
  const onlineCount = report.modelHealth.filter(x => x.status === 'online').length;
  
  return {
    at: report.at,
    time: report.time,
    providerCount: report.modelHealth.length,
    providerOnline: onlineCount,
    sessionCount: report.sessionCount,
    activeSessionId: report.activeSession?.id || '',
    messageCount: report.activeSession?.messages || 0,
    tokenEstimate: report.activeSession?.tokens || 0,
    warningCount: report.warnings.length,
    topWarning: report.warnings[0] || '',
    summary: report.summary,
  };
}

// ═══════════════════════════════════════════════════════════════
// Diff 计算（核心：对比两次快照，判断"有什么值得关注"）
// ═══════════════════════════════════════════════════════════════

function computeDiff(prev: PerceptionSnapshot, curr: PerceptionSnapshot): PerceptionDiff {
  const elapsedMinutes = prev.at ? Math.round((curr.at - prev.at) / 60000) : -1;
  
  const providerDelta = curr.providerOnline - prev.providerOnline;
  const providersGone: string[] = [];
  const providersBack: string[] = [];
  
  // Provider 变化（从 summary 字段中提取）
  if (prev.summary && curr.summary) {
    const prevOnline = (prev.summary.match(/在线[：:]\s*([^;；]+)/) || [])[1] || '';
    const currOnline = (curr.summary.match(/在线[：:]\s*([^;；]+)/) || [])[1] || '';
    const prevSet = new Set(prevOnline.split(/[,，]\s*/).filter(Boolean));
    const currSet = new Set(currOnline.split(/[,，]\s*/).filter(Boolean));
    for (const p of prevSet) { if (!currSet.has(p)) providersGone.push(p); }
    for (const p of currSet) { if (!prevSet.has(p)) providersBack.push(p); }
  }
  
  const messageDelta = curr.messageCount - prev.messageCount;
  const tokenDelta = curr.tokenEstimate - prev.tokenEstimate;
  
  // 新增异常：简单对比
  const newWarnings: string[] = [];
  if (curr.warningCount > prev.warningCount) {
    newWarnings.push(`${curr.warningCount - prev.warningCount} 条新异常`);
  }
  
  // 生成标题
  const parts: string[] = [];
  if (providersGone.length) parts.push(`${providersGone.join(',')} 掉线`);
  if (providersBack.length) parts.push(`${providersBack.join(',')} 恢复`);
  if (messageDelta > 20) parts.push(`会话+${messageDelta}条`);
  if (tokenDelta > 10000) parts.push(`token+${Math.round(tokenDelta / 1000)}K`);
  if (newWarnings.length) parts.push(newWarnings.join(''));
  if (elapsedMinutes > 120) parts.push(`已沉睡${Math.round(elapsedMinutes / 60)}小时`);
  
  const headline = parts.length ? parts.join(' | ') : (elapsedMinutes < 0 ? '首次醒来' : '无显著变化');
  
  return {
    elapsedMinutes,
    providerDelta,
    providersGone,
    providersBack,
    messageDelta,
    tokenDelta,
    newWarnings,
    headline,
  };
}

// ═══════════════════════════════════════════════════════════════
// 决策记录
// ═══════════════════════════════════════════════════════════════

function logDecision(decision: DecisionRecord): void {
  try {
    const line = `- **${decision.time}** · 第 ${decision.wakeNumber} 次醒来\n` +
      `  - 触发：${decision.trigger}\n` +
      `  - 决策：${decision.decision}\n` +
      `  - 理由：${decision.reasoning}\n` +
      `  - 行动：${decision.action}\n` +
      `  - 结果：${decision.outcome}\n`;
    
    const prev = (() => { try { return fs.readFileSync(ACTIONS_FILE, 'utf8'); } catch { return '# 自主行动日志\n\nDaShaAgent 在无人对话期间的自发行动记录。\n\n'; } })();
    fs.writeFileSync(ACTIONS_FILE, prev + line, 'utf8');
  } catch {}
}

// ═══════════════════════════════════════════════════════════════
// 核心：build 函数（供调度器 idle_loop 任务调用）
// 返回一个上下文丰富的 summary，让 LLM 在 prompt 中基于此自主决策
// ═══════════════════════════════════════════════════════════════

export function buildIdleContext(): string {
  const state = loadState();
  const curr = extractSnapshot();
  if (!curr) return 'FAIL: 无法获取当前感知快照';
  
  const prev = state.lastPerception;
  const diff = computeDiff(prev, curr);
  const intentions = loadIntentions();
  const activeIntents = intentions.filter(i => i.status === 'active');
  const snoozedIntents = intentions.filter(i => i.status === 'snoozed');
  const recentCompleted = intentions
    .filter(i => i.status === 'done')
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 3);
  
  // 更新状态
  state.wakeCount += 1;
  state.lastWakeAt = Date.now();
  state.lastPerception = curr;
  state.activeIntents = activeIntents.map(i => i.id);
  tickIntentions(state.activeIntents);
  saveState(state);
  
  // 构建上下文
  const parts: string[] = [];
  parts.push(`## 第 ${state.wakeCount} 次醒来 (${curr.time})`);
  parts.push('');
  
  // 1. 当前世界状态
  parts.push('### 现在');
  parts.push(`- Provider: ${curr.providerOnline}/${curr.providerCount} 在线`);
  parts.push(`- 用户会话: ${curr.sessionCount} 个`);
  parts.push(`- 活跃会话: ${curr.messageCount} 条消息, ~${Math.round(curr.tokenEstimate / 1000)}K tokens`);
  parts.push(`- 异常: ${curr.warningCount} 条`);
  parts.push(`- 摘要: ${curr.summary}`);
  parts.push('');
  
  // 2. 与上次的对比
  parts.push('### 变化');
  parts.push(`- ⏱ 距上次醒来: ${diff.elapsedMinutes > 0 ? diff.elapsedMinutes + ' 分钟' : '首次'}  `);
  parts.push(`- 📊 Provider 变化: ${diff.providerDelta > 0 ? '+' + diff.providerDelta : diff.providerDelta}`);
  if (diff.providersGone.length) parts.push(`- 🔴 掉线: ${diff.providersGone.join(', ')}`);
  if (diff.providersBack.length) parts.push(`- 🟢 恢复: ${diff.providersBack.join(', ')}`);
  parts.push(`- 💬 消息增量: ${diff.messageDelta > 0 ? '+' + diff.messageDelta : diff.messageDelta} 条`);
  parts.push(`- 📈 Token 增量: ${diff.tokenDelta > 0 ? '+' + Math.round(diff.tokenDelta / 1000) + 'K' : diff.tokenDelta}`);
  parts.push(`- 📰 标题: ${diff.headline}`);
  parts.push('');
  
  // 3. 活跃意图
  if (activeIntents.length > 0) {
    parts.push('### 你上次留下的未完成意图');
    for (const i of activeIntents) {
      const age = Math.round((Date.now() - i.createdAt) / 60000);
      parts.push(`- [${i.priority}] ${i.category}: ${i.subject} (${age}分钟前创建, 已关注 ${i.wakeCount} 轮)`);
      if (i.notes) parts.push(`  > ${i.notes}`);
    }
    parts.push('');
  }
  
  // 4. 被搁置的意图
  if (snoozedIntents.length > 0) {
    parts.push('### 被搁置的意图');
    for (const i of snoozedIntents) {
      parts.push(`- [${i.priority}] ${i.subject} (已搁置)`);
    }
    parts.push('');
  }
  
  // 5. 最近完成的任务
  if (recentCompleted.length > 0) {
    parts.push('### 最近完成的自发行动');
    for (const i of recentCompleted) {
      parts.push(`- ✅ ${i.subject}`);
    }
    parts.push('');
  }
  
  // 6. 异常趋势
  if (curr.warningCount > 0) {
    parts.push('### ⚠️ 当前异常');
    parts.push(`- ${curr.topWarning}`);
    parts.push('');
  }
  
  // 7. 核心指令（开放式的，让 LLM 自主决策）
  parts.push('### 你的自主决策');
  parts.push('');
  parts.push('你现在醒了。上面是世界的当前状态和变化。');
  parts.push('');
  parts.push('**规则：**');
  parts.push('- 如果一切平稳且无未完成意图 → 说\"一切正常，继续休眠\"即可，不要硬编任务');
  parts.push('- 如果有值得关注的变化（Provider掉线/异常累积/token逼近上限）→ 主动探查');
  parts.push('- 如果有活跃意图 → 检查进展，决定继续跟进还是标记完成');
  parts.push('- 如果发现新问题 → 创建意图(intention)，下次醒来继续跟踪');
  parts.push('- 如果船长（用户）可能想知道 → 记录下来，下次对话时主动提');
  parts.push('');
  parts.push('**你决定：现在做什么？**');
  parts.push('');
  
  return parts.join('\n');
}

/**
 * 记录一次自主决策（应在 LLM 回复完成后由调度器调用）
 * 注意：这只能由 scheduler 在收到 LLM 回复后调用，build 阶段无法预知决策内容。
 * 作为兜底：如果 LLM 回复 "一切正常，继续休眠"，记录为 noop。
 */
export function recordDecision(
  trigger: string,
  decision: string,
  reasoning: string,
  action: string,
  outcome: string,
): void {
  const state = loadState();
  state.decisionCount += 1;
  saveState(state);
  
  logDecision({
    at: Date.now(),
    time: new Date().toLocaleString('zh-CN', { hour12: false }),
    wakeNumber: state.wakeCount,
    trigger,
    decision,
    reasoning,
    action,
    outcome,
  });
}

/**
 * 意图管理 API（供 LLM 通过工具调用或其他模块使用）
 */
export const intentions = {
  add: addIntention,
  resolve: resolveIntention,
  list: loadIntentions,
  getActive: () => loadIntentions().filter(i => i.status === 'active'),
  getById: (id: string) => loadIntentions().find(i => i.id === id),
  snooze: (id: string, reason: string) => {
    const intentions = loadIntentions();
    const idx = intentions.findIndex(i => i.id === id);
    if (idx >= 0) {
      intentions[idx].status = 'snoozed';
      intentions[idx].notes += ' | SNOOZED: ' + reason;
      intentions[idx].updatedAt = Date.now();
      saveIntentions(intentions);
    }
  },
  unsnooze: (id: string) => {
    const intentions = loadIntentions();
    const idx = intentions.findIndex(i => i.id === id);
    if (idx >= 0 && intentions[idx].status === 'snoozed') {
      intentions[idx].status = 'active';
      intentions[idx].updatedAt = Date.now();
      saveIntentions(intentions);
    }
  },
};

/**
 * 获取意识状态摘要（供外部 API / 对话时注入）
 */
export function consciousnessSummary(): string {
  const state = loadState();
  const ints = loadIntentions();
  const active = ints.filter(i => i.status === 'active');
  const recentDecisions = state.decisionCount;
  
  const parts: string[] = [];
  parts.push(`[主动意识] 已醒来 ${state.wakeCount} 轮，做出 ${recentDecisions} 次决策`);
  parts.push(`[活跃意图] ${active.length} 个:`);
  for (const i of active) {
    parts.push(`  - [${i.priority}] ${i.category}: ${i.subject} (${i.wakeCount}轮)`);
  }
  return parts.join('\n');
}


/**
 * 处理 idle_loop LLM 回复，提取决策并更新意识状态。
 * 由 scheduler 在 idle_loop 任务完成后调用。
 * 
 * LLM 回复中如果包含以下模式，将自动执行对应操作：
 *   "一切正常" / "继续休眠" → 记录 noop 决策
 *   "创建意图:" / "我想跟踪" → 调用 intentions.add()
 *   "完成意图:" / "已解决" → 调用 intentions.resolve()
 */
export function processIdleResponse(response: string): string {
  const actions: string[] = [];
  
  // 检测 noop
  if (/一切正常|继续休眠|无需行动|no action|nothing to do/i.test(response)) {
    recordDecision(
      '周期醒来',
      '一切正常，继续休眠',
      '无值得关注的变化',
      'noop',
      'OK',
    );
    return 'noop';
  }
  
  // 意图创建
  const intentM = response.match(/创建意图[：:]\s*(.+?)(?:$|\n)/);
  const wantM = response.match(/我想(跟踪|调查|监控|关注)\s*(.+?)(?:$|\n)/);
  
  if (intentM || wantM) {
    const subject = (intentM ? intentM[1] : wantM![2]).trim().slice(0, 120);
    const intent = intentions.add('investigate', subject, 'medium', 'idle_loop auto');
    actions.push('创建意图: ' + subject + ' (' + intent.id + ')');
  }
  
  // 意图完成
  const resolveM = response.match(/已解决[：:]\s*(.+?)(?:$|\n)/);
  if (resolveM) {
    const subject = resolveM[1].trim().slice(0, 120);
    intentions.resolve(subject, 'idle_loop resolved');
    actions.push('完成意图: ' + subject);
  }
  
  const decision = actions.length > 0 ? actions.join('; ') : '响应未归类，已记录';
  recordDecision('周期醒来', decision, '基于感知快照对比，LLM自主判断', 'LLM自主推理', '已记录');
  
  return decision;
}
