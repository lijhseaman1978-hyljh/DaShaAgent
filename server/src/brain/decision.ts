// brain/decision.ts
// Decision Engine：决策系统。计划书 Phase 1 - Step 4 六、Decision Engine
// 作用：决定下一步干什么。

export class DecisionEngine {
  decide(tasks: any[]): any {
    return tasks.find((task) => task.status === 'pending');
  }
}
