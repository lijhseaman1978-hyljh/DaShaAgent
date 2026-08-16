// skills/core/manager.ts
// V3 Phase 1 - Step 9 §五：Skill Manager —— 负责安装、查询、调用。

import { SkillRegistry } from './registry';

export class SkillManager {
  registry = new SkillRegistry();

  install(skill: any) {
    this.registry.register(skill);
  }

  has(capability: string) {
    return Boolean(this.registry.findCapability(capability));
  }

  // 调用能力对应的技能（§一 架构图「已拥有 → Execute」分支）
  async invoke(capability: string, input: any) {
    const skill = this.registry.findCapability(capability);
    if (!skill) throw new Error(`No skill provides capability: ${capability}`);
    return skill.execute(input);
  }

  list() {
    return this.registry.list();
  }
}
