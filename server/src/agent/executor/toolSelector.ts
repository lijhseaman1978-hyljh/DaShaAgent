// agent/executor/toolSelector.ts
// Tool Selector（工具选择器）：根据任务能力匹配工具。
// 计划书 Step 3-四：创建 Tool Selector
// 以前 LLM 决定用哪个工具；现在 Agent 根据任务关键词匹配工具能力。
//
// Phase 4 - Step 1 增强：当任务无法匹配任何工具能力时，自动记录"能力缺口"，
//   供自我进化引擎（capabilityGap.ts）积累数据，而非静默失败。

import { recordGap } from '../../evolution/capabilityGap';

export interface Tool {
  name: string;
  description: string;
  execute: (input: any) => Promise<any>;
  capabilities: string[];
}

export class ToolSelector {
  private tools: Tool[];

  constructor(tools: Tool[]) {
    this.tools = tools;
  }

  select(task: string): Tool | undefined {
    const tool = this.tools.find((t) => {
      return t.capabilities.some((cap) => task.includes(cap));
    });

    // 能力缺口自动捕获：任务无法匹配任何工具能力时记录
    if (!tool && task && task.trim()) {
      try {
        recordGap({
          capability: `工具能力缺失: ${task.slice(0, 40)}`,
          category: 'tool_missing',
          task,
          context: `toolSelector.select 未匹配到工具能力，可用工具 ${this.tools.length} 个`,
          trigger: `任务「${task.slice(0, 60)}」未命中任何工具 capability`,
        });
      } catch (e) {
        // 缺口记录失败不打断主流程
      }
    }

    return tool;
  }

  // 返回所有能处理该任务的工具（供 Recovery 换方案时用）
  selectAll(task: string): Tool[] {
    return this.tools.filter((t) => {
      return t.capabilities.some((cap) => task.includes(cap));
    });
  }

  // 返回全部工具列表（供 Recovery switch_tool 分支查找替代工具）
  getTools(): Tool[] {
    return this.tools;
  }
}