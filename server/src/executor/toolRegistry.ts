// executor/toolRegistry.ts
// Tool Interface（工具标准）+ Tool Registry（工具市场）。
// 计划书 Phase 1 - Step 5 三：所有工具必须统一接口；Registry 负责注册/获取/列举。
// 注意：此处的 Tool 接口是 Step 5 教程层的自包含定义，与 agent/executor 的 capabilities 版 Tool
//       以及 tools/registry.ts 的 ToolDef 互不冲突（import 路径不同，并存不悖）。

export interface Tool {
  name: string;
  description: string;
  execute(input: any): Promise<any>;
}

export class ToolRegistry {
  private tools: Map<string, Tool> = new Map();

  register(tool: Tool) {
    this.tools.set(tool.name, tool);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  list(): Tool[] {
    return Array.from(this.tools.values());
  }
}
