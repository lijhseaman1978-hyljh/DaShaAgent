// core/crashHandlers.ts
// 全局未捕获异常处理（审计报告 F-01）
//
// 24/7 自主运行的 server 一旦有未捕获的 Promise rejection 或异常，
// 整个进程会直接退出、所有在途任务丢失，且无任何记录。
// 这里统一兜底：记录到 data/crash/ 后再退出，交由守护进程/容器重启。
//
// 本模块在 import 时自动安装（幂等），因此只要在入口第一行 import 它，
// 即可覆盖模块求值期与运行期的未捕获错误。

import fs from 'node:fs';
import path from 'node:path';

const CRASH_DIR = path.join(process.cwd(), 'data', 'crash');

function dumpCrash(kind: string, err: unknown): string | null {
  try {
    fs.mkdirSync(CRASH_DIR, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const stack = err instanceof Error ? (err.stack || err.message) : String(err);
    const file = path.join(CRASH_DIR, `crash-${ts}.log`);
    fs.writeFileSync(file, `[${kind}] ${new Date().toISOString()}\n${stack}\n`, 'utf-8');
    return file;
  } catch {
    return null;
  }
}

export interface CrashHandlerOptions {
  /** 发生致命错误时的钩子（例如触发自重启、告警推送）。 */
  onCrash?: (kind: 'uncaughtException' | 'unhandledRejection', err: unknown) => void;
  /** 是否在处理后退出进程（默认 true，符合 24/7 重启策略）。 */
  exitOnCrash?: boolean;
}

let installed = false;

export function installCrashHandlers(opts: CrashHandlerOptions = {}): void {
  if (installed) return;
  installed = true;

  const exitOnCrash = opts.exitOnCrash ?? true;

  process.on('uncaughtException', (err: Error, origin: string) => {
    const file = dumpCrash('uncaughtException', err);
    console.error(`\n[FATAL] uncaughtException (origin=${origin}):`, err?.stack || err?.message || err);
    if (file) console.error(`[FATAL] crash log -> ${file}`);
    opts.onCrash?.('uncaughtException', err);
    if (exitOnCrash) process.exit(1);
  });

  process.on('unhandledRejection', (reason: unknown) => {
    const file = dumpCrash('unhandledRejection', reason);
    console.error(`\n[FATAL] unhandledRejection:`, reason instanceof Error ? (reason.stack || reason.message) : reason);
    if (file) console.error(`[FATAL] crash log -> ${file}`);
    opts.onCrash?.('unhandledRejection', reason);
    if (exitOnCrash) process.exit(1);
  });

  // 仅记录告警，不中断进程
  process.on('warning', (w: Error) => {
    console.warn(`[warn] ${w.name}: ${w.message}`);
  });

  console.log('[Engine] Crash handlers installed (uncaughtException / unhandledRejection)');
}

// 模块求值即安装：保证入口的其它 import 求值期错误也能被兜住。
installCrashHandlers();
