// 感知循环：每 N 分钟自动扫描系统状态，生成一句话摘要写入 notes/perception.md
// 让 Agent 在对话开始时"知道"这段时间发生了什么，不必每次都手动探查
// v2 (2026-08-10): 增强模型计数、过滤系统会话、修复报告拼接bug
// v3 (2026-08-11): 新增 diff 计算，供主动意识模块对比两次快照
import fs from 'node:fs';
import path from 'node:path';
import { CONFIG } from '../config';

export interface PerceptionReport {
  at: number;
  time: string;
  activeSession?: { id: string; messages: number; tokens: number; title?: string };
  sessionCount: number;
  modelHealth: { provider: string; models: number; status: 'online' | 'offline' }[];
  warnings: string[];
  summary: string;
}

const NOTES_DIR = path.join(CONFIG.WORKSPACE_DIR, 'notes');
const PERCEPTION_FILE = path.join(NOTES_DIR, 'perception.md');
const PERCEPTION_DIFF_FILE = path.join(NOTES_DIR, 'perception_diff.md');
const SESSIONS_FILE = path.join(CONFIG.MEMORY_DIR, 'sessions.json');
const LOG_DIR = path.join(CONFIG.ROOT, 'logs');

function est(text: string | null | undefined): number {
  if (!text) return 0;
  let cjk = 0, other = 0;
  for (const ch of String(text)) {
    const code = ch.codePointAt(0) || 0;
    if ((code >= 0x2e80 && code <= 0xfaff) || (code >= 0xff00 && code <= 0xffef) || (code >= 0x3000 && code <= 0x303f)) cjk++;
    else other++;
  }
  return Math.ceil(cjk * 1 + other / 4);
}

export function scan(): PerceptionReport | null {
  try {
    const now = new Date();
    const time = now.toLocaleString('zh-CN', { hour12: false });

    // ── 会话扫描（过滤 job_ 开头的系统会话） ──
    let sessionCount = 0;
    let activeSession: PerceptionReport['activeSession'] | undefined;
    try {
      const arr: any[] = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'));
      const userSessions = arr.filter(s => !String(s.id || '').startsWith('job_'));
      sessionCount = userSessions.length;
      if (userSessions.length) {
        userSessions.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
        const top = userSessions[0];
        const msgs = top.messages || [];
        let tokens = 0;
        for (const m of msgs) {
          tokens += est(typeof m.content === 'string' ? m.content : JSON.stringify(m.content || ''));
          if (m.tool_calls) tokens += est(JSON.stringify(m.tool_calls));
        }
        const title = top.title || (msgs.length > 0 ? String(msgs[0].content || '').slice(0, 60) : top.id.slice(-12));
        activeSession = { id: top.id, messages: msgs.length, tokens, title };
      }
    } catch { /* skip */ }

    // ── 模型健康扫描 ──
    const modelHealth: PerceptionReport['modelHealth'] = [];
    try {
      const configPath = path.join(CONFIG.DATA_DIR, 'config.json');
      const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      const ollamaBase = cfg.ollama?.base;
      const ollamaCount = (cfg.customModels || []).filter((c: any) => c.type === 'ollama').length;
      modelHealth.push({
        provider: 'Ollama',
        models: ollamaCount,
        status: ollamaBase ? 'online' : 'offline',
      });
      const seenHosts = new Set<string>(['Ollama']);
      for (const c of cfg.customModels || []) {
        if (c.type === 'ollama') continue;
        if (!c.key || c.key === '***') continue;
        const host = (() => { try { return new URL(c.base).hostname; } catch { return c.base; } })();
        if (!seenHosts.has(host)) {
          seenHosts.add(host);
          const count = (cfg.customModels || []).filter((c2: any) => {
            try { return new URL(c2.base).hostname === host && c2.type !== 'ollama'; } catch { return false; }
          }).length;
          modelHealth.push({ provider: host, models: count, status: 'online' });
        }
      }
    } catch {}

    // ── 日志异常扫描 ──
    const warnings: string[] = [];
    try {
      if (fs.existsSync(LOG_DIR)) {
        const files = fs.readdirSync(LOG_DIR).filter(f => f.endsWith('.log')).sort().slice(-3);
        for (const fn of files) {
          const content = fs.readFileSync(path.join(LOG_DIR, fn), 'utf8').slice(-4000);
          for (const line of content.split('\n')) {
            const lower = line.toLowerCase();
            if (lower.includes('[error]') || lower.includes('[warn]') || lower.includes(' fail') || lower.includes('crash') || lower.includes('timeout') || lower.includes('refused')) {
              const short = line.replace(/\n/g, ' ').slice(-120).trim();
              if (short && !warnings.includes(short)) warnings.push(short);
            }
          }
        }
      }
    } catch {}
    const recentWarnings = warnings.slice(-5);

    // ── 生成摘要 ──
    const parts: string[] = [];
    if (activeSession) {
      parts.push(
        activeSession.messages > 50
          ? `活跃会话 ${activeSession.title || activeSession.id.slice(-12)} 已有 ${activeSession.messages} 条消息(${Math.round(activeSession.tokens / 1000)}k tokens)`
          : `最近会话 ${activeSession.title || activeSession.id.slice(-12)} 共 ${activeSession.messages} 条`
      );
    }
    if (recentWarnings.length) {
      parts.push(`${recentWarnings.length} 条异常：${recentWarnings[0].slice(0, 60)}`);
    } else {
      parts.push('无异常');
    }
    const onlineProviders = modelHealth.filter(x => x.status === 'online').map(x => x.provider);
    if (onlineProviders.length) parts.push(`Provider 在线: ${onlineProviders.join(', ')}`);

    return {
      at: Date.now(),
      time,
      activeSession,
      sessionCount,
      modelHealth,
      warnings: recentWarnings,
      summary: parts.join('；'),
    };
  } catch (e: any) {
    console.error('[感知] 扫描失败:', e?.message || e);
    return null;
  }
}

export function writePerception(report: PerceptionReport): boolean {
  try {
    fs.mkdirSync(NOTES_DIR, { recursive: true });
    const prev = (() => { try { return fs.readFileSync(PERCEPTION_FILE, 'utf8'); } catch { return ''; } })();

    const lines: string[] = [];
    lines.push(`## 感知报告 · ${report.time}`);
    lines.push('');

    const providerSummary = report.modelHealth
      .map(p => `- ${p.status === 'online' ? '🟢' : '🔴'} ${p.provider}: ${p.models} 模型`)
      .join('\n');
    lines.push('### 模型状态');
    lines.push(providerSummary || '- 无可用 Provider');
    lines.push('');

    if (report.activeSession) {
      lines.push('### 活跃会话');
      lines.push(`- \`${report.activeSession.title || report.activeSession.id.slice(-20)}\`：${report.activeSession.messages} 条消息，约 ${Math.round(report.activeSession.tokens / 1000)}k tokens`);
      lines.push('');
    }

    if (report.warnings.length) {
      lines.push('### ⚠️ 异常');
      for (const w of report.warnings) lines.push(`- \`${w.slice(0, 150)}\``);
      lines.push('');
    }

    lines.push('### 一句话');
    lines.push(`> ${report.summary}`);
    lines.push('');

    const existingBlocks = prev.split('## 感知报告 ·');
    const allBlocks = [
      lines.join('\n'),
      ...existingBlocks.slice(1).map((b: string) => '## 感知报告 ·' + b),
    ];

    fs.writeFileSync(PERCEPTION_FILE, allBlocks.slice(0, 4).join('\n').trim() + '\n', 'utf8');
    return true;
  } catch (e: any) {
    console.error('[感知] 写入失败:', e?.message || e);
    return false;
  }
}

/**
 * v3: 写入 diff 摘要（供主动意识模块快速判断"有什么值得关注"）
 * 放在 notes/perception_diff.md，每次感知循环同步更新
 */
export function writePerceptionDiff(report: PerceptionReport): void {
  try {
    fs.mkdirSync(NOTES_DIR, { recursive: true });
    const prevRaw = (() => { try { return fs.readFileSync(PERCEPTION_DIFF_FILE, 'utf8'); } catch { return ''; } })();

    const prevOnline = (prevRaw.match(/在线[：:]\s*([^\n]+)/) || [])[1] || '';
    const currOnline = report.modelHealth.filter(x => x.status === 'online').map(x => x.provider).join(', ');
    const prevCount = parseInt((prevRaw.match(/会话数[：:]\s*(\d+)/) || [])[1] || '0', 10);
    const prevMsg = parseInt((prevRaw.match(/消息数[：:]\s*(\d+)/) || [])[1] || '0', 10);
    const prevToken = parseInt((prevRaw.match(/Token[：:]\s*(\d+)/) || [])[1] || '0', 10);

    const msgCount = report.activeSession?.messages || 0;
    const tokenK = Math.round((report.activeSession?.tokens || 0) / 1000);

    const parts: string[] = [];
    parts.push(`## 感知快照 · ${report.time}`);
    parts.push('');
    if (currOnline !== prevOnline) {
      const prevSet = new Set(prevOnline.split(/[,，]\s*/).filter(Boolean));
      const currSet = new Set(currOnline.split(/[,，]\s*/).filter(Boolean));
      const gone = [...prevSet].filter(x => !currSet.has(x));
      const back = [...currSet].filter(x => !prevSet.has(x));
      if (gone.length) parts.push(`🔴 掉线: ${gone.join(', ')}`);
      if (back.length) parts.push(`🟢 恢复: ${back.join(', ')}`);
      if (!gone.length && !back.length) parts.push('Provider 列表有变化（详见正文）');
    } else {
      parts.push(`Provider: 无变化`);
    }
    parts.push(`Provider 在线: ${currOnline}`);
    parts.push(`会话数: ${report.sessionCount} (${report.sessionCount - prevCount >= 0 ? '+' : ''}${report.sessionCount - prevCount})`);
    parts.push(`消息数: ${msgCount} (${msgCount - prevMsg >= 0 ? '+' : ''}${msgCount - prevMsg})`);
    parts.push(`Token: ${tokenK}K (${tokenK * 1000 - prevToken >= 0 ? '+' : ''}${Math.round((tokenK * 1000 - prevToken) / 1000)}K)`);
    parts.push(`异常: ${report.warnings.length} 条`);
    parts.push(`摘要: ${report.summary}`);
    parts.push('');

    fs.writeFileSync(PERCEPTION_DIFF_FILE, parts.join('\n'), 'utf8');
  } catch {}
}

/** 完整执行一次感知循环（供 scheduler 等外部调用） */
export function runPerception(): boolean {
  const report = scan();
  if (!report) return false;
  const ok = writePerception(report);
  writePerceptionDiff(report);  // v3: 同步写 diff
  return ok;
}
