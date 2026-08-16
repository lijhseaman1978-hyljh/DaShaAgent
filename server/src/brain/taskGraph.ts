// brain/taskGraph.ts
// Task Graph：任务图。计划书 Phase 1 - Step 4 二、Task Graph
// 作用：把复杂目标拆成可展开的任务树。

export type TaskStatus = 'pending' | 'running' | 'done';

export interface TaskNode {
  id: string;
  name: string;
  status: TaskStatus;
  children: TaskNode[];
}

export class TaskGraph {
  root?: TaskNode;

  create(goal: string): TaskNode {
    this.root = {
      id: 'root',
      name: goal,
      status: 'pending',
      children: [],
    };
    return this.root;
  }

  add(parent: TaskNode, child: TaskNode): void {
    parent.children.push(child);
  }

  // 扁平化所有节点（便于打印 / 下游 Step 5 Executor 遍历）
  flatten(): TaskNode[] {
    const out: TaskNode[] = [];
    const walk = (n: TaskNode) => {
      out.push(n);
      n.children.forEach(walk);
    };
    if (this.root) walk(this.root);
    return out;
  }
}
