// core/orchestrator.ts
// Orchestrator: Brain (规划) + AgentLoop (执行) 串联
//
// 设计原则:
//   简单任务 → 直通 AgentLoop（不浪费 Brain 的 LLM 调用）
//   复杂任务 → Brain.think() 产出 TaskGraph → 注入用户输入作为路线图 → AgentLoop 执行
//            模型不被强制执行计划，但计划作为「方向锚」防止多步调用中迷路

import { Brain } from '../brain';
import { AgentLoop } from './agentLoop';
import type { Provider, RunCallbacks } from './types';

/** 不触发规划的简单模式 */
const SIMPLE_RE = /^(你好|hi|hello|谢谢|再见|bye|什么是|怎么|为什么|几点|今天|天气|算|翻译|解释|帮我查|搜索|现在|你是谁|你能)/i;

export class Orchestrator {
  private brain: Brain;

  constructor(private loop: AgentLoop) {
    this.brain = new Brain();
  }

  async run(opts: {
    userInput: string;
    sessionId: string;
    callbacks?: RunCallbacks;
    provider?: Provider;
    temperature?: number;
    attachments?: Array<{ name: string; path: string; size: number; mime: string; text?: string }>;
    signal?: AbortSignal;
    systemOverride?: string;   // 透传给 AgentLoop
    extraTools?: any[];         // 透传
  }): Promise<string> {
    const { userInput, callbacks } = opts;

    // 简单任务 — 直通（节省 Brain 的一次 LLM 调用）
    if (this.isSimple(userInput)) {
      return this.loop.run(opts);
    }

    // 复杂任务 — Brain 先规划
    callbacks?.onActivity?.({ type: 'info', message: '正在分析任务并制定执行计划...' });
    try {
      const thought = await this.brain.think(userInput);

      if (thought?.plan?.children?.length) {
        const planText = this.formatPlan(thought.plan);
        const enhancedInput = planText + '\n' + userInput;

        callbacks?.onActivity?.({
          type: 'info',
          message: `任务分解为 ${thought.plan.children.length} 步: ${thought.plan.children.map((c: any) => c.name).join(' → ')}`
        });

        return this.loop.run({ ...opts, userInput: enhancedInput });
      }
    } catch (e: any) {
      console.log('[Orchestrator] Brain planning failed, falling back to direct:', e.message);
    }

    // Brain 规划失败或无产出 — 回退到直接执行
    return this.loop.run(opts);
  }

  // ── 简单任务判断 ──
  private isSimple(input: string): boolean {
    const trimmed = input.trim();
    if (trimmed.length <= 20) return true;
    if (SIMPLE_RE.test(trimmed)) return true;
    // 纯单步操作：读文件、打开URL等
    if (/^(读|查看|打开|显示|列出|获取)/.test(trimmed) && trimmed.length < 40) return true;
    return false;
  }

  // ── 格式化规划为自然语言 ──
  private formatPlan(plan: any): string {
    const steps = plan.children.map((c: any, i: number) => `${i + 1}. ${c.name}`).join('\n');
    return `【执行计划 — 请按以下步骤推进，但可根据实际情况灵活调整】\n${steps}\n`;
  }
}
