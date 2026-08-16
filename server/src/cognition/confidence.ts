// cognition/confidence.ts
// Confidence Tracker — 追踪 Agent 的"诚实度"
// 记录每次验证结果，为后续任务提供置信度基线。

export interface ConfidenceRecord {
  timestamp: number;
  goal: string;
  verified: boolean;
  confidence: number;
  issues: string[];
}

export class ConfidenceTracker {
  private records: ConfidenceRecord[] = [];
  private readonly maxRecords = 50;

  /** 记录一次验证 */
  log(goal: string, verified: boolean, confidence: number, issues: string[]) {
    this.records.push({
      timestamp: Date.now(),
      goal: goal.slice(0, 200),
      verified,
      confidence,
      issues: issues.slice(0, 5),
    });
    if (this.records.length > this.maxRecords) {
      this.records = this.records.slice(-this.maxRecords);
    }
  }

  /** 近期平均置信度 */
  recentAverage(window = 10): number {
    const recent = this.records.slice(-window);
    if (recent.length === 0) return 1.0;
    return recent.reduce((s, r) => s + r.confidence, 0) / recent.length;
  }

  /** 近期通过率 */
  recentPassRate(window = 10): number {
    const recent = this.records.slice(-window);
    if (recent.length === 0) return 1.0;
    const passes = recent.filter(r => r.verified).length;
    return passes / recent.length;
  }

  /** 获取低置信度任务的模式 */
  getWeakPatterns(): string[] {
    const fails = this.records.filter(r => !r.verified);
    if (fails.length < 2) return [];

    // 提取失败任务中的共同关键词
    const wordFreq = new Map<string, number>();
    for (const r of fails) {
      const words = r.goal.replace(/[^\u4e00-\u9fa5a-zA-Z]/g, ' ').split(/\s+/).filter(w => w.length > 1);
      const seen = new Set(words);
      for (const w of seen) {
        wordFreq.set(w, (wordFreq.get(w) || 0) + 1);
      }
    }

    return [...wordFreq.entries()]
      .filter(([_, c]) => c >= 2)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([w]) => w);
  }

  /** 对比历史，判断当前任务是否属于"容易失败"的类型 */
  isRiskyTask(goal: string): boolean {
    const patterns = this.getWeakPatterns();
    if (patterns.length === 0) return false;
    const goalLower = goal.toLowerCase();
    return patterns.some(p => goalLower.includes(p.toLowerCase()));
  }

  /** 获取统计报表 */
  stats() {
    return {
      total: this.records.length,
      verified: this.records.filter(r => r.verified).length,
      failed: this.records.filter(r => !r.verified).length,
      avgConfidence: this.recentAverage(),
      passRate: this.recentPassRate(),
      weakPatterns: this.getWeakPatterns(),
    };
  }
}
