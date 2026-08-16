// tools/core/permission.ts
// 计划书 Phase 2 - Step 2 §三：Tool Permission System —— 「这是生产 Agent 必须有的」。
//
// 计划书默认放行集合为 ["read","write","execute"]；
// 注意 BrowserTool 声明 ["network"]、DatabaseTool 声明 ["database"]，
// 均不在默认集合内 —— 即「联网 / 访问数据库默认拒绝，必须显式授予」，这正是计划书的安全默认值。
// 我们保留该语义，并补上 grant/revoke，让 Runtime 可以在启动时按策略开闸。

export class PermissionManager {
  private allowed: string[];

  constructor(allowed?: string[]) {
    this.allowed = allowed ?? ['read', 'write', 'execute'];
  }

  check(permission: string): boolean {
    return this.allowed.includes(permission);
  }

  /** 工具级校验：工具声明的每一项权限都必须被放行。返回缺失项，空数组表示通过。 */
  missing(permissions: string[] = []): string[] {
    return permissions.filter((p) => !this.check(p));
  }

  grant(...permissions: string[]): this {
    for (const p of permissions) if (!this.allowed.includes(p)) this.allowed.push(p);
    return this;
  }

  revoke(...permissions: string[]): this {
    this.allowed = this.allowed.filter((p) => !permissions.includes(p));
    return this;
  }

  list(): string[] {
    return [...this.allowed];
  }
}

/** 全局默认策略实例（Runtime 可 grant 扩权，沙箱模式可 revoke 收权）。 */
export const permissions = new PermissionManager();
