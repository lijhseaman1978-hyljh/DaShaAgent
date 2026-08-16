// skills/core/skill.ts
// V3 Phase 1 - Step 9 §三：Skill 标准协议 —— 所有技能统一格式。
//
// 棕地说明：本项目已有两套「技能」概念：
//   1) skills/builtin/**/SKILL.md + skills/loader.ts —— 文档型技能包（给 LLM 读的说明书）；
//   2) agent-os/skill/skillRegistry.ts —— V2 的可执行 Skill（带 version / unregister 等）。
//   本文件是 Step 9 教程层的第三套：最小可执行协议 + Skill Factory 自进化闭环。
//   三者并存，互不替代（并排扩展原则）。

export interface Skill {
  id: string;
  name: string;
  description: string;

  capabilities: string[];

  execute(input: any): Promise<any>;
}
