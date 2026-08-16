// agent/brain/reasoning.ts
// Reasoning 推理模块：回答"为什么这样做"。
// 计划书 Step 2-四：创建 Reasoning
// 分析目标复杂度并选择策略（不是执行）。

export interface ReasoningResult {
  goal: string;
  complexity: 'high' | 'normal' | 'low';
  strategy: 'multi-step' | 'simple' | 'research';
}

export class ReasoningEngine {
  analyze(goal: string): ReasoningResult {
    return {
      goal,
      complexity: this.calculate(goal),
      strategy: this.chooseStrategy(goal),
    };
  }

  private calculate(goal: string): 'high' | 'normal' | 'low' {
    if (goal.length > 100) return 'high';
    if (goal.length > 20) return 'normal';
    return 'low';
  }

  private chooseStrategy(goal: string): 'multi-step' | 'simple' | 'research' {
    if (goal.includes('开发') || goal.includes('系统') || goal.includes('平台')) return 'multi-step';
    if (goal.includes('分析') || goal.includes('研究') || goal.includes('调研')) return 'research';
    return 'simple';
  }
}
