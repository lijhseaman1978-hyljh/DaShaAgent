import { AgentLoop, type AgentDeps } from '../core/agentLoop';
import type { RunCallbacks } from '../core/types';

export interface TeamRole {
  name: string;
  systemPrompt: string;
  task?: string; // 覆盖默认 task，给该角色专属子任务
}

export interface TeamResult {
  role: string;
  output: string;
}

// 多智能体：把同一任务派发给多个角色子 Agent 并行执行，再汇总。
export class TeamRunner {
  constructor(private deps: AgentDeps) {}

  async run(
    task: string,
    roles: TeamRole[],
    callbacks?: RunCallbacks,
  ): Promise<TeamResult[]> {
    callbacks?.onActivity?.({ type: 'info', message: `多智能体启动：${roles.map(r => r.name).join('、')}` });
    const loop = new AgentLoop(this.deps);
    // P4 FIX: 用 allSettled 防止单个 Agent 崩溃拖垮整个团队
    const settled = await Promise.allSettled(
      roles.map(async (role) => {
        const sessionId = 'team_' + Date.now() + '_' + role.name;
        const subTask = role.task || `你的角色是【${role.name}】。请基于以下总任务给出你的专业输出：\n${task}`;
        const output = await loop.run({
          userInput: subTask,
          sessionId,
          callbacks,
          systemOverride: role.systemPrompt,
        });
        return { role: role.name, output };
      }),
    );
    return settled.map((r) => r.status === 'fulfilled'
      ? r.value
      : { role: 'unknown', output: `（子Agent异常: ${String((r as any).reason?.message || (r as any).reason).slice(0, 100)}）` });
  }
}
