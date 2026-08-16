// autonomy/goal/types.ts
// Goal 数据模型 — Agent 自主生成的目标
// V5.0 Step 2：Goal Generation Engine + Curiosity System

export type GoalStatus = 'new' | 'pending' | 'running' | 'completed' | 'failed' | 'dismissed';
export type GoalSource = 'opportunity' | 'curiosity' | 'maintenance' | 'user' | 'evolution';

export interface Goal {
  id: string;
  title: string;
  reason: string;
  source: GoalSource;
  priority: number;        // 0-1
  value: number;           // 0-1，完成的价值
  risk: number;            // 0-1，执行风险
  status: GoalStatus;
  suggestedAction: string;
  effort: 'low' | 'medium' | 'high';
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  result?: any;
  retryCount: number;
  maxRetries: number;
}

/** 创建新目标 */
export function createGoal(partial: Partial<Goal> & { title: string; reason: string }): Goal {
  return {
    id: `goal_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    title: partial.title,
    reason: partial.reason,
    source: partial.source || 'opportunity',
    priority: partial.priority || 0.5,
    value: partial.value || 0.5,
    risk: partial.risk || 0.2,
    status: 'new',
    suggestedAction: partial.suggestedAction || partial.reason,
    effort: partial.effort || 'medium',
    createdAt: Date.now(),
    retryCount: 0,
    maxRetries: partial.maxRetries || 3,
  };
}
