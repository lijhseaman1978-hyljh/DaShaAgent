// skills/factory/installer.ts
// V3 Phase 1 - Step 9 §八：Skill Installer —— 安装生成出来的技能。

export class SkillInstaller {
  install(skill: any, manager: any) {
    manager.install(skill);

    console.log('Skill Installed:', skill.name);
  }
}
