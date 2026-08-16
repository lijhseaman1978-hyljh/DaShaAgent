// agent/brain/planner.ts
// Planner 规划器：目标 → 任务计划。
// 计划书 Step 2-三：创建 Planner
// 一句话需求 → 任务树。此版本为规则版，未来连接 LLM 生成任务计划。

import { TaskGraph } from './taskGraph';

export class Planner {
  async createPlan(goal: string): Promise<TaskGraph> {
    const graph = new TaskGraph();

    // 计划书示例：按关键词规划（未来连接 LLM 生成真正任务树）
    if (goal.includes('网站') || goal.includes('web') || goal.includes('website')) {
      graph.addTask({ id: 'design', title: '网站设计', description: '设计页面结构', status: 'pending', dependencies: [], children: [] });
      graph.addTask({ id: 'frontend', title: '前端开发', description: '实现用户界面', status: 'pending', dependencies: ['design'], children: [] });
      graph.addTask({ id: 'backend', title: '后端开发', description: '开发API', status: 'pending', dependencies: ['design'], children: [] });
    } else if (goal.includes('PDF') || goal.includes('pdf') || goal.includes('文档') || goal.includes('分析')) {
      graph.addTask({ id: 'read', title: '读取文件', description: `读取并理解: ${goal}`, status: 'pending', dependencies: [], children: [] });
      graph.addTask({ id: 'analyze', title: '分析内容', description: '提取关键信息并分析', status: 'pending', dependencies: ['read'], children: [] });
      graph.addTask({ id: 'report', title: '生成报告', description: '输出分析结论', status: 'pending', dependencies: ['analyze'], children: [] });
    } else {
      graph.addTask({ id: 'research', title: '分析任务', description: goal, status: 'pending', dependencies: [], children: [] });
    }

    return graph;
  }
}
