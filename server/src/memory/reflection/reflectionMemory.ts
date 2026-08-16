// memory/reflection/reflectionMemory.ts
// Reflection Memory（错误经验记忆）：保存失败经验，供未来复用。
// 计划书 Step 4-十一：加入 Reflection Memory
// 例如：第一次 PDF 解析失败 → 记录"扫描PDF→OCR" → 以后自动 OCR 优先

import fs from 'node:fs';
import path from 'node:path';
import { CONFIG, ensureDir } from '../../config';

export interface Lesson {
  problem: string;
  cause?: string;
  solution: string;
  success: boolean;
  createdAt?: number;
}

export class ReflectionMemory {
  private file: string;
  private lessons: Lesson[];

  constructor() {
    this.file = path.join(CONFIG.DATA_DIR, 'memory', 'reflection.json');
    this.lessons = this.load();
  }

  private load(): Lesson[] {
    try { return JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch { return []; }
  }

  private save(): void {
    ensureDir(path.dirname(this.file));
    fs.writeFileSync(this.file, JSON.stringify(this.lessons, null, 2), 'utf8');
  }

  saveLesson(lesson: Lesson): void {
    this.lessons.push({ ...lesson, createdAt: Date.now() });
    this.save();
  }

  findSolution(problem: string): Lesson | undefined {
    return this.lessons.find((l) => problem.includes(l.problem) || l.problem.includes(problem));
  }

  getAll(): Lesson[] {
    return this.lessons;
  }
}
