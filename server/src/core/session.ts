import fs from 'node:fs';
import path from 'node:path';
import { CONFIG, ensureDir } from '../config';
import type { Session, StoredMessage } from './types';

const SESSIONS_FILE = path.join(CONFIG.MEMORY_DIR, 'sessions.json');

class SessionManager {
  private sessions = new Map<string, Session>();
  /** 每个会话的压缩串行队列，防止并发写坏 sessions.json */
  private compressQueue = new Map<string, Promise<void>>();

  constructor() { this.load(); }

  private load() {
    try {
      const arr: Session[] = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'));
      for (const s of arr) this.sessions.set(s.id, s);
    } catch { /* 空 */ }
  }
  private save() {
    ensureDir(CONFIG.MEMORY_DIR);
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify([...this.sessions.values()], null, 2), 'utf8');
  }

  getOrCreate(id: string): Session {
    let s = this.sessions.get(id);
    if (!s) {
      const now = Date.now();
      s = { id, messages: [], createdAt: now, updatedAt: now };
      this.sessions.set(id, s);
    }
    return s;
  }

  append(id: string, msg: Omit<StoredMessage, 'ts'>) {
    const s = this.getOrCreate(id);
    // 首条用户消息作为会话标题
    if (!s.title && msg.role === 'user' && msg.content) {
      const t = String(msg.content).replace(/\s+/g, ' ').trim();
      s.title = t.length > 24 ? t.slice(0, 24) + '…' : t;
    }
    s.messages.push({ ...msg, ts: Date.now() });
    s.updatedAt = Date.now();
    // 硬截断兜底（默认 500 条；正常由下方自动压缩在阈值处接管，此处仅防极端失控）
    const hardCap = Math.max(CONFIG.COMPRESS_KEEP * 3, 500);
    if (s.messages.length > hardCap) {
      let tail = s.messages.slice(-hardCap);
      tail = this._extendPastOrphanTools(s.messages, tail);
      s.messages = tail;
    }
    // 自动压缩触发 — 估算 token 超过阈值(默认 100000) 且消息数超过保留上限(默认 80)
    const keepLast = CONFIG.COMPRESS_KEEP;
    if (s.messages.length > keepLast) {
      let tokenSum = 0;
      for (const m of s.messages) {
        tokenSum += SessionManager.estimateTokens(typeof m.content === 'string' ? m.content : JSON.stringify(m.content || ''));
        // BUG-FIX(2026-08-08)：与 tokenStats() 口径一致，tool_calls 也计入 token，
        // 否则前端显示已超阈值但压缩永不触发（如显示 13.5 万实际判断仅 8.9 万）
        if (m.tool_calls) tokenSum += SessionManager.estimateTokens(JSON.stringify(m.tool_calls));
      }
      const hasRecentSummary = s.messages.slice(-25).some(m => m.role === 'system' && String(m.content || '').includes('压缩'));
      if (tokenSum > CONFIG.COMPRESS_THRESHOLD && !hasRecentSummary) {
        console.log(`[Session] 自动压缩触发: session=${id}, tokens≈${tokenSum}, msgs=${s.messages.length}, keep=${keepLast}`);
        this.enqueueCompress(id, tokenSum);
      }
    }
    this.save();
  }

  get(id: string): Session | undefined { return this.sessions.get(id); }

  // 粗估 token 数：CJK 字符约 1 token/字，其余约每 4 字符 1 token（仅用于上下文用量提示）
  static estimateTokens(text: string | null | undefined): number {
    if (!text) return 0;
    let cjk = 0, other = 0;
    for (const ch of String(text)) {
      const code = ch.codePointAt(0) || 0;
      if ((code >= 0x2e80 && code <= 0xfaff) || (code >= 0xff00 && code <= 0xffef) || (code >= 0x3000 && code <= 0x303f)) cjk++;
      else other++;
    }
    return Math.ceil(cjk * 1 + other / 4);
  }

  // 当前会话上下文累计消耗的 token 估算
  tokenStats(id: string): { tokens: number; messages: number } {
    const s = this.getOrCreate(id);
    let tokens = 0;
    for (const m of s.messages) {
      tokens += SessionManager.estimateTokens(typeof m.content === 'string' ? m.content : JSON.stringify(m.content || ''));
      if (m.tool_calls) tokens += SessionManager.estimateTokens(JSON.stringify(m.tool_calls));
    }
    return { tokens, messages: s.messages.length };
  }

  // 重命名会话标题
  rename(id: string, title: string): boolean {
    const s = this.sessions.get(id);
    if (!s) return false;
    s.title = title;
    s.updatedAt = Date.now();
    this.save();
    return true;
  }

  // 返回会话摘要列表（按更新时间倒序），供侧栏历史展示
  list(): { id: string; title: string; updatedAt: number }[] {
    return [...this.sessions.values()]
      .map(s => ({ id: s.id, title: s.title || '新对话', updatedAt: s.updatedAt }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  // 返回给模型的消息（去掉 ts 字段）。
  // 🔒 安全兜底：过滤不完整的 tool_calls 链，防止 API 400。
  toChatMessages(id: string): any[] {
    const s = this.getOrCreate(id);
    const raw = s.messages.map(m => ({
      role: m.role,
      content: m.content,
      ...(m.tool_calls ? { tool_calls: m.tool_calls } : {}),
      ...(m.name ? { name: m.name } : {}),
      ...(m.tool_call_id ? { tool_call_id: m.tool_call_id } : {}),
    }));
    // 后向扫描：若 assistant+tool_calls 后续 tool 响应不全 → 剥离 tool_calls
    for (let i = 0; i < raw.length; i++) {
      const m = raw[i];
      if (m.role !== 'assistant' || !m.tool_calls || m.tool_calls.length === 0) continue;
      const covered = new Set<string>();
      for (let j = i + 1; j < raw.length; j++) {
        const n = raw[j];
        if (n.role === 'tool' && n.tool_call_id) covered.add(n.tool_call_id);
        if (n.role === 'user' || n.role === 'system') break; // tool 链不会跨 user/system
      }
      const missing = m.tool_calls.filter((tc: any) => !covered.has(tc.id));
      if (missing.length > 0) {
        console.log(`[Session] ⚠️ 剥离不完整 tool_calls: assistant[${i}] 缺 ${missing.length}/${m.tool_calls.length} 个 tool 响应 (ids: ${missing.map((t:any)=>t.id).join(',')})`);
        delete m.tool_calls;
        if (!m.content) m.content = '[工具调用结果已丢失]';
      }
    }
    return raw;
  }

  // 压缩对话：用摘要替换旧消息，仅保留最近 keepLast 条，节省上下文 Token。
  // 压缩头标记为 hidden：前端不渲染成气泡；但 toChatMessages 仍包含它，模型可保留上下文。
  //
  // ⚠️ BUG-FIX: tool-call 完整性保护 —— 如果 tail 中包含 tool 消息，必须保证其
  // 前面的 assistant+tool_calls 消息也被保留，否则 API 报 400 (tool must follow tool_calls)。
  compress(id: string, summary: string, keepLast = CONFIG.COMPRESS_KEEP): boolean {
    const s = this.sessions.get(id);
    if (!s) return false;
    let tail = s.messages.slice(-Math.max(0, keepLast));
    // 扩展 tail：确保所有 tool 消息前面的 assistant+tool_calls 都在
    tail = this._extendPastOrphanTools(s.messages, tail);
    const head: StoredMessage = {
      role: 'system',
      content: '[以下为压缩前的对话历史摘要]\n' + summary,
      ts: Date.now(),
      hidden: true,
    };
    s.messages = [head, ...tail];
    s.updatedAt = Date.now();
    this.save();
    return true;
  }

  // 🔧 双向 tool-call 完整性保护：
  //   方向1: tail 中有 tool 消息但没有其 assistant+tool_calls → 向前扩展
  //   方向2: tail 末尾有 assistant+tool_calls 但 tool 响应被切掉 → 向后扩展
  //   方向3: tail 中有不完整的 tool_calls（assistant 在 tail 内但 tool 响应不全）→ 向后扩展
  private _extendPastOrphanTools(allMessages: StoredMessage[], tail: StoredMessage[]): StoredMessage[] {
    if (tail.length === 0) return tail;
    const tailStartIdx = allMessages.indexOf(tail[0]);
    if (tailStartIdx < 0) return tail;

    // ── 方向1: 向前 — tool 孤儿找 assistant ──
    const needed = new Set<string>();
    for (const m of tail) {
      if (m.role === 'tool' && m.tool_call_id) needed.add(m.tool_call_id);
    }

    let earliest: number | null = null;
    if (needed.size > 0) {
      const found = new Set<string>();
      for (let i = tailStartIdx - 1; i >= 0 && found.size < needed.size; i--) {
        const m = allMessages[i];
        if (m.role === 'assistant' && m.tool_calls) {
          for (const tc of m.tool_calls) {
            if (needed.has(tc.id)) { found.add(tc.id); if (earliest === null || i < earliest) earliest = i; }
          }
        }
      }
    }

    // ── 方向2+3: 向后 — assistant+tool_calls 末尾孤儿找 tool 响应 ──
    // 检查 tail 中每个 assistant+tool_calls 是否所有 tool 响应都在 tail 中
    const tailEndIdx = tailStartIdx + tail.length;
    let extendTo: number | null = null;
    for (let i = tail.length - 1; i >= 0; i--) {
      const m = tail[i];
      if (m.role !== 'assistant' || !m.tool_calls || m.tool_calls.length === 0) continue;
      // 检查每个 tool_call_id 在 tail 中是否有对应 tool 响应
      const covered = new Set<string>();
      for (let j = i + 1; j < tail.length; j++) {
        const t = tail[j];
        if (t.role === 'tool' && t.tool_call_id) covered.add(t.tool_call_id);
      }
      const missing = m.tool_calls.filter(tc => !covered.has(tc.id));
      if (missing.length > 0) {
        // 向后扫描全量消息，找到缺失的 tool 响应
        for (let k = tailEndIdx; k < allMessages.length; k++) {
          const tm = allMessages[k];
          if (tm.role === 'tool' && missing.some(tc => tc.id === tm.tool_call_id)) {
            if (extendTo === null || k > extendTo) extendTo = k;
          }
          // 遇到下一条 user 消息就停（tool 响应不会跨 user 消息）
          if (tm.role === 'user') break;
        }
        // 补上了就不用继续往前查了
        break;
      }
    }

    // ── 合并扩展区间 ──
    const start = earliest !== null ? Math.min(earliest, tailStartIdx) : tailStartIdx;
    const end = extendTo !== null ? Math.max(extendTo + 1, tailEndIdx) : tailEndIdx;

    if (start < tailStartIdx || end > tailEndIdx) {
      tail = allMessages.slice(start, end);
    }
    return tail;
  }

  /** 将压缩任务加入串行队列，避免并发写坏 sessions.json；压缩失败不抛错 */
  private enqueueCompress(id: string, tokenSum: number): void {
    const prev = this.compressQueue.get(id) || Promise.resolve();
    const next = prev
      .then(async () => {
        const s = this.sessions.get(id);
        if (!s) return;
        const keepLast = CONFIG.COMPRESS_KEEP;
        if (s.messages.length <= keepLast) return;
        // 压缩前再次确认最近没有新摘要（防重复压缩）
        const hasRecentSummary = s.messages.slice(-25).some((m) => m.role === 'system' && String(m.content || '').includes('压缩'));
        if (hasRecentSummary) return;
        const toCompress = s.messages.slice(0, s.messages.length - keepLast);
        let summary: string;
        if (CONFIG.COMPRESS_LLM_SUMMARY) {
          try {
            summary = await generateSemanticSummary(toCompress);
          } catch (e: any) {
            console.warn(`[Session] 语义摘要失败，降级为统计摘要: ${e?.message || e}`);
            summary = statsSummary(toCompress);
          }
        } else {
          summary = statsSummary(toCompress);
        }
        this.compress(id, summary, keepLast);
        console.log(`[Session] 自动压缩完成: session=${id}, 压缩 ${toCompress.length} 条, 保留 ${keepLast} 条`);
      })
      .catch((e) => console.warn(`[Session] 自动压缩异常: ${e?.message || e}`));
    this.compressQueue.set(id, next);
  }
}





// ============================================================================
// 自动压缩增强（2026-08-11）：LLM 语义摘要 + 异步串行队列
// 触发时在后台调用当前 Provider 生成「关键事实/结论/未决事项」摘要，
// 失败自动降级为统计摘要；全程不阻塞 append()，也不抛错影响主流程。
// ============================================================================

/** 统计兜底摘要（LLM 不可用 / 关闭时使用） */
function statsSummary(msgs: StoredMessage[]): string {
  const tokens = msgs.reduce((s, m) => s + SessionManager.estimateTokens(typeof m.content === 'string' ? m.content : JSON.stringify(m.content || '')) + (m.tool_calls ? SessionManager.estimateTokens(JSON.stringify(m.tool_calls)) : 0), 0);
  const turns = msgs.filter((m) => m.role === 'user').length;
  return `[自动压缩] 共压缩 ${msgs.length} 条消息（约 ${tokens} tokens，${turns} 轮对话）。语义摘要不可用，已降级为统计信息。`;
}

/** 调用当前 Provider 生成语义摘要；任何异常都回退到统计摘要，绝不外抛 */
async function generateSemanticSummary(msgs: StoredMessage[]): Promise<string> {
  const toCompress = msgs.filter((m) => m.role !== 'tool'); // tool 结果含大量噪声，略去
  const body = toCompress
    .map((m) => `[${m.role}] ${typeof m.content === 'string' ? m.content : JSON.stringify(m.content || '')}`)
    .join('\n')
    .slice(-150_000); // 上限 150K 字符，防摘要输入过大
  const prompt =
    '请将以下 AI 助手与用户的对话历史压缩成一份结构化摘要，使用中文，输出三部分：\n' +
    '1. **关键事实**：对话中确认的事实、数据、文件路径、决策；\n' +
    '2. **结论**：已得出的结论、交付物、当前状态；\n' +
    '3. **未决事项**：尚未完成/待办/悬而未决的问题。\n' +
    '要求：只保留有长期价值的信息，丢弃寒暄与中间试探过程；控制在 500 字以内。\n\n' +
    '===== 对话历史 =====\n' + body;
  const { getProvider } = await import('../llm/provider');
  const provider = await getProvider();
  const resp = await provider.chat({
    messages: [{ role: 'user', content: prompt }],
    tools: [],
    temperature: 0.3,
  });
  const text = (resp.content || '').trim();
  if (!text) return statsSummary(msgs);
  return '[自动压缩·语义摘要]\n' + text;
}

export const sessions = new SessionManager();
