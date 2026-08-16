// skills/core/registry.ts
// V3 Phase 1 - Step 9 §四：Skill Registry（技能注册中心）—— 类似 App Store。

import { Skill } from './skill';

export class SkillRegistry {
  private skills: Map<string, Skill> = new Map();

  register(skill: Skill) {
    this.skills.set(skill.id, skill);
  }

  get(id: string) {
    return this.skills.get(id);
  }

  findCapability(capability: string) {
    return Array.from(this.skills.values()).find((skill) =>
      skill.capabilities.includes(capability)
    );
  }

  list() {
    return Array.from(this.skills.values());
  }
}
