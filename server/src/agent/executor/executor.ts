// agent/executor/executor.ts
// Executor 执行器：行动发动机。
// Step 3-七 创建 Executor；Step 4-九 连接 Reflection（Evaluator/Critic/SelfImprove）

import { createContext, type ExecutionContext } from './executionContext';
import { retry } from './retry';
import { RecoveryManager } from './recovery';
import { Evaluator, Critic, SelfImprove } from '../reflection';
import type { Tool } from './toolSelector';

export interface ExecutorResult {
  status: 'completed' | 'recovered' | 'failed';
  context: ExecutionContext;
  result?: any;
  recovery?: any;
  reflection?: any;
}

export class Executor {
  private recoveryManager = new RecoveryManager();
  private evaluator = new Evaluator();
  private critic = new Critic();
  private improve = new SelfImprove();

  constructor(private toolSelector: any) {}

  async execute(task: any): Promise<ExecutorResult> {
    const context = createContext(task.id, task.description);

    // 选择工具
    let tool: Tool | undefined = this.toolSelector.select(task.description);
    if (!tool) {
      const plan = await this.recoveryManager.recover(new Error('No suitable tool'));
      return { status: 'failed', context, recovery: plan, result: { error: 'No suitable tool' } };
    }

    try {
      const result = await retry(() => tool!.execute(task.description));
      context.history.push({ tool: tool.name, result, success: true });

      // Step 4：执行后反思 —— Evaluator 评价 + Critic 审查
      const evaluation = this.evaluator.evaluate(task, result);
      const issues = this.critic.review(result);
      const improvePlan = this.improve.improve(issues);

      const reflection = { evaluation, issues, improvePlan };

      // 有严重问题 → 标记为需重试（但结果已拿到，供上层决定）
      if (!evaluation.pass || issues.some((i: any) => i.severity === 'high')) {
        return { status: 'failed', context, result, recovery: { action: 'retry', reason: issues }, reflection };
      }

      return { status: 'completed', context, result, reflection };
    } catch (error) {
      const plan = await this.recoveryManager.recover(error);
      context.history.push({ tool: tool.name, result: String(error), success: false });

      if (plan.action === 'switch_tool' && plan.alternativeTool) {
        const altTool = this.toolSelector.getTools?.().find((t: Tool) => t.name === plan.alternativeTool);
        if (altTool) {
          try {
            const result = await altTool.execute(task.description);
            context.history.push({ tool: altTool.name, result, success: true });
            return { status: 'recovered', context, result, recovery: plan };
          } catch (e) {
            return { status: 'failed', context, recovery: plan, result: String(e) };
          }
        }
      }

      return { status: 'failed', context, recovery: plan, result: String(error) };
    }
  }
}
