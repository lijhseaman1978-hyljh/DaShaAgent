// agent/executor/executionContext.ts
// Execution Context（执行上下文）：记录当前任务、执行历史、工具结果、错误。
// 计划书 Step 3-三：创建 Execution Context
// 相当于 Agent 的短期工作记忆。

export interface ExecutionHistoryItem {
  tool: string;
  result: any;
  success: boolean;
}

export interface ExecutionContext {
  taskId: string;
  input: any;
  history: ExecutionHistoryItem[];
  variables: Record<string, any>;
}

export function createContext(taskId: string, input: any): ExecutionContext {
  return {
    taskId,
    input,
    history: [],
    variables: {},
  };
}
