// core/heartbeatSelfHeal.ts
// 廉价版心跳监听器（P2-1 配套）
// 设计约束：仅做「本地巡检 + 安全自愈」，绝不调用任何 LLM / loop.run。
// 由 unified.ts 在 heartbeat.start() 之后调用 registerHeartbeatSelfHeal() 注册。

import { heartbeat } from './heartbeat';
import { CONFIG } from '../config/system';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { execSync } from 'node:child_process';

const ALERT_FILE = path.join(CONFIG.DATA_DIR, 'health_alerts.jsonl');

interface CheckResult {
  ok: boolean;
  detail: string;
}

// 已注册的子进程自动拉起规格（默认空；由调用方按需 registerProcessSpec 添加）。
// 注意：本进程内无法直接拉起「已死的后端自身」，后端自重启应由外部监管
// （restart.bat / nssm / systemd）负责。此处仅用于拉起「本 harness 托管的子进程」。
const processSpecs: Record<string, () => void> = {};

// 可选：引擎自愈钩子（进程活着但网关端口不响应时调用；默认不设置 → 仅告警）。
let engineRestartHook: (() => void) | null = null;

export function registerProcessSpec(name: string, restart: () => void): void {
  processSpecs[name] = restart;
}

export function setEngineRestartHook(fn: () => void): void {
  engineRestartHook = fn;
}

function alert(check: string, r: CheckResult): void {
  const line = JSON.stringify({ ts: new Date().toISOString(), check, ok: r.ok, detail: r.detail }) + '\n';
  try { fs.appendFileSync(ALERT_FILE, line); } catch { /* 告警落盘失败不阻断 */ }
  console.log(`[SelfHeal] ${r.ok ? '[OK]  ' : '[ALERT]'} ${check}: ${r.detail}`);
}

// ───────────────────────── 本地检查实现（纯 Node，无 LLM） ─────────────────────────

function checkDisk(dir: string, thresholdGB = 10): CheckResult {
  try {
    const s = fs.statfsSync(dir);
    const freeGB = (s.bfree * s.bsize) / 1e9;
    if (freeGB < thresholdGB) {
      pruneOwnTemp(dir); // 安全自愈：仅清理自身产生的旧日志，绝不删用户数据
      return { ok: false, detail: `${dir} 剩余 ${freeGB.toFixed(1)}GB < ${thresholdGB}GB，已触发本地清理` };
    }
    return { ok: true, detail: `${dir} 剩余 ${freeGB.toFixed(1)}GB` };
  } catch (e: any) {
    const code = e?.code;
    // 卷不存在（如本机无 D: 盘）视为跳过，避免每 30 分钟误报。
    if (code === 'ENOENT' || code === 'ENOTDIR' || code === 'ENOVOL') {
      return { ok: true, detail: `${dir} 不可用，跳过` };
    }
    return { ok: false, detail: `无法读取 ${dir}: ${e?.message ?? e}` };
  }
}

// 仅删除本系统生成的 7 天前 .log，安全边界明确。
function pruneOwnTemp(dir: string): void {
  try {
    const logDir = path.join(dir, 'logs');
    if (!fs.existsSync(logDir)) return;
    for (const f of fs.readdirSync(logDir)) {
      const fp = path.join(logDir, f);
      const st = fs.statSync(fp);
      if (st.isFile() && /\.log$/i.test(f) && Date.now() - st.mtimeMs > 7 * 864e5) {
        fs.rmSync(fp, { force: true });
      }
    }
  } catch { /* 忽略 */ }
}

function checkPort(host = '127.0.0.1', port = CONFIG.PORT): Promise<CheckResult> {
  return new Promise((resolve) => {
    const sock = net.connect(port, host);
    const done = (ok: boolean, detail: string) => { try { sock.destroy(); } catch { /* noop */ } resolve({ ok, detail }); };
    sock.setTimeout(1500);
    sock.once('connect', () => done(true, `端口 ${port} 监听正常`));
    sock.once('timeout', () => done(false, `端口 ${port} 连接超时`));
    sock.once('error', (e: any) => done(false, `端口 ${port} 不可达: ${e?.message ?? e}`));
  });
}

function checkProcess(name: string): CheckResult {
  if (process.platform === 'win32') {
    try {
      const out = execSync(`tasklist /FI "IMAGENAME eq ${name}"`, { encoding: 'utf-8' });
      const alive = out.toLowerCase().includes(name.toLowerCase());
      if (!alive) {
        const spec = processSpecs[name];
        if (spec) { try { spec(); } catch { /* 拉起失败仅告警 */ } return { ok: false, detail: `${name} 未运行，已尝试自动拉起` }; }
        return { ok: false, detail: `${name} 未运行（未注册拉起规格，仅记录告警）` };
      }
      return { ok: true, detail: `${name} 运行中` };
    } catch (e: any) {
      return { ok: false, detail: `检查 ${name} 失败: ${e?.message ?? e}` };
    }
  }
  return { ok: true, detail: `非 Windows 平台，跳过 ${name} 检查` };
}

function checkTodos(): CheckResult {
  const p = path.join(CONFIG.DATA_DIR, 'todos.json');
  if (!fs.existsSync(p)) return { ok: true, detail: 'todos.json 不存在，跳过' };
  try {
    const data = JSON.parse(fs.readFileSync(p, 'utf-8'));
    const items: any[] = Array.isArray(data) ? data : (data.items || []);
    const now = Date.now();
    const overdue = items.filter((t) => t && (t.due || t.dueDate) && new Date(t.due || t.dueDate).getTime() < now && !t.done);
    if (overdue.length) return { ok: false, detail: `${overdue.length} 项待办已逾期` };
    return { ok: true, detail: `待办 ${items.length} 项，无逾期` };
  } catch (e: any) {
    return { ok: false, detail: `读取待办失败: ${e?.message ?? e}` };
  }
}

function checkCron(): CheckResult {
  const p = path.join(CONFIG.DATA_DIR, 'jobs.json');
  if (!fs.existsSync(p)) return { ok: true, detail: 'jobs.json 不存在，跳过' };
  try {
    const data = JSON.parse(fs.readFileSync(p, 'utf-8'));
    const arr: any[] = Array.isArray(data) ? data : (data.jobs || []);
    const failed = arr.filter((j) => j && j.enabled && (j.lastError || j.consecutiveFails));
    if (failed.length) return { ok: false, detail: `${failed.length} 个定时任务有失败记录` };
    return { ok: true, detail: `定时任务 ${arr.length} 个，无失败` };
  } catch (e: any) {
    return { ok: false, detail: `读取任务失败: ${e?.message ?? e}` };
  }
}

// ───────────────────────── 意图分发 ─────────────────────────

async function handleIntent(intent: string): Promise<void> {
  if (!intent) return;
  if (intent.includes('磁盘') || intent.includes('空间')) {
    alert('disk:C', checkDisk('C:\\'));
    if (process.platform === 'win32') alert('disk:D', checkDisk('D:\\'));
    return;
  }
  if (intent.includes('进程') || intent.includes('node') || intent.includes('httpd')) {
    alert('proc', checkProcess('node.exe'));
    return;
  }
  if (intent.includes('待办')) { alert('todos', checkTodos()); return; }
  if (intent.includes('定时任务') || intent.includes('cron')) { alert('cron', checkCron()); return; }
  if (intent.includes('端口') || intent.includes('监听') || intent.includes('网关') || intent.includes('存活')) {
    const r = await checkPort();
    alert('port', r);
    if (!r.ok && engineRestartHook) {
      try { engineRestartHook(); } catch { /* 自愈失败仅告警 */ }
      alert('port', { ok: false, detail: '已尝试引擎自愈钩子' });
    }
    return;
  }
  // 未知意图：仅记录，不动作（避免误触发任何副作用）。
  console.log(`[SelfHeal] 未识别的检查项，跳过: ${intent.slice(0, 60)}`);
}

export function registerHeartbeatSelfHeal(): void {
  heartbeat.on('heart:check', (result: any) => {
    handleIntent(result?.item?.intent || '').catch((e) => {
      console.error('[SelfHeal] listener error:', e);
    });
  });
  console.log('[SelfHeal] Registered — local-only inspection & safe self-heal, NO LLM');
}
