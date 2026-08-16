// memory/semantic/semanticMemory.ts
// Semantic Memory（知识记忆）：保存事实。
// 计划书 Step 5-七：创建 Semantic Memory
// 例如：MARPOL 是国际防污染公约；PSC重点检查=消防/救生/ISM

export class SemanticMemory {
  private knowledge: any[] = [];

  add(knowledge: any): void {
    this.knowledge.push(knowledge);
  }

  search(keyword: string): any[] {
    return this.knowledge.filter((k) => JSON.stringify(k).includes(keyword));
  }

  getAll(): any[] {
    return this.knowledge;
  }
}
