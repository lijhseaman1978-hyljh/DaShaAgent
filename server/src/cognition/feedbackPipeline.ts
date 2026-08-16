/**
 * feedbackPipeline.ts — 隐式反馈提取管道
 * 
 * 从用户对话中自动提取情感/态度信号，建立反馈闭环。
 * 
 * 设计原则：
 *   1. 零外部依赖：纯文本正则匹配 + 关键词检测
 *   2. 保守编码：只标记明确的评价词汇，沉默/中性不编码
 *   3. 累积分析：feedback_log.jsonl 按时间累积，定期生成趋势报告
 * 
 * 集成点：self_learning 每 30 分钟调用 extractAndLog()，将反馈信号附加到复盘上下文
 */

import fs from 'node:fs';
import path from 'node:path';
import { CONFIG } from '../config';

// ═══════════════════════════════════════════════════════════════
// 数据结构
// ═══════════════════════════════════════════════════════════════

export interface FeedbackSignal {
  /** 时间戳 */
  at: number;
  /** 来源会话 ID */
  sessionId: string;
  /** 在会话中的消息序号（从 1 开始） */
  messageIndex: number;
  /** 用户消息原文（截断至 200 字符） */
  userMessage: string;
  /** 前一 AI 回复摘要（截断至 200 字符） */
  aiContext: string;
  /** 信号极性：+1 正向 / 0 中性 / -1 负向 */
  polarity: number;
  /** 置信度 0-1 */
  confidence: number;
  /** 匹配到的具体模式 */
  matchedPatterns: string[];
  /** 信号类别 */
  category: 'explicit_praise' | 'explicit_correction' | 'implicit_approval' | 'implicit_dissatisfaction' | 'task_continuation' | 'clarification_request';
}

export interface FeedbackSummary {
  /** 分析时间窗口 */
  windowStart: number;
  windowEnd: number;
  /** 总信号数 */
  totalSignals: number;
  /** 正/中/负 分布 */
  positiveCount: number;
  neutralCount: number;
  negativeCount: number;
  /** 按类别的分布 */
  byCategory: Record<string, number>;
  /** 高频正向主题 */
  topPraised: string[];
  /** 高频负向主题 */
  topCriticized: string[];
  /** 趋势：与上一窗口对比 */
  trend: 'improving' | 'declining' | 'stable' | 'first_window';
}

// ═══════════════════════════════════════════════════════════════
// 信号检测规则
// ═══════════════════════════════════════════════════════════════

interface DetectionRule {
  patterns: RegExp[];
  polarity: number;
  confidence: number;
  category: FeedbackSignal['category'];
}

const RULES: DetectionRule[] = [
  // ── 明确正向 ──
  {
    patterns: [
      /干得好|做得不错|很好[！!。.]|非常好|完美[！!。.]|这就是我要的|对了[！!。.]/,
      /问题已解决|可以了|没问题了|搞定了|正是如此/,
      /厉害|牛[！!逼B]|不错[！!。.]/,
      /满意|到位|靠谱/,
      /谢谢[！!。.]|感谢/,
      /完美|赞|棒|好极了|正是我要的|就是我要的/,
      /多谢/,
    ],
    polarity: 1,
    confidence: 0.95,
    category: 'explicit_praise',
  },
  // ── 明确纠正 ──
  {
    patterns: [
      /不对[！!。.]|错了[！!。.]|有问题|不对的|这个是错的/,
      /重新[来做过]|再[试查做]一[次遍下]/,
      /不是这样|你理解错了|你没有理解/,
      /还是不行|还是没[有改]|依然[没有不]/,
      /我不是让你|我要的不是/,
      /别[再乱瞎编]|不要[再乱瞎编]/,
      /搞错|理解错|不是这样|不是你要/,
      /重新|再(来|做|试|查)|你(弄|搞|做)错/,
    ],
    polarity: -1,
    confidence: 0.90,
    category: 'explicit_correction',
  },
  // ── 隐式认可（继续推进而非纠正） ──
  {
    patterns: [
      /^继续[。.!！\s]*$|^继续下一步|^接着[做干]/,
      /^好的[。.!！\s]*$|^OK[。.!！\s]*$/i,
      /^行[。.!！\s]*$|^可以[。.!！\s]*$/,
      /好的|行|可以|OK/i,
      /继续|接着做|接着干|下一步/,
    ],
    polarity: 1,
    confidence: 0.55,  // 低置信度：简短确认可能是礼貌敷衍
    category: 'implicit_approval',
  },
  // ── 隐式不满 ──
  {
    patterns: [
      /怎么还[是没在]/,
      /我[等]了[好久半天]/,
      /太慢[了]|能快[点些]吗/,
      /你不[懂明白]|你没听懂/,
      /太慢|慢了|快[点些]|等(了|这么久)|怎么还|还(不|没)/,
      /不懂|没听懂|听不懂|不明白/,
    ],
    polarity: -1,
    confidence: 0.70,
    category: 'implicit_dissatisfaction',
  },
  // ── 澄清请求（中性但说明理解有偏差） ──
  {
    patterns: [
      /你是说|你的意思是|我理解你|你的理解/,
      /到底是什么|到底[是怎]|究竟/,
      /请[你]解释|说明[一下]|再[说讲]清楚/,
      /什么意思|到底是|究竟|解释|说清楚|你的意思|你是说|我理解/,
      /重做|改一下|调整|优化|补充|完善/,
    ],
    polarity: -0.3,  // 轻度负向：需要澄清 = 上一次回答不够清晰
    confidence: 0.60,
    category: 'clarification_request',
  },
];

// ═══════════════════════════════════════════════════════════════
// 文件路径
// ═══════════════════════════════════════════════════════════════

const FEEDBACK_FILE = path.join(CONFIG.DATA_DIR, 'feedback_log.jsonl');
const SESSIONS_FILE = path.join(CONFIG.MEMORY_DIR, 'sessions.json');
const CHECKPOINT_FILE = path.join(CONFIG.WORKSPACE_DIR, 'notes', 'feedback_checkpoint.md');

// ═══════════════════════════════════════════════════════════════
// 核心函数
// ═══════════════════════════════════════════════════════════════

/** 对单条用户消息做情感检测 */
function detectSignals(userMsg: string, aiContext: string, sessionId: string, msgIndex: number): FeedbackSignal[] {
  const signals: FeedbackSignal[] = [];
  
  for (const rule of RULES) {
    for (const pattern of rule.patterns) {
      pattern.lastIndex = 0;
      if (pattern.test(userMsg)) {
        signals.push({
          at: Date.now(),
          sessionId,
          messageIndex: msgIndex,
          userMessage: userMsg.slice(0, 200),
          aiContext: aiContext.slice(0, 200),
          polarity: rule.polarity,
          confidence: rule.confidence,
          matchedPatterns: [pattern.source],
          category: rule.category,
        });
        break; // 每条规则只匹配一次
      }
    }
  }
  
  return signals;
}

/** 读取上次检查点时间戳 */
function readCheckpoint(): number {
  try {
    const raw = fs.readFileSync(CHECKPOINT_FILE, 'utf8');
    const m = /(\d{13})/.exec(raw);
    return m ? parseInt(m[1], 10) : 0;
  } catch {
    return 0;
  }
}

/** 写入检查点 */
function writeCheckpoint(ts: number): void {
  try {
    fs.writeFileSync(CHECKPOINT_FILE, `feedback_checkpoint: ${ts}\n`, 'utf8');
  } catch {}
}

/** 从 sessions.json 中提取上次检查点以来的新反馈信号 */
function extractNewSignals(): FeedbackSignal[] {
  try {
    const arr: any[] = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'));
    const checkpoint = readCheckpoint();
    const allSignals: FeedbackSignal[] = [];
    let maxTs = checkpoint;
    
    for (const session of arr) {
      const sid = String(session.id || '');
      if (sid.startsWith('job_')) continue;
      
      const msgs: any[] = session.messages || [];
      for (let i = 1; i < msgs.length; i++) {
        const msg = msgs[i];
        // BUG-FIX: 会话消息的时间字段是 `ts`（见 core/session.ts 的 StoredMessage），
        // 此前误读为 `timestamp`（恒为 undefined → 0），导致所有消息被 checkpoint 跳过、永远抽不到信号。
        // 用 `ts` 为主、`timestamp` 为兼容兜底。
        const msgTs = typeof msg.ts === 'number' ? msg.ts : (msg.timestamp ?? 0);
        if (msgTs <= checkpoint) continue;
        if (msgTs > maxTs) maxTs = msgTs;
        
        // 只分析用户消息（role === 'user'）
        if (msg.role !== 'user') continue;
        
        const userContent = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content || '');
        
        // 前一 AI 回复作为上下文
        let aiContext = '';
        for (let j = i - 1; j >= 0; j--) {
          if (msgs[j].role === 'assistant') {
            aiContext = typeof msgs[j].content === 'string' ? msgs[j].content : '';
            break;
          }
        }
        
        const signals = detectSignals(userContent, aiContext, sid, i + 1);
        allSignals.push(...signals);
      }
    }
    
    if (maxTs > checkpoint) {
      writeCheckpoint(maxTs);
    }
    
    return allSignals;
  } catch (e: any) {
    console.error('[反馈管道] 扫描失败:', e?.message || e);
    return [];
  }
}

/** 将信号写入 feedback_log.jsonl */
function appendToLog(signals: FeedbackSignal[]): void {
  try {
    if (signals.length === 0) {
      // 零信号也写心跳，证明调度链路通畅、可被审计（回应"FeedbackPipeline 无数据"质疑）
      fs.appendFileSync(FEEDBACK_FILE, JSON.stringify({ _heartbeat: true, at: Date.now(), signals: 0 }) + '\n', 'utf8');
      return;
    }
    const lines = signals.map(s => JSON.stringify(s)).join('\n') + '\n';
    fs.appendFileSync(FEEDBACK_FILE, lines, 'utf8');
  } catch {}
}

/** 读取全部反馈日志 */
function readAllFeedback(): FeedbackSignal[] {
  try {
    if (!fs.existsSync(FEEDBACK_FILE)) return [];
    const raw = fs.readFileSync(FEEDBACK_FILE, 'utf8');
    return raw.trim().split('\n').filter(Boolean)
      .map(l => { try { return JSON.parse(l); } catch { return null; } })
      .filter((s): s is FeedbackSignal => s !== null && !(s as { _heartbeat?: boolean })._heartbeat);
  } catch {
    return [];
  }
}

/** 生成反馈摘要（供 self_learning 使用） */
function generateSummary(): FeedbackSummary {
  const all = readAllFeedback();
  
  // 只分析最近 24 小时
  const now = Date.now();
  const window = all.filter(s => s.at > now - 86400000);
  const prevWindow = all.filter(s => s.at > now - 172800000 && s.at <= now - 86400000);
  
  const pos = window.filter(s => s.polarity > 0.3);
  const neg = window.filter(s => s.polarity < -0.3);
  
  const byCategory: Record<string, number> = {};
  for (const s of window) {
    byCategory[s.category] = (byCategory[s.category] || 0) + 1;
  }
  
  // 高频主题（从 matchedPatterns 提取）
  const praisePatterns: Record<string, number> = {};
  const criticizePatterns: Record<string, number> = {};
  for (const s of pos) {
    for (const p of s.matchedPatterns) {
      praisePatterns[p] = (praisePatterns[p] || 0) + 1;
    }
  }
  for (const s of neg) {
    for (const p of s.matchedPatterns) {
      criticizePatterns[p] = (criticizePatterns[p] || 0) + 1;
    }
  }
  
  const topPraised = Object.entries(praisePatterns)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([k, v]) => `"${k}" ×${v}`);
  const topCriticized = Object.entries(criticizePatterns)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([k, v]) => `"${k}" ×${v}`);
  
  // 趋势判定
  let trend: FeedbackSummary['trend'] = 'first_window';
  if (prevWindow.length > 0) {
    const prevPos = prevWindow.filter(s => s.polarity > 0.3).length;
    const prevNeg = prevWindow.filter(s => s.polarity < -0.3).length;
    const currRatio = pos.length / Math.max(neg.length, 1);
    const prevRatio = prevPos / Math.max(prevNeg, 1);
    if (currRatio > prevRatio * 1.2) trend = 'improving';
    else if (currRatio < prevRatio * 0.8) trend = 'declining';
    else trend = 'stable';
  }
  
  return {
    windowStart: now - 86400000,
    windowEnd: now,
    totalSignals: window.length,
    positiveCount: pos.length,
    neutralCount: window.length - pos.length - neg.length,
    negativeCount: neg.length,
    byCategory,
    topPraised,
    topCriticized,
    trend,
  };
}

// ═══════════════════════════════════════════════════════════════
// 公开 API
// ═══════════════════════════════════════════════════════════════

/** 
 * 主入口：提取新信号 + 写入日志 + 生成摘要
 * 供 self_learning 的 build 函数调用
 */
export function extractAndLog(): string {
  const signals = extractNewSignals();
  appendToLog(signals);
  const summary = generateSummary();
  
  const parts: string[] = [];
  parts.push('[反馈管道] 本轮扫描结果：');
  parts.push(`- 新信号: ${signals.length} 条`);
  if (signals.length > 0) {
    const pos = signals.filter(s => s.polarity > 0.3).length;
    const neg = signals.filter(s => s.polarity < -0.3).length;
    parts.push(`  - 正向: ${pos} | 负向: ${neg} | 中性: ${signals.length - pos - neg}`);
  }
  parts.push(`- 24h 窗口: ${summary.totalSignals} 条信号 (👍${summary.positiveCount} 👎${summary.negativeCount})`);
  parts.push(`- 趋势: ${summary.trend}`);
  if (summary.topPraised.length) parts.push(`- 高频赞赏: ${summary.topPraised.join('; ')}`);
  if (summary.topCriticized.length) parts.push(`- 高频批评: ${summary.topCriticized.join('; ')}`);
  
  // 分类详情
  if (Object.keys(summary.byCategory).length > 0) {
    const catStr = Object.entries(summary.byCategory)
      .map(([k, v]) => `${k}:${v}`)
      .join(', ');
    parts.push(`- 类别分布: ${catStr}`);
  }
  
  return parts.join('\n');
}

/** 供外部查询的反馈总览 */
export function feedbackOverview(): { summary: FeedbackSummary; recentSignals: FeedbackSignal[] } {
  return {
    summary: generateSummary(),
    recentSignals: readAllFeedback().slice(-20),
  };
}

/** 获取反馈文件中的总记录数 */
export function feedbackCount(): number {
  try {
    if (!fs.existsSync(FEEDBACK_FILE)) return 0;
    return fs.readFileSync(FEEDBACK_FILE, 'utf8').trim().split('\n').filter(Boolean).length;
  } catch { return 0; }
}

/** 清空反馈日志（调试用） */
export function resetFeedback(): void {
  try { fs.writeFileSync(FEEDBACK_FILE, '', 'utf8'); } catch {}
}
