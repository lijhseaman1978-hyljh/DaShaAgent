// skills/factory/generator.ts
// V3 Phase 1 - Step 9 §七：Skill Generator（技能生成器）—— 缺什么能力就让 LLM 造什么技能。

import { llm } from '../../llm';

export class SkillGenerator {
  async create(capability: string) {
    const response = await llm.chat('openai', [
      {
        role: 'system',
        content: 'You create AI agent skills',
      },
      {
        role: 'user',
        content: `
Create skill:

${capability}

`,
      },
    ]);

    return {
      id: capability,

      name: `${capability} skill`,

      description: response.content,

      capabilities: [capability],

      // 计划书 §七 只生成元数据；这里补一个可运行的默认执行体，
      // 让生成的技能满足 Skill 协议（core/skill.ts）从而能被真正调用。
      async execute(input: any) {
        return { skill: capability, input, note: response.content };
      },
    };
  }
}
