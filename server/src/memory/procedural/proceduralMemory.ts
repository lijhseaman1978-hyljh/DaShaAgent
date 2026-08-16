// memory/procedural/proceduralMemory.ts
// Procedural Memory（技能记忆）：保存"怎么做"。
// 计划书 Step 5-八：创建 Procedural Memory
// 例如：处理PDF流程 = 1 OCR 2 Extract 3 Chunk 4 Vectorize

export interface SkillProcedure {
  name: string;
  steps: string[];
  [key: string]: any;
}

export class ProceduralMemory {
  private skills: any[] = [];

  addSkill(skill: any): void {
    this.skills.push(skill);
  }

  find(task: string): any | undefined {
    return this.skills.find((s) => task.includes(s.name));
  }

  getAll(): any[] {
    return this.skills;
  }
}
