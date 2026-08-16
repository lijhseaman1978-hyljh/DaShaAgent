// brain/reasoner.ts
// Reasoner：推理模块。计划书 Phase 1 - Step 4 四、Reasoner
// V3 Phase 2 - Step 1 九、Agent Brain 接入真实 LLM —— 改用 llm.smartChat()，
//   由 Router 依据任务特征自动挑模型（代码→openai，超长→claude，隐私→local）。
// 负责：理解问题。

import { llm } from '../llm';

export class Reasoner {
  async analyze(context: any): Promise<string> {
    const goal = String(context?.goal ?? context?.task ?? JSON.stringify(context));

    const result = await llm.smartChat(goal, [
      { role: 'system', content: 'You are an AI reasoning engine' },
      { role: 'user', content: JSON.stringify(context) },
    ]);
    return result.content;
  }

  /** 供上层展示「用了哪个模型 / 花了多久 / 烧了多少 token」 */
  async analyzeDetailed(context: any) {
    const goal = String(context?.goal ?? context?.task ?? JSON.stringify(context));
    const provider = llm.select(goal);
    const result = await llm.chat(provider, [
      { role: 'system', content: 'You are an AI reasoning engine' },
      { role: 'user', content: JSON.stringify(context) },
    ]);
    return { provider, ...result };
  }
}
