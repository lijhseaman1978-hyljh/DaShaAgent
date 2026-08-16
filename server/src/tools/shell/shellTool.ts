// tools/shell/shellTool.ts
// 审计报告 F-02 修复：
//   旧方案 = exec() + 正则黑名单。缺陷：黑名单可被编码/换行/元字符/引号嵌套绕过；
//           且 exec() 经 Node 隐式 shell 字符串解析，注入面大。
//   新方案 = execFile(显式 shell, ['-c', cmd]) + 三层防御：
//     1) normalizeCommand()  —— 去零宽/控制字符、解码转义、合并续行，消除"编码绕过"
//     2) DANGEROUS 正则黑名单 —— 在剥离引号后的命令上匹配，避免 echo "rm -rf" 误杀
//     3) DESTRUCTIVE_BINS 分词结构扫描 —— 即便正则漏网，命令首词命中仍拦截
//   权限仍由 ToolRegistry 的 permissions:['execute'] 在调用前统一校验。

import { execFile } from 'child_process';
import { promisify } from 'util';
import { fail } from '../core/tool';

const run = promisify(execFile);

// 显式指定 shell，避免依赖 Node 对 exec() 字符串的隐式解析
const SHELL_BIN = process.platform === 'win32'
  ? (process.env.ComSpec || 'cmd.exe')
  : '/bin/sh';
const SHELL_FLAG = process.platform === 'win32' ? '/c' : '-c';

/** 不可逆 / 系统级破坏命令：正则层拦截。 */
const DANGEROUS: Array<{ re: RegExp; why: string }> = [
  { re: /\brm\s+(-[a-z]*\s+)*-[a-z]*[rf]/i, why: 'recursive/forced delete' },
  { re: /\bdel\s+\/[sq]/i, why: 'recursive Windows delete' },
  { re: /\brmdir\s+\/s/i, why: 'recursive directory removal' },
  { re: /Remove-Item[^|]*-Recurse/i, why: 'PowerShell recursive removal' },
  { re: /\bformat\s+[a-z]:/i, why: 'disk format' },
  { re: /\bmkfs(\.|\s)/i, why: 'filesystem format' },
  { re: /\b(shutdown|reboot|halt|poweroff)\b/i, why: 'system power control' },
  { re: /:\(\)\s*\{.*\};\s*:/, why: 'fork bomb' },
  { re: />\s*\/dev\/(sd|hd|nvm|vd)/i, why: 'raw disk write' },
  { re: /\bdd\s+if=.*of=\/dev\//i, why: 'raw disk write' },
];

/** 结构化扫描层：命令中任何"裸命令词"命中此集合即拦截。 */
const DESTRUCTIVE_BINS = new Set<string>([
  'rm', 'del', 'rmdir', 'rd', 'format', 'mkfs', 'fdisk', 'parted',
  'shutdown', 'reboot', 'halt', 'poweroff', 'dd',
]);

/**
 * 归一化命令：消除"编码绕过"类手法。
 *  - 去除零宽/不可见字符
 *  - 解码 \xNN / \uNNNN / \0NNN 转义
 *  - 合并行尾续行符（\ 结尾）
 *  - 去除其余控制字符
 */
function normalizeCommand(cmd: string): string {
  let s = cmd;
  s = s.replace(/[\u200b\u200c\u200d\ufeff\u00ad]/g, '');
  s = s.replace(/\\x([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
  s = s.replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
  s = s.replace(/\\0([0-7]{1,3})/g, (_, o) => String.fromCharCode(parseInt(o, 8)));
  s = s.replace(/\\\s*\n/g, ' ');
  s = s.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
  return s;
}

/** 剥离引号内容（用于正则层，避免 echo "rm -rf /" 被误杀）。 */
function stripQuotes(s: string): string {
  return s.replace(/"[^"]*"/g, ' ').replace(/'[^']*'/g, ' ').replace(/`[^`]*`/g, ' ');
}

/** 分词（保留引号边界）。 */
function tokenize(cmd: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|`([^`]*)`|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cmd))) {
    out.push((m[1] ?? m[2] ?? m[3] ?? m[4] ?? '').trim());
  }
  return out;
}

/**
 * 命令安全检查，返回被拦截的原因；null 表示放行。
 * 三层：归一化 → 正则黑名单（引号剥离后）→ 分词结构扫描。
 */
export function screen(command: string): string | null {
  const norm = normalizeCommand(command);
  const stripped = stripQuotes(norm);
  for (const d of DANGEROUS) if (d.re.test(stripped)) return d.why;
  for (const t of tokenize(norm)) {
    const bin = t.toLowerCase().replace(/^.*[\\/]/, '');
    if (!bin.includes(' ') && DESTRUCTIVE_BINS.has(bin)) return `destructive command: ${bin}`;
  }
  return null;
}

export interface ShellInput {
  command: string;
  cwd?: string;
  /** 毫秒，默认 60000 */
  timeout?: number;
}

export const ShellTool = {
  name: 'shell',
  description: 'Execute shell command (destructive commands are blocked)',
  permissions: ['execute'],

  screen,

  async execute(input: ShellInput) {
    const raw = input?.command?.trim();
    if (!raw) return fail('shell', 'input.command is required');

    const blocked = screen(raw);
    if (blocked) return fail('shell', `Blocked dangerous command (${blocked})`, 'refused by shell safety screen');

    const normalized = normalizeCommand(raw);

    try {
      const result = await run(SHELL_BIN, [SHELL_FLAG, normalized], {
        cwd: input.cwd,
        timeout: input.timeout ?? 60_000,
        maxBuffer: 8 * 1024 * 1024,
        windowsHide: true,
      });
      return { stdout: result.stdout, stderr: result.stderr };
    } catch (e: any) {
      // 命令非零退出也走这里：把 stdout/stderr 一并带回，Agent 才能据此反思
      return {
        stdout: e?.stdout ?? '',
        stderr: e?.stderr ?? (e?.message ?? String(e)),
        code: e?.code ?? -1,
        ok: false,
      };
    }
  },
};
