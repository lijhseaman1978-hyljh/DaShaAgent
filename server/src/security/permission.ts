// security/permission.ts
// 计划书 Phase 3 - Step 1 §三：Permission Engine。
//
// 棕地说明：与 tools/core/permission.ts 的 PermissionManager（工具级权限标签闸门）分工不同——
//   PermissionManager 管「工具声明了哪些 permission 标签」；
//   PermissionEngine  管「当前安全策略是否允许某类行为」。二者串联：策略 → 标签 → 执行。

import type { SecurityPolicy } from './policy';

export class PermissionEngine {
  /** 可扩展的动作→策略字段映射（替代硬编码 switch-case，B8 修复） */
  private static readonly ACTION_MAP: Record<string, keyof SecurityPolicy> = {
    network: 'allowNetwork',
    write: 'allowFileWrite',
    shell: 'allowShell',
    exec: 'allowShell',       // exec 与 shell 共用权限
    sandbox: 'allowNetwork',  // sandbox 内部网络
  };

  constructor(private policy: SecurityPolicy) {}

  check(action: string): boolean {
    const key = PermissionEngine.ACTION_MAP[action];
    if (key) {
      const val = this.policy[key];
      return typeof val === 'boolean' ? val : false;
    }
    return false;
  }

  getPolicy(): SecurityPolicy {
    // 返回浅拷贝，防止外部修改绕过安全策略（B30 修复）
    return { ...this.policy };
  }

  setPolicy(policy: SecurityPolicy): void {
    this.policy = policy;
  }
}
