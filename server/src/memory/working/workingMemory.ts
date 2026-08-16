// memory/working/workingMemory.ts
// Working Memory（工作记忆）：当前正在思考的问题。
// 计划书 Step 5-五：创建 Working Memory
// 例如：当前目标=开发网站，当前步骤=数据库设计，等待=API接口
//
// B28 修复：添加容量上限防止退化为无限日志，默认 100 条

export class WorkingMemory {
  private state: any = {};
  private history: Array<{ at: number; key: string; value: any }> = [];
  private maxHistory: number;

  constructor(capacity = 100) {
    this.maxHistory = capacity;
  }

  set(key: string, value: any): void {
    this.state[key] = value;
    this.history.push({ at: Date.now(), key, value });
    // 容量上限：淘汰最早记录
    while (this.history.length > this.maxHistory) {
      this.history.shift();
    }
  }

  get(key: string): any {
    return this.state[key];
  }

  getAll(): any {
    return { ...this.state };
  }

  /** 获取变更历史 */
  getHistory(): Array<{ at: number; key: string; value: any }> {
    return [...this.history];
  }

  /** 当前条目数 */
  get size(): number {
    return Object.keys(this.state).length;
  }

  clear(): void {
    this.state = {};
    this.history = [];
  }
}
