// autonomy/goal/goalPrioritizer.ts
// Goal Prioritizer — 目标太多时需要排序
// 排序公式：优先级 = 紧急度 × 价值 ÷ 努力程度
// V5.0 Step 2：Goal Generation Engine + Curiosity System

import type { Goal } from './types';

export class GoalPrioritizer {
  /**
   * 加权排序
   * 公式：score = priority × 0.4 + value × 0.35 + urgency × 0.25 + recencyBonus
   */
  rank(goals: Goal[]): Goal[] {
    return [...goals].sort((a, b) => {
      const scoreA = this.score(a);
      const scoreB = this.score(b);
      return scoreB - scoreA;
    });
  }

  /** 挑选前 N 个最高优先级目标 */
  topN(goals: Goal[], n: number): Goal[] {
    return this.rank(goals).slice(0, n);
  }

  /** 挑选"马上要做"的目标（紧急 + 高价值） */
  urgent(goals: Goal[], threshold = 0.7): Goal[] {
    return this.rank(goals).filter(g => this.score(g) >= threshold);
  }

  /** 挑选"有空再做"的目标（低紧急 + 高价值） */
  backlog(goals: Goal[]): Goal[] {
    return goals
      .filter(g => g.priority < 0.6 && g.value >= 0.5)
      .sort((a, b) => b.value - a.value);
  }

  /** 计算综合得分 */
  score(goal: Goal): number {
    const effortWeight: Record<string, number> = {
      low: 1.2,    // 轻松的事加分
      medium: 1.0,
      high: 0.7,   // 困难的事扣分
    };

    const effort = effortWeight[goal.effort] || 1.0;

    // 紧迫度：最近创建的新目标比老目标更紧迫
    const ageHours = (Date.now() - goal.createdAt) / 3600000;
    const recencyBonus = Math.max(0, 0.1 - ageHours * 0.01); // 1小时内加0.1，10小时后归零

    // 重试惩罚：重试次数越多，得分越低
    const retryPenalty = goal.retryCount * 0.05;

    const raw = goal.priority * 0.4 + goal.value * 0.35 + (1 - goal.risk) * 0.25;
    const adjusted = raw * effort + recencyBonus - retryPenalty;

    return Math.max(0, Math.min(1, adjusted));
  }

  /** 生成排序报告 */
  report(goals: Goal[]): string {
    const ranked = this.rank(goals);
    const lines = ['=== 目标优先级 ==='];
    for (let i = 0; i < Math.min(10, ranked.length); i++) {
      const g = ranked[i];
      const s = this.score(g);
      lines.push(`${i + 1}. [${s.toFixed(2)}] ${g.status === 'new' ? '🆕' : '⏳'} ${g.title}`);
    }
    return lines.join('\n');
  }
}
