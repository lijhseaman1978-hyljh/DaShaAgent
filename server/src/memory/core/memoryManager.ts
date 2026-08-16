// memory/core/memoryManager.ts
// Memory Manager（记忆中枢）：统一管理五层记忆。
// 计划书 Step 5-十：创建 Memory Manager

import { MemoryStore } from './memoryStore';
import { WorkingMemory } from '../working/workingMemory';
import { EpisodicMemory } from '../episodic/episodicMemory';
import { SemanticMemory } from '../semantic/semanticMemory';
import { ProceduralMemory } from '../procedural/proceduralMemory';
import { ReflectionMemory } from '../reflection/reflectionMemory';

export class MemoryManager {
  store: MemoryStore;
  working: WorkingMemory;
  episodic: EpisodicMemory;
  semantic: SemanticMemory;
  procedural: ProceduralMemory;
  reflection: ReflectionMemory;

  constructor() {
    this.store = new MemoryStore();
    this.working = new WorkingMemory();
    this.episodic = new EpisodicMemory(this.store);
    this.semantic = new SemanticMemory();
    this.procedural = new ProceduralMemory();
    this.reflection = new ReflectionMemory();
  }

  // 通用记忆写入（按类型路由到对应子系统）
  remember(type: string, content: any): void {
    if (type === 'working') { this.working.set('current', content); return; }
    if (type === 'episodic') { this.episodic.record(content); return; }
    if (type === 'semantic') { this.semantic.add(content); return; }
    if (type === 'procedural') { this.procedural.addSkill(content); return; }
    if (type === 'reflection') { this.reflection.saveLesson(content); return; }
    // 默认存入 store
    this.store.save({
      id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
      type,
      content,
      createdAt: Date.now(),
      importance: 1,
      tags: [],
    });
  }

  // 通用记忆召回
  recall(query: string): any[] {
    const results: any[] = this.store.find(query);
    // 补充各层匹配
    const sem = this.semantic.search(query);
    if (sem.length) results.push(...sem.map((s) => ({ type: 'semantic', content: s })));
    const pro = this.procedural.find(query);
    if (pro) results.push({ type: 'procedural', content: pro });
    const ref = this.reflection.findSolution(query);
    if (ref) results.push({ type: 'reflection', content: ref });
    return results;
  }
}
