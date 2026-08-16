// memory/core/memoryStore.ts
// Memory 基础存储层：所有记忆统一入口。
// 计划书 Step 5-四：创建 Memory Store

import fs from 'node:fs';
import path from 'node:path';

export interface MemoryItem {
  id: string;
  type: string;
  content: any;
  createdAt: number;
  importance: number;
  tags: string[];
}

export class MemoryStore {
  private storage: MemoryItem[] = [];

  save(memory: MemoryItem): void {
    this.storage.push(memory);
  }

  find(query: string): MemoryItem[] {
    return this.storage.filter((item) => JSON.stringify(item).includes(query));
  }

  findByType(type: string): MemoryItem[] {
    return this.storage.filter((item) => item.type === type);
  }

  getAll(): MemoryItem[] {
    return this.storage;
  }

  clear(): void {
    this.storage = [];
  }

  /** B2 修复：JSON 文件持久化 */
  saveToFile(filePath: string): void {
    try {
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(filePath, JSON.stringify(this.storage, null, 2), 'utf8');
    } catch { /* 非关键 */ }
  }

  /** B2 修复：从 JSON 文件恢复 */
  loadFromFile(filePath: string): void {
    try {
      if (!fs.existsSync(filePath)) return;
      const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (Array.isArray(raw)) this.storage = raw;
    } catch { /* 文件损坏时静默跳过 */ }
  }
}
