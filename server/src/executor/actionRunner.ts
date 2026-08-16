// executor/actionRunner.ts
// Action Runner（动作执行器）：真正调用工具，并把异常转成结构化结果。
// 计划书 Phase 1 - Step 5 五。

export class ActionRunner {
  async run(tool: { execute: (input: any) => Promise<any> }, input: any) {
    try {
      const result = await tool.execute(input);
      return { success: true, result };
    } catch (error) {
      return { success: false, error };
    }
  }
}
