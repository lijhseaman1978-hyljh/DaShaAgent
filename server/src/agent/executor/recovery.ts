// agent/executor/recovery.ts
// Recovery（恢复系统）：失败后分析原因，决定下一步。
// 计划书 Step 3-六：创建 Recovery
// 以后升级：retry → switch tool → ask human → rewrite plan
//
// Phase 4 - Step 1 增强：失败时自动记录"能力缺口"，供自我进化引擎积累数据。

import { recordGap } from '../../evolution/capabilityGap';

export type RecoveryAction = 'retry' | 'switch_tool' | 'ask_human' | 'rewrite_plan' | 'give_up';

export interface RecoveryPlan {
  action: RecoveryAction;
  reason?: string;
  alternativeTool?: string;
}

export class RecoveryManager {
  async recover(error: any): Promise<RecoveryPlan> {
    console.log('Analyzing failure', error);
    const msg = String(error?.message || error || '');

    // 失败时记录能力缺口（不打断恢复流程）
    try {
      recordGap({
        capability: `任务失败: ${msg.slice(0, 40)}`,
        category: 'task_failure',
        trigger: msg.slice(0, 300),
        context: 'RecoveryManager.recover 捕获到执行失败',
      });
    } catch (e) { /* 缺口记录失败不打断恢复 */ }

    // 基于错误类型做初步恢复策略
    if (/no suitable tool|no tool|not found/i.test(msg)) {
      return { action: 'rewrite_plan', reason: '无匹配工具，需重新规划' };
    }
    if (/timeout|timed out|ETIMEDOUT/i.test(msg)) {
      return { action: 'retry', reason: '超时，重试' };
    }
    if (/auth|401|403|permission|denied/i.test(msg)) {
      return { action: 'ask_human', reason: '权限问题，需人工介入' };
    }

    // 默认：重试
    return { action: 'retry' };
  }
}