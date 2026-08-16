// memory/os.ts
// Memory OS 总装：聚合五层记忆，对外统一入口。
// 计划书 Step 5：Memory OS 重构（超级记忆系统）
// Working + Episodic + Semantic + Procedural + Reflection + Retrieval

import { MemoryManager } from './core/memoryManager';
import { Retriever } from './retrieval/retriever';

export class MemoryOS {
  manager: MemoryManager;
  retriever: Retriever;

  constructor() {
    this.manager = new MemoryManager();
    this.retriever = new Retriever(this.manager);
  }

  // 写入各层记忆
  remember(type: string, content: any): void {
    this.manager.remember(type, content);
  }

  // 召回记忆（结合向量/关键词）
  recall(query: string): any[] {
    return this.retriever.retrieve(query);
  }

  // 工作记忆便捷方法
  setWorking(key: string, value: any): void {
    this.manager.working.set(key, value);
  }
  getWorking(key: string): any {
    return this.manager.working.get(key);
  }

  // 经历记忆
  recordEpisode(episode: any): void {
    this.manager.episodic.record(episode);
  }

  // 知识记忆
  addKnowledge(knowledge: any): void {
    this.manager.semantic.add(knowledge);
  }

  // 技能记忆
  addProcedure(skill: any): void {
    this.manager.procedural.addSkill(skill);
  }

  // 错误经验
  saveLesson(lesson: any): void {
    this.manager.reflection.saveLesson(lesson);
  }

  // 完整状态（供 UI / 监控）
  snapshot(): any {
    return {
      working: this.manager.working.getAll(),
      episodic: this.manager.episodic.getEpisodes().length,
      semantic: this.manager.semantic.getAll().length,
      procedural: this.manager.procedural.getAll().length,
      reflection: this.manager.reflection.getAll().length,
    };
  }
}
