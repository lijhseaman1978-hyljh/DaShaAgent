// brain/contextBuilder.ts
// Context Builder：上下文构建器（B16 修复 + V3 感知集成）。
// 原本硬编码空环境，现接收真实工具列表、记忆、历史等上下文。
// V3 (2026-08-10): 集成感知循环 — build 函数自动加载 perception.md，
//   让 Agent 在推理时"知道"系统当前状态，不必每次都手动探查。

import fs from 'node:fs';
import path from 'node:path';
import { CONFIG } from '../config';

export interface BuildContext {
  goal: string;
  tools?: string[];
  memory?: Record<string, any>;
  history?: any[];
  skills?: string[];
  time?: Date;
  /** 感知摘要（从 perception.md 加载的系统状态快照）；传入 null 表示显式跳过自动加载 */
  perception?: string | null;
}

/** 感知摘要缓存：避免每次 build 都读磁盘 */
let _perceptionCache: { text: string; at: number } | null = null;
const PERCEPTION_TTL_MS = 60_000; // 缓存 1 分钟

export class ContextBuilder {
  /**
   * 构建 Agent 执行上下文。
   * @param goal 用户目标
   * @param opts 可选上下文注入（工具、记忆、历史、技能、感知等）
   */
  build(goal: string, opts: Partial<Omit<BuildContext, 'goal'>> = {}): BuildContext {
    // 自动加载感知摘要（除非显式传入 perception: null 跳过）
    const perception = opts.perception !== undefined
      ? opts.perception
      : ContextBuilder.loadPerception();

    return {
      goal,
      tools: opts.tools ?? [],
      memory: opts.memory ?? {},
      history: opts.history ?? [],
      skills: opts.skills ?? [],
      time: new Date(),
      perception: perception || undefined,
    };
  }

  /**
   * 从 perception.md 加载感知摘要。
   * 带缓存，避免高频 I/O。
   */
  static loadPerception(): string | null {
    const now = Date.now();
    if (_perceptionCache && (now - _perceptionCache.at) < PERCEPTION_TTL_MS) {
      return _perceptionCache.text || null;
    }

    try {
      const fp = path.join(CONFIG.WORKSPACE_DIR, 'notes', 'perception.md');
      if (!fs.existsSync(fp)) return null;

      const raw = fs.readFileSync(fp, 'utf8');
      // 提取最新一份感知报告（第一个 ## 感知报告 块）
      const firstBlock = raw.split('## 感知报告 ·')[0];
      // 如果 perception.md 里确实有报告块，取第一个
      const reportMatch = raw.match(/## 感知报告 ·[\s\S]*?(?=\n## 感知报告 ·|\n\*趋势|\n*$)/);
      const text = reportMatch ? reportMatch[0].trim() : firstBlock.trim();

      _perceptionCache = { text, at: now };
      return text || null;
    } catch {
      return null;
    }
  }

  /**
   * 强制刷新感知缓存（供 perception_loop 任务完成后调用）。
   */
  static flushPerceptionCache(): void {
    _perceptionCache = null;
  }

  /** 为 Planner 构建精简上下文（工具列表 + 记忆摘要 + 感知快照） */
  forPlanning(goal: string, tools: string[], memory: Record<string, any>): string {
    const parts: string[] = [`目标：${goal}`];
    if (tools.length) parts.push(`可用工具：${tools.join(', ')}`);
    if (Object.keys(memory).length) {
      parts.push(
        `记忆摘要：${Object.entries(memory)
          .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
          .join('；')}`
      );
    }
    // 附加感知快照（一句话摘要）
    const perception = ContextBuilder.loadPerception();
    if (perception) {
      // 提取"一句话"行
      const oneLine = perception.match(/> (.+)/);
      if (oneLine) {
        parts.push(`系统状态：${oneLine[1]}`);
      }
    }
    return parts.join('\n');
  }

  /**
   * 构建完整的推理上下文（JSON 结构，供 Reasoner 消费）。
   * 包含：目标、感知摘要、工具列表、记忆、历史。
   */
  buildReasoningContext(goal: string, opts: Partial<Omit<BuildContext, 'goal'>> = {}): Record<string, any> {
    const ctx = this.build(goal, opts);
    const result: Record<string, any> = {
      goal: ctx.goal,
      time: ctx.time?.toISOString(),
    };

    if (ctx.perception) {
      result.system_state = ctx.perception;
    }
    if (ctx.tools && ctx.tools.length > 0) {
      result.available_tools = ctx.tools;
    }
    if (ctx.memory && Object.keys(ctx.memory).length > 0) {
      result.memory = ctx.memory;
    }
    if (ctx.history && ctx.history.length > 0) {
      result.recent_history = ctx.history.slice(-5);
    }

    return result;
  }
}
