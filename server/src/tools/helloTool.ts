// tools/helloTool.ts
// 第一个测试工具（计划书 Phase 1 - Step 5 十）。
// 让 Agent 第一次拥有可被 Executor 选中的真实工具，完成 Think→Plan→Act→Observe 闭环。

export const HelloTool = {
  name: 'hello',
  description: 'simple hello tool',

  async execute(input: any) {
    return {
      message: 'Hello Agent',
      input,
    };
  },
};
