// autonomy/goal/goalGenerator.ts
// Goal Generator — 将观察和机会转化为可执行的目标
// V5.0 Step 2：Goal Generation Engine + Curiosity System

import type { Observation } from '../world/worldObserver';
import type { Opportunity } from '../opportunity/detector';
import { type Goal, type GoalSource, createGoal } from './types';
import { logger } from '../../observability';

export class GoalGenerator {
  private generatedGoals: Goal[] = [];
  private readonly maxActiveGoals = 20;

  /** 从机会生成目标 */
  fromOpportunities(opportunities: Opportunity[]): Goal[] {
    const goals: Goal[] = [];

    for (const opp of opportunities) {
      // 去重：检查是否已有相似目标
      if (this.isDuplicate(opp.title)) {
        logger.debug('GoalGenerator', `Skipping duplicate: ${opp.title}`);
        continue;
      }

      const goal = createGoal({
        title: opp.title,
        reason: opp.reason,
        source: 'opportunity',
        priority: opp.priority,
        value: opp.value,
        risk: opp.effort === 'high' ? 0.4 : 0.2,
        suggestedAction: opp.suggestedAction,
        effort: opp.effort,
      });

      goals.push(goal);
      this.generatedGoals.push(goal);
    }

    this.pruneHistory();
    logger.info('GoalGenerator', `Generated ${goals.length} goals from ${opportunities.length} opportunities`);
    return goals;
  }

  /** 从直接观察生成目标（跳过机会检测） */
  fromObservations(observations: Observation[]): Goal[] {
    const goals: Goal[] = [];

    for (const obs of observations) {
      if (obs.importance < 0.4) continue;
      if (this.isDuplicate(obs.description)) continue;

      const goal = createGoal({
        title: obs.description,
        reason: `自动检测到：${obs.type} (重要度 ${(obs.importance * 100).toFixed(0)}%)`,
        source: 'maintenance',
        priority: obs.importance,
        value: obs.importance * 0.8,
        suggestedAction: this.suggestAction(obs),
        effort: obs.importance > 0.8 ? 'high' : 'medium',
      });

      goals.push(goal);
      this.generatedGoals.push(goal);
    }

    this.pruneHistory();
    return goals;
  }

  /** 生成例行维护目标 */
  maintenanceGoals(): Goal[] {
    return [
      createGoal({
        title: '自我提升 — 回顾近期经验并更新知识库',
        reason: '定期维护：积累经验、优化策略',
        source: 'maintenance',
        priority: 0.4,
        value: 0.6,
        suggestedAction: '运行 self-improvement 流程',
        effort: 'medium',
      }),
      createGoal({
        title: '记忆整合 — 整理短期记忆到长期记忆',
        reason: '定期维护：防止遗忘重要信息',
        source: 'maintenance',
        priority: 0.35,
        value: 0.5,
        suggestedAction: '运行 memory consolidation',
        effort: 'low',
      }),
    ];
  }

  /** 获取当前活跃目标 */
  active(): Goal[] {
    return this.generatedGoals.filter(g =>
      ['new', 'pending', 'running'].includes(g.status)
    );
  }

  /** 标记目标完成 */
  complete(id: string, result?: any) {
    const g = this.generatedGoals.find(gl => gl.id === id);
    if (g) {
      g.status = 'completed';
      g.completedAt = Date.now();
      g.result = result;
    }
  }

  /** 标记目标失败 */
  fail(id: string, result?: any) {
    const g = this.generatedGoals.find(gl => gl.id === id);
    if (g) {
      g.retryCount++;
      g.status = g.retryCount >= g.maxRetries ? 'failed' : 'pending';
      g.completedAt = Date.now();
      g.result = result;
    }
  }

  /** 缓存目标 */
  dismiss(id: string) {
    const g = this.generatedGoals.find(gl => gl.id === id);
    if (g) g.status = 'dismissed';
  }

  /** 获取需执行的目标（按优先级排序，排除已完成/失败/废弃） */
  pending(): Goal[] {
    return this.generatedGoals
      .filter(g => ['new', 'pending'].includes(g.status))
      .sort((a, b) => b.priority - a.priority);
  }

  // ═══ 辅助方法 ═══

  private isDuplicate(title: string): boolean {
    const recent = this.generatedGoals.slice(-50);
    return recent.some(g =>
      g.title === title ||
      (g.status === 'new' && this.similar(g.title, title))
    );
  }

  private similar(a: string, b: string): boolean {
    const aWords = new Set(a.replace(/[^\u4e00-\u9fa5a-zA-Z]/g, ' ').split(/\s+/).filter(w => w.length > 1));
    const bWords = b.replace(/[^\u4e00-\u9fa5a-zA-Z]/g, ' ').split(/\s+/).filter(w => w.length > 1);
    let overlap = 0;
    for (const w of bWords) { if (aWords.has(w)) overlap++; }
    return overlap >= Math.max(2, bWords.length * 0.6);
  }

  private suggestAction(obs: Observation): string {
    const map: Record<string, string> = {
      process_down: '重新启动相关进程',
      disk_alert: '清理磁盘空间或增加存储',
      file_change: '检查文件变更并评估是否需要同步或备份',
      cron_status: '检查 Cron 任务日志并修复异常',
    };
    return map[obs.type] || '调查并解决此异常';
  }

  private pruneHistory() {
    if (this.generatedGoals.length > 100) {
      const completed = this.generatedGoals.filter(g => g.status === 'completed');
      if (completed.length > 50) {
        this.generatedGoals = [
          ...completed.slice(-30),
          ...this.generatedGoals.filter(g => g.status !== 'completed'),
        ];
      }
    }
  }
}
