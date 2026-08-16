// tools/shell/secureShellTool.ts
// 计划书 Phase 3 - Step 1 §十：升级 Shell Tool —— SecureShellTool（name = "secure_shell"）。
//
// 执行流程（计划书 §十一）：
//   Agent → Executor → Security Kernel → Permission Check → Threat Detect → Docker Sandbox → Monitor Log
//
// 棕地决策（重要）：
//   计划书 §十 的措辞是「以前 child_process.exec() 删除」。但 §十 给出的代码引入的是一个**新工具名**
//   secure_shell，而非改写 shell。依据本工程「并排扩展、不删不降级」硬性规则：
//     - Step 2 的 ShellTool（name='shell'，宿主执行 + 危险命令黑名单）**原样保留**，
//       Docker 缺席时它仍是唯一可用的执行能力，删掉即为能力降级；
//     - 本文件新增 SecureShellTool（name='secure_shell'）作为**生产安全路径**，
//       Runtime 在沙箱可用时优先走它。
//   两者并存，安全上限由 SecurityPolicy 决定，而不是靠删代码。

import { security } from '../../security';
import { sandboxContainers, sandboxExecutor, docker } from '../../sandbox';
import { ShellTool } from './shellTool';
import { fail } from '../core/tool';

export interface SecureShellInput {
  command: string;
  /** 计划书 §十 是 throw；默认返回结构化失败信封（供 Agent Loop 观察→反思），strict=true 时抛错。 */
  strict?: boolean;
  timeout?: number;
}

export class SecureShellTool {
  name = 'secure_shell';
  description = 'Execute shell command inside an isolated Docker container (security-kernel governed)';
  permissions = ['execute'];

  async execute(input: SecureShellInput): Promise<any> {
    const command = input?.command?.trim();
    if (!command) return fail('secure_shell', 'input.command is required');

    // ① Permission Check + ② Threat Detect + ③ Monitor Log（一次过闸）
    const verdict = security.guard('shell', command);
    if (!verdict.allowed) {
      if (input.strict) throw new Error(verdict.reason ?? 'Permission denied');
      return fail('secure_shell', verdict.reason ?? 'Permission denied', 'blocked by Security Kernel');
    }

    // ④ Docker Sandbox
    const ping = await docker.ping();
    if (!ping.ok) {
      // 降级路径：沙箱不可用时，退回宿主受控执行（仍有黑名单 + 监控），并如实标注 sandboxed:false。
      security.record({ action: 'shell.degraded', target: command, allowed: true, reason: ping.reason });
      const result: any = await ShellTool.execute({ command, timeout: input.timeout });
      return { ...result, sandboxed: false, sandboxUnavailable: ping.reason };
    }

    try {
      const container = await sandboxContainers.ensure({ policy: security.policy });
      const result = await sandboxExecutor.run(container, command, input.timeout ?? security.policy.timeout);
      security.record({ action: 'shell.sandbox', target: command, allowed: true, exitCode: result.exitCode });
      return { ...result, sandboxed: true };
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      security.record({ action: 'shell.sandbox', target: command, allowed: false, reason: msg });
      return fail('secure_shell', msg, 'docker sandbox execution failed');
    }
  }
}

/** 单例，供 Runtime / Executor 注册。 */
export const SecureShell = new SecureShellTool();
