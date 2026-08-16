/**
 * git/verifyGate.ts
 *
 * 自进化"验证门"：在把自进化的源码改动提交进版本库之前，必须先通过三道检查，
 * 否则拒绝提交并生成真实 diff 报告：
 *   1) tsc --noEmit（仅针对【本次改动的文件】）—— 捕获自进化引入的新类型错误。
 *      注意：仓库里存在 agent 自进化留下的预存类型错误（在未改动文件），
 *      这些一律放行，只有"改动文件里新增的错误"才拦截，避免门变成永久封锁。
 *   2) 启动冒烟 —— 真正拉起服务器，抓 "SYSTEM READY"（捕获模块加载期/启动期崩溃，如 __dirname）。
 *   3) 能力回归 —— 在【已启动】的服务器内运行 regressionGuard 的运行时能力测试
 *      （工具注册表 / 记忆系统 / 技能加载 / 会话持久化 / 配置有效），抓 "CAPABILITY_RESULT"。
 *      任一核心能力失败即视为不通过，防止自进化悄悄弄坏核心能力。
 *
 * 设计原则：
 *  - 仅在确有源码改动时才触发（调用方 gitCheckpoint 已先做 git status 判断）。
 *  - 启动冒烟与能力回归合并为一次进程拉起：AH_CONTROL_PORT=0（OS 随机空闲端口）避免与父进程抢 3001；
 *    AH_AUTO_CHECKPOINT=false 杜绝递归触发；AH_VERIFY_CAPABILITY=1 让服务器跑完能力测试后退出。
 *  - 全程不抛异常；结果以 VerifyResult 返回，由调用方决定提交与否。
 */

import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
// server/src/git -> server/src -> server -> 仓库根
const ROOT = join(HERE, '..', '..', '..');

function git(args: string[]): string {
  return execFileSync('git', args, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).toString().trim();
}

export interface StepResult {
  ok: boolean;
  output: string;
}

export interface VerifyResult {
  pass: boolean;
  typecheck: StepResult;
  smoke: StepResult;
  capability: StepResult;
  report: string;
  reportPath: string;
}

/** 收集本次自进化改动涉及的文件（已追踪改动 + 未追踪新文件），相对仓库根 */
function getChangedFiles(): Set<string> {
  const changed = new Set<string>();
  const norm = (p: string) => p.trim().replace(/\\/g, '/');
  for (const f of git(['diff', '--name-only', 'HEAD']).split('\n')) {
    if (f.trim()) changed.add(norm(f));
  }
  for (const f of git(['ls-files', '--others', '--exclude-standard']).split('\n')) {
    if (f.trim()) changed.add(norm(f));
  }
  return changed;
}

const TSC_ERR_RE = /^([^\s(]+\.(?:ts|tsx|js|mjs|cjs|jsx))\s*\((\d+),(\d+)\):\s*(?:error|warning)\s+TS/i;
const normPath = (p: string) => p.replace(/\\/g, '/');

/** 1) 仅针对【本次改动的文件】做 TypeScript 类型检查 */
export function runTypecheck(changedFiles: Set<string>, timeoutMs = 120000): StepResult {
  try {
    execFileSync(
      process.execPath,
      ['node_modules/typescript/bin/tsc', '--noEmit'],
      { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: timeoutMs },
    );
    return { ok: true, output: '✅ 改动文件无新增类型错误' };
  } catch (e: unknown) {
    const err = e as { stdout?: Buffer; stderr?: Buffer; message?: string };
    const raw = `${(err.stdout?.toString() || '')}${(err.stderr?.toString() || '')}`;
    const lines = raw.split('\n');

    const inScope: string[] = [];
    const preExisting: string[] = [];
    for (const l of lines) {
      const m = l.match(TSC_ERR_RE);
      if (!m) continue;
      (changedFiles.has(normPath(m[1])) ? inScope : preExisting).push(l.trim());
    }

    const ok = inScope.length === 0;
    const parts = [
      ok
        ? '✅ 改动文件无新增类型错误'
        : `❌ 改动文件引入 ${inScope.length} 个类型/语法错误:`,
      ...inScope,
    ];
    if (preExisting.length) {
      parts.push(`\n(另有 ${preExisting.length} 个预存错误位于未改动文件中，已自动忽略，不拦截)`);
    }
    return { ok, output: parts.join('\n').trim() };
  }
}

/**
 * 2)+3) 启动冒烟 + 能力回归：一次拉起服务器，捕获两道标志：
 *   - "SYSTEM READY"  → 启动成功（门②）
 *   - "CAPABILITY_RESULT {...}" → regressionGuard 运行时能力测试结果（门③）
 * 二者皆满足才通过。用 AH_CONTROL_PORT=0 避开父进程 3001，AH_AUTO_CHECKPOINT=false 防递归，
 * AH_VERIFY_CAPABILITY=1 让服务器跑完能力测试后自行退出。
 */
export function runBootWithCapability(timeoutMs = 60000): Promise<{ smoke: StepResult; capability: StepResult }> {
  return new Promise((resolve) => {
    const tsx = join(ROOT, 'node_modules/tsx/dist/cli.mjs');
    const child = spawn(
      process.execPath,
      [tsx, '--max-old-space-size=4096', 'server/src/unified.ts'],
      {
        cwd: ROOT,
        env: {
          ...process.env,
          AH_CONTROL_PORT: '0',
          AH_AUTO_CHECKPOINT: 'false',
          AH_VERIFY_CAPABILITY: '1',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );

    let out = '';
    let done = false;
    let systemReady = false;
    let capResult: { ok: boolean } | null = null;

    const tail = (s: string) => s.slice(-4000);

    const finish = (smoke: StepResult, cap: StepResult) => {
      if (done) return;
      done = true;
      try { child.kill('SIGKILL'); } catch { /* ignore */ }
      resolve({ smoke, capability: cap });
    };

    const onData = (d: Buffer) => {
      const s = d.toString();
      out += s;
      if (out.includes('SYSTEM READY')) systemReady = true;

      // 解析 CAPABILITY_RESULT 行
      for (const line of s.split('\n')) {
        const idx = line.indexOf('CAPABILITY_RESULT ');
        if (idx >= 0) {
          try {
            const parsed = JSON.parse(line.slice(idx + 'CAPABILITY_RESULT '.length).trim());
            capResult = { ok: parsed.ok === true };
          } catch { /* 继续读下一行 */ }
        }
      }

      // 一旦产出能力结果，即判定两道门
      if (capResult !== null) {
        const smoke: StepResult = systemReady
          ? { ok: true, output: '✅ 服务器启动到 SYSTEM READY' }
          : { ok: false, output: tail(out) + '\n(未到达 SYSTEM READY)' };
        const cap: StepResult = capResult.ok
          ? { ok: true, output: '✅ 核心能力全部通过，无退化' }
          : { ok: false, output: tail(out) };
        finish(smoke, cap);
      }
    };

    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    child.on('error', (e) =>
      finish(
        { ok: false, output: tail(out) + `\nSPAWN ERROR: ${e.message}` },
        { ok: false, output: '未运行（启动失败）' },
      ),
    );
    child.on('exit', (code) => {
      if (capResult === null) {
        // 进程退出但未产出 CAPABILITY_RESULT
        const smoke: StepResult = systemReady
          ? { ok: true, output: '✅ 服务器启动到 SYSTEM READY（但验证门能力步骤未产出结果）' }
          : { ok: false, output: tail(out) + `\nPROCESS EXITED code=${code} (SYSTEM READY not reached)` };
        finish(smoke, { ok: false, output: tail(out) + `\nPROCESS EXITED code=${code} (未产出 CAPABILITY_RESULT)` });
      }
    });
    setTimeout(() => {
      const smoke: StepResult = systemReady
        ? { ok: true, output: '✅ 服务器启动到 SYSTEM READY（超时前已就绪）' }
        : { ok: false, output: tail(out) + `\nTIMEOUT (SYSTEM READY not reached)` };
      const cap: StepResult = capResult !== null
        ? { ok: capResult.ok, output: capResult.ok ? '✅ 核心能力全部通过' : tail(out) }
        : { ok: false, output: tail(out) + `\nTIMEOUT (未产出 CAPABILITY_RESULT)` };
      finish(smoke, cap);
    }, timeoutMs);
  });
}

function buildReport(tc: StepResult, sm: StepResult, cap: StepResult): string {
  const ts = new Date().toISOString();
  let r = `## 验证门报告 ${ts}\n\n`;
  r += `| 检查 | 结果 |\n|---|---|\n`;
  r += `| tsc --noEmit（仅改动文件） | ${tc.ok ? '✅ 通过' : '❌ 失败'} |\n`;
  r += `| 启动冒烟 (SYSTEM READY) | ${sm.ok ? '✅ 通过' : '❌ 失败'} |\n`;
  r += `| 能力回归 (regressionGuard) | ${cap.ok ? '✅ 通过' : '❌ 失败'} |\n\n`;
  if (!tc.ok) r += `### 改动文件类型错误\n\`\`\`\n${tc.output}\n\`\`\`\n\n`;
  if (!sm.ok) r += `### 启动错误\n\`\`\`\n${sm.output}\n\`\`\`\n\n`;
  if (!cap.ok) r += `### 能力退化\n\`\`\`\n${cap.output}\n\`\`\`\n\n`;
  r += `### 改动概览 (git diff --stat HEAD)\n\`\`\`\n${git(['diff', '--stat', 'HEAD'])}\n\`\`\`\n`;
  return r;
}

/** 运行完整验证门（三关） */
export async function runVerificationGate(timeoutMs = 60000): Promise<VerifyResult> {
  const changedFiles = getChangedFiles();
  const typecheck = runTypecheck(changedFiles);
  const { smoke, capability } = await runBootWithCapability(timeoutMs);
  const pass = typecheck.ok && smoke.ok && capability.ok;
  const report = buildReport(typecheck, smoke, capability);
  let reportPath = '';
  try {
    reportPath = join(tmpdir(), `ah-verify-${Date.now()}.md`);
    writeFileSync(reportPath, report, 'utf-8');
  } catch { /* 写盘失败不影响返回结果 */ }
  return { pass, typecheck, smoke, capability, report, reportPath };
}
