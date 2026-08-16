// brain/brain.ts
// Brain：主控制器。计划书 Phase 1 - Step 4 七、Brain 主控制器
// 串联：Context Builder → Reasoner → Planner。
// B14/B15 修复：Reasoner 输出传入 Planner，异步规划
// V3 (2026-08-10): 感知集成 — think() 自动加载感知摘要，传入推理上下文

import { Planner } from './planner';
import { Reasoner } from './reasoner';
import { ContextBuilder } from './contextBuilder';

export interface Thought {
  analysis: string;
  plan: { name: string; children: Array<{ id: string; name: string; status: string; children: any[] }> };
}

export interface ThinkOptions {
  /** 可用工具列表 */
  tools?: string[];
  /** 记忆数据 */
  memory?: Record<string, any>;
  /** 对话历史 */
  history?: any[];
  /** 可用技能 */
  skills?: string[];
  /** 是否跳过感知加载（默认 false，即自动加载） */
  skipPerception?: boolean;
}

export class Brain {
  planner = new Planner();
  reasoner = new Reasoner();
  context = new ContextBuilder();

  async think(goal: string, opts: ThinkOptions = {}): Promise<Thought> {
    // 注入推理引擎（用于 LLM 驱动规划）
    this.planner.setReasoner(this.reasoner);

    // 构建上下文（自动加载感知摘要）
    const ctx = this.context.build(goal, {
      tools: opts.tools,
      memory: opts.memory,
      history: opts.history,
      skills: opts.skills,
      perception: opts.skipPerception ? null : undefined,
    });

    const analysis = await this.reasoner.analyze(ctx);

    // 将 Reasoner 分析结果传入 Planner，实现 LLM 驱动真实规划（B14 修复）
    const plan = await this.planner.plan(goal, { analysis, tools: ctx.tools });
    plan.name = 'root'; // 确保顶层有 name 字段向后兼容

    return {
      analysis,
      plan,
    };
  }

  /**
   * thinkWithContext：使用完整推理上下文（含感知摘要）进行推理。
   * 与 think() 的区别：传给 Reasoner 的是结构化的 reasoning context，
   * 而非扁平的 BuildContext。
   */
  async thinkWithContext(goal: string, opts: ThinkOptions = {}): Promise<Thought> {
    this.planner.setReasoner(this.reasoner);

    const reasoningCtx = this.context.buildReasoningContext(goal, {
      tools: opts.tools,
      memory: opts.memory,
      history: opts.history,
      skills: opts.skills,
      perception: opts.skipPerception ? null : undefined,
    });

    const analysis = await this.reasoner.analyze(reasoningCtx);

    const plan = await this.planner.plan(goal, {
      analysis,
      tools: opts.tools,
    });
    plan.name = 'root';

    return { analysis, plan };
  }
}
