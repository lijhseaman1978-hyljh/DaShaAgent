// agent/reflection/critic.ts
// Critic 批判器：Agent 的"审稿人"，寻找错误、缺失、风险。
// 计划书 Step 4-六：创建 Critic

export interface Criticism {
  issue: string;
  severity: 'low' | 'medium' | 'high';
  suggestion: string;
}

export class Critic {
  review(result: any): Criticism[] {
    const issues: Criticism[] = [];

    if (!result) {
      issues.push({ issue: '结果为空', severity: 'high', suggestion: '重新执行任务' });
      return issues;
    }

    // 文本类结果：检查长度
    if (typeof result === 'string') {
      if (result.length < 10) {
        issues.push({ issue: '结果过短，信息不足', severity: 'medium', suggestion: '补充更多细节' });
      }
      return issues;
    }

    // 对象类结果：检查常见缺失
    if (typeof result === 'object') {
      const obj = result as Record<string, any>;
      if (obj.error) {
        issues.push({ issue: `执行返回错误: ${obj.error}`, severity: 'high', suggestion: '检查错误并重试' });
      }
      if (obj.status === 'failed') {
        issues.push({ issue: '任务状态为 failed', severity: 'high', suggestion: '执行恢复流程' });
      }
      const keys = Object.keys(obj);
      if (keys.length === 0) {
        issues.push({ issue: '结果为空对象', severity: 'medium', suggestion: '确认输出内容' });
      }
    }

    return issues;
  }
}
