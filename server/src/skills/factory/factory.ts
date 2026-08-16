// skills/factory/factory.ts
// V3 Phase 1 - Step 9 §九：Skill Factory 总控制器 —— 能力自进化闭环。
// Capability Check → 缺失 → Generate → Install → Update Agent

import { CapabilityAnalyzer } from './analyzer';
import { SkillGenerator } from './generator';
import { SkillInstaller } from './installer';

export class SkillFactory {
  analyzer = new CapabilityAnalyzer();

  generator = new SkillGenerator();

  installer = new SkillInstaller();

  async evolve(task: string, manager: any) {
    const capabilities = this.analyzer.analyze(task);

    for (const cap of capabilities) {
      if (!manager.has(cap)) {
        const skill = await this.generator.create(cap);

        this.installer.install(skill, manager);
      }
    }
  }
}
