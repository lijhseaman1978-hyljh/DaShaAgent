// 运行时日志与指标采集：供 /api/logs 与 /api/metrics 使用。
// 通过劫持 console.* 把全局日志写入内存环形缓冲 + 文件持久化（重启不丢）。

import { appendFileSync, existsSync, readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

// 确保 .env 已加载（dotenv 幂等，重复调用安全；避免 ESM 下 runtime.ts 先于 config 被求值）
try {
  const dotenv = require('dotenv');
  const envPath = join(process.cwd(), '.env');
  if (existsSync(envPath)) dotenv.config({ path: envPath, quiet: true });
  dotenv.config({ quiet: true });
} catch { /* .env 缺失时静默 */ }

// ── 日志文件路径 ──
const LOG_FILE = join(process.cwd(), 'data', 'logs.jsonl');
// 内存中最多保留条数（环境变量 AH_LOG_MEMORY_MAX 可调；0 = 无限制，内存与日志文件全量同步，历史永不丢失）
const MAX_MEMORY = parseInt(process.env.AH_LOG_MEMORY_MAX || '0', 10);
// 启动时从文件回读条数（环境变量 AH_LOG_LOAD_LIMIT 可调；0 = 无限制，回读全部历史日志）
const MAX_FILE_LOAD = parseInt(process.env.AH_LOG_LOAD_LIMIT || '0', 10);

// ── 初始化数据目录 ──
try { mkdirSync(join(process.cwd(), 'data'), { recursive: true }); } catch { /* 已存在 */ }

export const runtime = {
  logs: [] as { t: number; level: string; msg: string }[],
  startTime: Date.now(),
  wsConnections: 0,
};

// ── 启动时从文件回读最近日志 ──
(function loadFromFile() {
  try {
    if (!existsSync(LOG_FILE)) return;
    const raw = readFileSync(LOG_FILE, 'utf-8');
    const lines = raw.trim().split('\n').filter(Boolean);
    // 0=无限制回读全部历史；>0 只回读最近 N 条
    const recent = MAX_FILE_LOAD > 0 ? lines.slice(-MAX_FILE_LOAD) : lines;
    for (const line of recent) {
      try {
        const entry = JSON.parse(line);
        if (entry.t && entry.level && entry.msg) {
          runtime.logs.push(entry);
        }
      } catch { /* 跳过格式错误行 */ }
    }
    console.log(`[Runtime] 从文件回读了 ${runtime.logs.length} 条历史日志`);
  } catch { /* 文件不存在或损坏，从头开始 */ }
})();

// ── 日志写入队列（每 5 秒批量落盘，减少 IO） ──
let pending: string[] = [];
let flushTimer: ReturnType<typeof setInterval> | null = null;

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setInterval(() => {
    if (pending.length === 0) return;
    const batch = pending.splice(0);
    try {
      appendFileSync(LOG_FILE, batch.join('\n') + '\n', 'utf-8');
    } catch { /* 落盘失败不阻塞 */ }
  }, 5000);
  flushTimer.unref(); // 不阻止进程退出
}
scheduleFlush();

// ── 推送日志（内存 + 文件双写） ──
export function pushLog(level: string, msg: string) {
  const entry = { t: Date.now(), level, msg };
  runtime.logs.push(entry);
  // 0 = 无限制：内存与日志文件全量同步；>0 才做环形裁剪
  if (MAX_MEMORY > 0 && runtime.logs.length > MAX_MEMORY) runtime.logs.shift();

  // 异步落盘：先入队列，定时批量写
  pending.push(JSON.stringify(entry));
}

function safeStringify(a: any): string {
  if (typeof a === 'string') return a;
  try { return JSON.stringify(a); } catch { return String(a); }
}

// 劫持 console，使所有日志同时进入缓冲（副作用在 import 时立即生效）。
const levels: Array<'log' | 'info' | 'warn' | 'error'> = ['log', 'info', 'warn', 'error'];
for (const lv of levels) {
  const orig = (console as any)[lv] as (...a: any[]) => void;
  (console as any)[lv] = (...args: any[]) => {
    orig(...args);
    try {
      const msg = args.map(safeStringify).join(' ');
      pushLog(lv === 'log' ? 'info' : lv, msg);
    } catch { /* 忽略日志自身错误 */ }
  };
}
