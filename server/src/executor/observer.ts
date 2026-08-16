// executor/observer.ts
// Observer（结果观察）：Executor 不只是执行，还要理解结果。
// 计划书 Phase 1 - Step 5 七：把执行结果标注 success 与时间戳。

export class Observer {
  analyze(result: { success: boolean; result?: any; error?: any }) {
    return {
      success: result.success,
      timestamp: Date.now(),
    };
  }
}
