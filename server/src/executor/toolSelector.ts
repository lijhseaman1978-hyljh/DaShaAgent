// executor/toolSelector.ts
// Tool Selector（工具选择器）：根据任务文本选择工具。
// 计划书 Phase 1 - Step 5 四：task 文本若包含某工具名，则选中该工具。
//
// Phase 4 - Step 1 增强：当找不到匹配工具时，自动记录"能力缺口"，
//   供自我进化引擎（capabilityGap.ts）积累数据，而非静默失败。

import { ToolRegistry } from './toolRegistry';
import { recordGap } from '../evolution/capabilityGap';

export class ToolSelector {
  constructor(private registry: ToolRegistry) {}

  select(task: string): ReturnType<ToolRegistry['list']>[number] | undefined {
    const tools = this.registry.list();
    const tool = tools.find((t) => task.toLowerCase().includes(t.name));

    // 能力缺口自动捕获：任务文本无法匹配任何已知工具时记录
    if (!tool && task && task.trim()) {
      try {
        recordGap({
          capability: `工具缺失: ${task.slice(0, 40)}`,
          category: 'tool_missing',
          task,
          context: `toolSelector.select 未匹配到工具，可用工具 ${tools.length} 个`,
          trigger: `无工具名匹配任务文本「${task.slice(0, 60)}」`,
        });
      } catch (e) {
        // 缺口记录失败不打断主流程
      }
    }

    return tool;
  }
}