// skills/builtin/coding.skill.ts
// V3 Phase 1 - Step 9 §二：内置技能 —— Coding Skill（§三 给出的示例形态）。
// 注意：本目录同时存放文档型技能包（<slug>/SKILL.md），loader.ts 只递归目录、
//       跳过普通文件（`if (!e.isDirectory()) continue;`），因此这些 .ts 不会干扰技能扫描。

import type { Skill } from '../core/skill';

export const CodingSkill: Skill = {
  id: 'coding',
  name: 'Coding Skill',
  description: '写代码、调试、重构',
  capabilities: ['coding', 'write_code', 'debug', 'refactor'],
  async execute(input: any) {
    return { skill: 'coding', input, output: 'generated code' };
  },
};
