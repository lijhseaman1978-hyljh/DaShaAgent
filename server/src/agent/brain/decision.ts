// agent/brain/decision.ts
// Decision 决策模块：选择下一步。
// 计划书 Step 2-五：创建 Decision
// 从 TaskGraph 的 ready 任务中选择下一个执行。

import { TaskGraph } from './taskGraph';
import type { Task } from './taskGraph';

export class DecisionEngine {
  selectNext(graph: TaskGraph): Task | null {
    const ready = graph.getReadyTasks();
    if (ready.length === 0) return null;
    return ready[0];
  }
}
