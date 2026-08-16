// memory/episodic/episodicMemory.ts
// Episodic Memory（经历记忆）：保存"发生过什么"。
// 计划书 Step 5-六：创建 Episodic Memory
// 例如：2026-08-03 任务=分析PDF 问题=扫描文件 解决=OCR 结果=成功

import { MemoryStore } from '../core/memoryStore';

export interface Episode {
  task: string;
  problem?: string;
  solution?: string;
  result?: string;
  timestamp?: number;
}

export class EpisodicMemory {
  constructor(private store: MemoryStore) {}

  record(event: Episode): void {
    this.store.save({
      id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
      type: 'episodic',
      content: { ...event, timestamp: Date.now() },
      createdAt: Date.now(),
      importance: 0.8,
      tags: ['experience'],
    });
  }

  getEpisodes(): any[] {
    return this.store.findByType('episodic');
  }
}
