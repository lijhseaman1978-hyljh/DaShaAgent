// tools/core/tool.ts
// 计划书 Phase 2 - Step 2 §二：重新设计 Tool Interface（带权限声明）。
//
// 棕地说明（并排扩展、不删不降级）：
//   - tools/registry.ts 的 ToolDef（JSON-Schema 风格，供 LLM function-calling）继续服务生产管线；
//   - executor/toolRegistry.ts 的 Tool（Step 5 教程层，无 permissions）继续被 Executor 使用；
//   - 本文件是 Step 2 新增的「真实世界工具」接口，比 Step 5 版多一个 permissions 字段，
//     结构上向下兼容 Step 5 的 Tool，因此可直接 executor.registerTool(BrowserTool) 而无需改动 Executor。

/** 工具能力权限标签。read/write/execute 为默认放行；network/database 需显式授予。 */
export type ToolPermission = 'read' | 'write' | 'execute' | 'network' | 'database' | (string & {});

export interface Tool {
  name: string;
  description: string;
  permissions: string[];
  execute(input: any): Promise<any>;
}

/** 工具执行的统一失败信封：不抛异常，让 Agent Loop 能观察到失败并反思。 */
export interface ToolFailure {
  ok: false;
  tool: string;
  error: string;
  hint?: string;
}

export function fail(tool: string, error: string, hint?: string): ToolFailure {
  return { ok: false, tool, error, ...(hint ? { hint } : {}) };
}
