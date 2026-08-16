// tools/core/registry.ts
// 计划书 Phase 2 - Step 2 §一/§二：Tool Registry（真实世界工具的注册表 + 权限闸门）。
//
// 棕地说明：与 tools/registry.ts（生产 ToolDef 注册表）、executor/toolRegistry.ts（Step 5 教程层）
//           三者并存，各自服务不同管线。本注册表的独有职责是「执行前做权限校验」。

import type { Tool } from './tool';
import { fail } from './tool';
import { PermissionManager, permissions as defaultPermissions } from './permission';

export class ToolRegistry {
  private tools = new Map<string, Tool>();

  constructor(private permissions: PermissionManager = defaultPermissions) {}

  register(tool: Tool): this {
    this.tools.set(tool.name, tool);
    return this;
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  list(): Tool[] {
    return [...this.tools.values()];
  }

  names(): string[] {
    return [...this.tools.keys()];
  }

  /** 该工具当前是否被策略允许执行。 */
  allowed(name: string): boolean {
    const tool = this.tools.get(name);
    return !!tool && this.permissions.missing(tool.permissions).length === 0;
  }

  /** 带权限闸门的执行入口：越权不抛异常，返回统一失败信封供 Agent 观察/反思。 */
  async execute(name: string, input: any): Promise<any> {
    const tool = this.tools.get(name);
    if (!tool) return fail(name, 'Tool not found', `available: ${this.names().join(', ')}`);

    const missing = this.permissions.missing(tool.permissions);
    if (missing.length) {
      return fail(name, `Permission denied: ${missing.join(', ')}`, 'grant it via PermissionManager.grant()');
    }

    try {
      return await tool.execute(input);
    } catch (e: any) {
      return fail(name, e?.message ?? String(e));
    }
  }
}
