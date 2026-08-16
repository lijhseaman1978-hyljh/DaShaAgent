// autonomy/opportunity/detector.ts
// Opportunity Detector — 从观察中发现"值得做的事"
// V5.0 Step 2：Goal Generation Engine + Curiosity System

import type { Observation } from '../world/worldObserver';

export interface Opportunity {
  id: string;
  category: 'fix' | 'improve' | 'explore' | 'maintain' | 'alert';
  title: string;
  reason: string;
  priority: number;
  value: number;
  effort: 'low' | 'medium' | 'high';
  sourceObservation: Observation;
  suggestedAction: string;
  createdAt: number;
}

interface RuleResult {
  category: Opportunity['category'];
  title: string;
  priority: number;
  value: number;
  effort: Opportunity['effort'];
  reason?: string;
  action?: string;
}

type MatchFn = (obs: Observation) => RuleResult | false;

export class OpportunityDetector {
  private rules: { name: string; match: MatchFn }[] = [];

  constructor() {
    this.registerDefaultRules();
  }

  registerRule(rule: { name: string; match: MatchFn }) {
    this.rules.push(rule);
  }

  detect(observations: Observation[]): Opportunity[] {
    const opportunities: Opportunity[] = [];

    for (const obs of observations) {
      for (const rule of this.rules) {
        try {
          const match = rule.match(obs);
          if (match) {
            opportunities.push({
              id: `opp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
              category: match.category,
              title: match.title,
              reason: match.reason || obs.description,
              priority: match.priority,
              value: match.value,
              effort: match.effort,
              sourceObservation: obs,
              suggestedAction: match.action || this.defaultAction(obs),
              createdAt: Date.now(),
            });
            break;
          }
        } catch { /* 规则异常不中断 */ }
      }
    }

    opportunities.sort((a, b) => b.priority - a.priority);
    return opportunities;
  }

  private defaultAction(obs: Observation): string {
    const actions: Record<string, string> = {
      process_down: '尝试重启对应进程',
      disk_alert: '清理磁盘空间',
      file_change: '检查文件变更内容',
      cron_status: '检查 Cron 任务状态',
    };
    return actions[obs.type] || '调查此异常';
  }

  private registerDefaultRules() {
    this.registerRule({
      name: 'process_down_alert',
      match: (obs) => obs.type === 'process_down' && obs.importance >= 0.8
        ? { category: 'fix', title: '进程已停止运行', priority: 0.95, value: 0.9, effort: 'low', action: '重新启动已停止的进程' }
        : false,
    });

    this.registerRule({
      name: 'disk_alert',
      match: (obs) => obs.type === 'disk_alert'
        ? { category: 'maintain', title: '磁盘空间不足', priority: 0.8, value: 0.7, effort: 'medium', action: '清理临时文件和旧日志' }
        : false,
    });

    this.registerRule({
      name: 'cron_failure',
      match: (obs) => obs.type === 'cron_status' && obs.importance >= 0.7
        ? { category: 'fix', title: '定时任务执行异常', priority: 0.85, value: 0.8, effort: 'medium', action: '检查并修复 Cron 任务' }
        : false,
    });

    this.registerRule({
      name: 'file_change_important',
      match: (obs) => obs.type === 'file_change' && obs.importance >= 0.5
        ? { category: 'explore', title: '重要文件已变更', priority: 0.5, value: 0.4, effort: 'low', action: '审查文件变更并评估影响' }
        : false,
    });

    this.registerRule({
      name: 'high_importance_generic',
      match: (obs) => obs.importance >= 0.7
        ? { category: 'alert', title: '高优先级事件', priority: obs.importance, value: 0.5, effort: 'medium', action: '调查此事件' }
        : false,
    });
  }
}
