// memory/experienceStore.ts
// Memory Experience Store：把 Step 6 AgentLoop 的 ExperienceStore 接口接到真实 Memory OS。
// 计划书 Phase 1 - Step 7 十一：连接 Agent Loop 与 Memory OS（Persistent Intelligence）。
//
// 棕地说明：本文件不重建 memory/ 模块——仓库里 §二–§十 所描述的五层记忆 + 向量检索早已实现
// （见 core/manager、working/episodic/semantic/procedural/reflection、retrieval、os.ts、vector.ts），
// 且比计划书的「绿野式」最小实现更完整（带磁盘持久化与向量召回）。这里只做「接线」：
// 把 AgentLoop 每轮 remember(`episode:...`, json) 的调用，路由进已有的 MemoryOS 五层记忆，
// 并补上 recall（Future Recall / 经验复用）。

import { MemoryOS } from './os';

// 与 agent-loop/agentLoop.ts 中的 ExperienceStore 结构兼容（鸭子类型即可，无需共享类型）。
export interface StoreLike {
  remember(topic: string, content: string): void;
  retrieve?(query: string): any[];
}

export class MemoryExperienceStore implements StoreLike {
  private os: MemoryOS;

  constructor(os?: MemoryOS) {
    this.os = os ?? new MemoryOS();
  }

  // AgentLoop 每轮末尾调用：remember(`episode:${goal}`, JSON.stringify({goal,result,reflection,time}))
  remember(topic: string, content: string): void {
    try {
      // 1) 经历记忆：topic 以 episode: 开头 → 写入 Episodic Memory
      if (topic.startsWith('episode:')) {
        this.os.recordEpisode(safeParse(content, { goal: topic.slice('episode:'.length) }));
        return;
      }
      // 2) 反思记忆：内容是 {problem, solution} 形态 → 写入 Reflection Memory（错误经验复用）
      const parsed = safeParse(content, null);
      if (parsed && (parsed.problem || parsed.solution)) {
        this.os.saveLesson({
          problem: parsed.problem ?? topic,
          solution: parsed.solution ?? '',
          success: parsed.success ?? false,
        });
        return;
      }
      // 3) 其余作为语义/知识记忆沉淀
      this.os.remember('semantic', content);
    } catch {
      // 记忆写入失败绝不应打断主循环（与 Step 6 约定一致）
    }
  }

  // Future Recall（计划书 §十二）：在执行前检索相关历史经验，支撑「经验复用 / 错误避免」
  retrieve(query: string): any[] {
    try {
      return this.os.recall(query);
    } catch {
      return [];
    }
  }

  // 暴露底层 OS，便于 Runtime 打印快照（snapshot）
  get osRef(): MemoryOS {
    return this.os;
  }
}

function safeParse(s: string, fallback: any): any {
  try { return JSON.parse(s); } catch { return fallback; }
}
