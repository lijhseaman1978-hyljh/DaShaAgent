// server/src/api/adminRestart.ts
// 远程重启管理模块
// 现状调研（2026-08-08）：本机 WinRM(Stopped) / sshd(未安装) / WSMan 监听器均不可用，
// 没有现成的远程管理 API。因此在本模块内暴露带鉴权的 HTTP 管理端点，
// 通过已有 3001 端口远程触发系统重启（本地管理员权限即可，无需额外协议）。
// 备选：PsShutdown（Sysinternals）可作为命令行备选，见 README 注释。

import { exec } from 'node:child_process';

export interface RestartOptions {
  token?: string;      // 管理令牌（与 env AH_ADMIN_TOKEN 比对）
  delaySec?: number;   // 重启延迟秒数，默认 5（先返回响应再重启）
  force?: boolean;     // 强制重启（-f 关闭未响应应用），默认 false
  dryRun?: boolean;    // 仅预检，不真正调度重启
  message?: string;    // 重启提示消息
}

export interface RestartResult {
  ok: boolean;
  mode: 'local' | 'remote-invoke';
  scheduled: boolean;
  delaySec: number;
  command: string;
  detail?: string;
  error?: string;
}

const DEFAULT_DELAY = 5;

/** 管理令牌：未配置 AH_ADMIN_TOKEN 时仅允许本机(loopback)调用 */
function adminToken(): string {
  return process.env.AH_ADMIN_TOKEN || '';
}

/** 校验调用方令牌与来源 */
export function checkAdminToken(token: string | undefined, remote: boolean): { ok: boolean; reason?: string } {
  const expect = adminToken();
  if (!expect) {
    if (remote) return { ok: false, reason: 'AH_ADMIN_TOKEN not configured; loopback only' };
    return { ok: true };
  }
  if (token !== expect) return { ok: false, reason: 'invalid admin token' };
  return { ok: true };
}

/** 路径校验：判断是否为盘符根目录（如 C:\、C:/） */
export function isDriveRoot(p: string): boolean {
  const norm = p.replace(/[\\/]+$/, ''); // 去掉尾部斜杠
  return /^[A-Za-z]:$/.test(norm);
}

/** 预检：WinRM（PowerShell Remoting）是否可用 */
export async function winrmAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    exec(
      'powershell -NoProfile -Command "Get-Service WinRM -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Status"',
      { timeout: 8000 },
      (err, stdout) => {
        if (err) return resolve(false);
        resolve(stdout.trim().toLowerCase() === 'running');
      },
    );
  });
}

/** 构造本地重启命令（Windows shutdown /r） */
function buildLocalCommand(delaySec: number, force: boolean, message: string): string {
  const forceFlag = force ? ' /f' : '';
  const msg = message ? ` /c "${message.replace(/"/g, "'")}"` : '';
  return `shutdown /r /t ${delaySec}${forceFlag}${msg}`;
}

/** 远程重启（PowerShell Invoke-Command → Restart-Computer；需目标机已启用 WinRM） */
function remoteRestart(target: string, delaySec: number): Promise<RestartResult> {
  const ps = `Invoke-Command -ComputerName "${target}" -ScriptBlock { param($d) Restart-Computer -Force -Delay $d } -ArgumentList ${delaySec}`;
  return new Promise((resolve) => {
    exec(
      `powershell -NoProfile -Command "${ps.replace(/"/g, '\\"')}"`,
      { timeout: 30000 },
      (err, stdout, stderr) => {
        if (err) {
          resolve({ ok: false, mode: 'remote-invoke', scheduled: false, delaySec, command: ps, error: String(stderr || err) });
        } else {
          resolve({ ok: true, mode: 'remote-invoke', scheduled: true, delaySec, command: ps, detail: stdout.trim() });
        }
      },
    );
  });
}

/** 主入口：执行远程重启 */
export async function executeRestart(opts: RestartOptions): Promise<RestartResult> {
  const delaySec = opts.delaySec ?? DEFAULT_DELAY;
  const force = opts.force ?? false;
  const message = opts.message || 'DaShaAgent admin restart';
  const target = process.env.AH_RESTART_TARGET || '127.0.0.1';

  // 1. 预检远程通道
  const winrm = await winrmAvailable();

  // 2. dry-run：仅预检，不真正重启
  if (opts.dryRun) {
    return {
      ok: true,
      mode: winrm ? 'remote-invoke' : 'local',
      scheduled: false,
      delaySec,
      command: winrm
        ? `Invoke-Command -ComputerName ${target} ... Restart-Computer -Force`
        : buildLocalCommand(delaySec, force, message),
      detail: `dry-run: winrm=${winrm ? 'available' : 'unavailable'}, target=${target}, remote-channel=${winrm ? 'Invoke-Command' : 'local shutdown'}`,
    };
  }

  // 3. 远程目标且 WinRM 可用 → PowerShell Remoting
  if (winrm && target !== '127.0.0.1') {
    return remoteRestart(target, delaySec);
  }

  // 4. 本机（或 WinRM 不可用）→ 直接调度本地重启，先返回响应再重启
  const cmd = buildLocalCommand(delaySec, force, message);
  return new Promise((resolve) => {
    exec(cmd, { timeout: 8000 }, (err, stdout, stderr) => {
      if (err) {
        resolve({ ok: false, mode: 'local', scheduled: false, delaySec, command: cmd, error: String(stderr || err) });
      } else {
        resolve({ ok: true, mode: 'local', scheduled: true, delaySec, command: cmd, detail: `reboot scheduled in ${delaySec}s` });
      }
    });
  });
}
