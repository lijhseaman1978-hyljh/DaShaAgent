// skills/factory/analyzer.ts
// V3 Phase 1 - Step 9 §六：Capability Analyzer（能力分析器）—— 判断任务需要什么能力。

export class CapabilityAnalyzer {
  analyze(task: string) {
    const result: string[] = [];

    if (task.includes('代码') || task.includes('程序')) {
      result.push('coding');
    }

    if (task.includes('网页') || task.includes('浏览')) {
      result.push('browser');
    }

    if (task.includes('分析')) {
      result.push('analysis');
    }

    // §十一 测试场景：「帮我分析全球航运市场趋势」→ analysis(已有) + shipping(缺失)
    if (task.includes('航运') || task.includes('shipping')) {
      result.push('shipping');
    }

    return result;
  }
}
