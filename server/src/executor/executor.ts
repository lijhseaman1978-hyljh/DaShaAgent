// executor/executor.ts
// Executor 主控制器：接收 Brain 计划 → 选择工具 → 执行动作 → 观察结果。
// 计划书 Phase 1 - Step 5 八/十一。
// 棕地说明：这是 V3 Step 5 教程层的 Executor（registr = 自带 ToolRegistry）。
//           生产执行路径仍是 agent/executor 的 Executor（含 Recovery/Reflection），二者并存。

import { ToolRegistry, type Tool } from './toolRegistry';
import { ToolSelector } from './toolSelector';
import { ActionRunner } from './actionRunner';
import { Observer } from './observer';

export class Executor {
  registry = new ToolRegistry();
  selector: ToolSelector;
  runner = new ActionRunner();
  observer = new Observer();

  constructor() {
    this.selector = new ToolSelector(this.registry);
  }

  registerTool(tool: Tool) {
    this.registry.register(tool);
  }

  async execute(task: { name: string; description?: string }): Promise<any> {
    const tool = this.selector.select(task.name);

    if (!tool) {
      return {
        success: false,
        error: 'No tool found',
      };
    }

    const result = await this.runner.run(tool, task);
    return this.observer.analyze(result);
  }
}
