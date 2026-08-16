/**
 * git/checkpoint.ts
 *
 * 自进化完成后自动打 checkpoint（还原点）。
 * 挂接在 AgentLoop.reflect() 末尾：每次任务结束后检查工作树，
 * 若自进化改动了源码则自动提交一个安全还原点，便于出问题时回退。
 *
 * 安全设计（绝不破坏主流程）：
 *  - 全程 try/catch 包裹，任何失败只记日志、绝不抛出。
 *  - 仅在确有改动时才提交；无改动 → 直接 return（普通对话是 no-op）。
 *  - 提交前先过"验证门"（tsc --noEmit + 启动冒烟）；不过关 → 拒绝提交并生成真实 diff 报告。
 *  - 安全暂存：git add -u（已追踪改动）+ git ls-files --others --exclude-standard（未追踪非忽略）。
 *  - 可通过环境变量关闭：AH_AUTO_CHECKPOINT=false（整体关闭）、AH_VERIFY_GATE=false（跳过验证门）。
 */

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runVerificationGate } from './verifyGate';

const GIT_CWD = dirname(fileURLToPath(import.meta.url));

// checkpoint.ts 位于 server/src/git/。若 git 命令从这一子目录执行，
// `git ls-files --others` 只会列出【该子目录内】的未跟踪文件，
// 漏掉仓库其它位置新建的文件（如 server/src/core/crashHandlers.ts、新增 skill 等）。
// 故统一从仓库根目录执行全部 git 命令（与 verifyGate.ts 一致），
// 这样 `ls-files --others` 才能扫描整个仓库、不漏掉任何新建文件。
const REPO_ROOT = join(GIT_CWD, '..', '..', '..');

function git(args: string[]): string {
  return execFileSync('git', args, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).toString().trim();
}

export async function gitCheckpoint(reason: string): Promise<void> {
  try {
    // 0. 是否启用
    if (process.env.AH_AUTO_CHECKPOINT === 'false') return;

    // 1. 是否有改动（已追踪修改/删除 + 未追踪非忽略）
    const status = git(['status', '--porcelain']);
    if (!status) return; // 无改动 → 跳过（普通对话走到这里直接返回）

    // 2. 验证门：自进化改动需通过 tsc + 启动冒烟才允许提交
    if (process.env.AH_VERIFY_GATE !== 'false') {
      const result = await runVerificationGate();
      if (!result.pass) {
        // 不过关：拒绝提交，生成真实 diff 报告
        console.error(
          '[gitCheckpoint] ❌ 验证门未通过，拒绝提交自进化改动。\n' +
          '──────────── 验证门报告 ────────────\n' +
          result.report +
          '────────────────────────────────────\n' +
          (result.reportPath ? `[gitCheckpoint] 报告已保存: ${result.reportPath}\n` : '') +
          '[gitCheckpoint] ⚠️ 工作树保留未提交改动。重启服务器前请先审查或 git stash，否则可能再次启动失败。',
        );
        return;
      }
    }

    // 3. 安全暂存：已追踪改动（删除/修改）
    git(['add', '-u']);

    // 4. 未追踪且未被 .gitignore 排除的文件（合法的源码新增，如新 skill / 新模块）
    const untracked = git(['ls-files', '--others', '--exclude-standard']);
    if (untracked) {
      const files = untracked.split('\n').filter(Boolean);
      if (files.length) git(['add', '--', ...files]);
    }

    // 5. 二次确认暂存区非空（防止 add 后为空导致空提交）
    const staged = git(['diff', '--cached', '--name-only']);
    if (!staged) {
      git(['reset', '-q']);
      return;
    }

    // 6. 提交（信息含改动文件清单，便于回退时快速定位）
    const fileList = staged
      .split('\n')
      .filter(Boolean)
      .slice(0, 60)
      .map((f) => ` - ${f}`)
      .join('\n');
    const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
    const msg = `auto-checkpoint: ${reason}\n\nTriggered ${ts} by DaShaAgent self-evolution auto-checkpoint (passed verify gate).\nFiles changed:\n${fileList}`;
    git(['commit', '-q', '-m', msg]);
  } catch (err) {
    // 失败只记日志，绝不抛出；并尝试回滚暂存区避免留下半截 staged 状态
    try {
      git(['reset', '-q']);
    } catch { /* ignore */ }
    console.error('[gitCheckpoint] skipped:', err instanceof Error ? err.message : String(err));
  }
}
