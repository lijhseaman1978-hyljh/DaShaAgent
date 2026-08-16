// agent/reflection/selfImprove.ts
// Self Improve 自我改进模块：根据问题生成修正方案。
// 计划书 Step 4-七：创建 SelfImprove

export interface ImprovePlan {
  action: 'continue' | 'retry' | 'rewrite';
  reason?: any;
}

export class SelfImprove {
  improve(issues: any[]): ImprovePlan {
    if (issues.length === 0) {
      return { action: 'continue' };
    }
    // 有严重问题 → 重试；只有轻微问题 → 继续但记录
    const hasHigh = issues.some((i: any) => i.severity === 'high');
    if (hasHigh) {
      return { action: 'retry', reason: issues };
    }
    return { action: 'continue', reason: issues };
  }
}
