// brain/planner.ts
// Planner：LLM 驱动的任务规划器（B15 修复）。
// 原本硬编码 ["Analyze requirement", "Execute solution"]，现改为：
//   1. 先用 Reasoner 分析目标
//   2. 再根据分析结果动态分解为子任务树
//   3. 若 LLM 不可用，退化为关键词启发式分解

import { TaskGraph } from './taskGraph';
import type { Reasoner } from './reasoner';

export class Planner {
  private graph = new TaskGraph();
  private reasoner: Reasoner | null = null;

  /** 注入推理引擎（由 Brain 在初始化时调用） */
  setReasoner(r: Reasoner) {
    this.reasoner = r;
  }

  /**
   * 将复杂目标分解为可执行子任务。
   * @param goal 用户目标
   * @param context 上下文（工具列表、记忆、历史等）
   */
  async plan(goal: string, context?: Record<string, any>): Promise<any> {
    // 简短目标不需要分解（≤20 字直接单步执行）
    if (goal.length <= 20) {
      const root = this.graph.create(goal);
      root.children = [{ id: '1', name: goal, status: 'pending', children: [] }];
      return root;
    }

    // 尝试 LLM 驱动分解
    if (this.reasoner) {
      try {
        const toolsHint = context?.tools
          ? `\n可用工具：${JSON.stringify(context.tools)}`
          : '';
        const analysis = await this.reasoner.analyze({
          goal,
          context,
          instruction:
            `请将这个目标分解为 2-5 个顺序执行的具体子任务。${toolsHint}\n` +
            `返回格式：每行一个子任务，用 "1. " 开头，描述要具体可操作。\n` +
            `示例：\n` +
            `1. 读取并解析指定文件\n` +
            `2. 分析数据并提取关键信息\n` +
            `3. 生成格式化的输出报告`,
        });

        const steps = this.parseSteps(analysis);
        if (steps.length > 0) {
          const root = this.graph.create(goal);
          root.children = steps.map((name, i) => ({
            id: String(i + 1),
            name,
            status: 'pending' as const,
            children: [],
          }));
          return root;
        }
      } catch {
        // LLM 失败时退化到启发式分解
      }
    }

    // 关键词启发式兜底
    return this.heuristicPlan(goal);
  }

  /** 从 Reasoner 输出中提取步骤列表 */
  private parseSteps(text: string): string[] {
    const lines = text.split('\n').filter((l) => /^\d+[\.\)、]\s*/.test(l.trim()));
    return lines
      .map((l) => l.replace(/^\d+[\.\)、]\s*/, '').trim())
      .filter((s) => s.length > 0);
  }

  /** 关键词启发式分解（LLM 不可用时的兜底） */
  private heuristicPlan(goal: string) {
    const root = this.graph.create(goal);
    const g = goal.toLowerCase();

    if (g.includes('读') || g.includes('读取') || g.includes('查看') || g.includes('文件')) {
      root.children = [
        { id: '1', name: '定位并读取目标文件', status: 'pending', children: [] },
        { id: '2', name: '分析内容并提取关键信息', status: 'pending', children: [] },
        { id: '3', name: '整理并呈现结果', status: 'pending', children: [] },
      ];
    } else if (g.includes('写') || g.includes('生成') || g.includes('创建') || g.includes('报告')) {
      root.children = [
        { id: '1', name: '收集必要信息与数据', status: 'pending', children: [] },
        { id: '2', name: '分析并组织内容结构', status: 'pending', children: [] },
        { id: '3', name: '生成最终文档/报告', status: 'pending', children: [] },
      ];
    } else if (g.includes('搜索') || g.includes('查') || g.includes('找')) {
      root.children = [
        { id: '1', name: '确定搜索范围与关键词', status: 'pending', children: [] },
        { id: '2', name: '执行搜索并收集结果', status: 'pending', children: [] },
        { id: '3', name: '整理筛选并总结', status: 'pending', children: [] },
      ];
    } else {
      root.children = [
        { id: '1', name: '分析需求：' + goal.slice(0, 30), status: 'pending', children: [] },
        { id: '2', name: '执行并交付结果', status: 'pending', children: [] },
      ];
    }

    return root;
  }

  /** 同步版本（向后兼容） */
  planSync(goal: string) {
    return this.heuristicPlan(goal);
  }
}
