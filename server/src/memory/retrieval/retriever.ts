// memory/retrieval/retriever.ts
// Retriever（记忆检索）：Agent 不可能读取全部记忆，需要主动寻找。
// 计划书 Step 5-十一：创建 Retriever

export class Retriever {
  constructor(private memory: any) {}

  retrieve(context: string): any[] {
    return this.memory.recall(context);
  }
}
