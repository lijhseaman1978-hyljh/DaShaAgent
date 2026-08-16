// security/policy.ts
// 计划书 Phase 3 - Step 1 §二：安全策略系统。

export interface SecurityPolicy {
  allowNetwork: boolean;
  allowFileWrite: boolean;
  allowShell: boolean;
  /** 单位 MB */
  maxMemory: number;
  /** 单位 ms */
  timeout: number;
}

export const DefaultPolicy: SecurityPolicy = {
  allowNetwork: false,
  allowFileWrite: true,
  allowShell: true,
  maxMemory: 512,
  timeout: 30000,
};

/**
 * 从 Config 的 sandbox 段派生策略（让 .env 能直接调安全档位，而不是改代码）。
 *
 * 关键语义（Phase 3 - Step 1 §五~§八 引入 Docker 之后确立）：
 *   `SANDBOX_ALLOW_SHELL` 管的是**宿主 shell**。一旦容器沙箱真实可用，
 *   命令跑在隔离容器里，隔离本身即是授权依据，因此放行 shell —— 这正是
 *   计划书 §十二「在容器里 npm create vite」能跑通的前提。
 *   沙箱不可用时退回严格档：宿主执行必须由 SANDBOX_ALLOW_SHELL 显式开启。
 */
export function policyFromConfig(
  sandbox: { enabled: boolean; allowShell: boolean; allowNetwork: boolean },
  opts: { sandboxAvailable?: boolean } = {}
): SecurityPolicy {
  if (!sandbox.enabled) {
    // 沙箱关闭 = 开发者显式放行（仍受 ThreatDetector 拦截）
    return { ...DefaultPolicy, allowNetwork: true, allowShell: true, allowFileWrite: true };
  }
  return {
    ...DefaultPolicy,
    allowNetwork: sandbox.allowNetwork,
    // 容器可用 → 容器内放行；容器缺席 → 只认显式开关
    allowShell: opts.sandboxAvailable === true ? true : sandbox.allowShell,
  };
}
