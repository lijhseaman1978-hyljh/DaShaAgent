// agent/brain/taskGraph.ts
// Task Graph：Agent 的"思维地图"。
// 计划书 Step 2-二：创建 Task Graph
// 管理任务依赖：哪些完成、哪些等待、哪些失败。

export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface Task {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  dependencies: string[];
  children: Task[];
}

export class TaskGraph {
  private tasks: Map<string, Task>;

  constructor() {
    this.tasks = new Map();
  }

  addTask(task: Task): void {
    this.tasks.set(task.id, task);
  }

  getTask(id: string): Task | undefined {
    return this.tasks.get(id);
  }

  getAll(): Task[] {
    return Array.from(this.tasks.values());
  }

  // 找出所有"待执行且依赖已完成"的任务
  getReadyTasks(): Task[] {
    return this.getAll().filter((task) => {
      if (task.status !== 'pending') return false;
      return task.dependencies.every((id) => this.tasks.get(id)?.status === 'completed');
    });
  }

  // 标记任务状态
  mark(id: string, status: TaskStatus): void {
    const t = this.tasks.get(id);
    if (t) t.status = status;
  }

  // 是否全部完成
  isComplete(): boolean {
    return this.getAll().every((t) => t.status === 'completed');
  }
}
