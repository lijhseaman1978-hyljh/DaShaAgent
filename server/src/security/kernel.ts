// security/kernel.ts
// 计划书 Phase 3 - Step 1 §九：Security Kernel 总入口。
// Agent 的任何危险动作都必须先过这一层：Permission Check → Threat Detect → Monitor Log。

import { PermissionEngine } from './permission';
import { ExecutionMonitor } from './monitor';
import { ThreatDetector } from './threatDetector';
import { DefaultPolicy, type SecurityPolicy } from './policy';

export interface GuardResult {
  allowed: boolean;
  reason?: string;
}

export class SecurityKernel {
  permission: PermissionEngine;
  monitor = new ExecutionMonitor();
  detector = new ThreatDetector();

  constructor(policy: SecurityPolicy = DefaultPolicy) {
    this.permission = new PermissionEngine(policy);
  }

  /** 计划书 §九：策略授权检查。 */
  authorize(action: string): boolean {
    return this.permission.check(action);
  }

  /** 计划书 §九：行为留痕。 */
  record(event: any): void {
    this.monitor.record(event);
  }

  /** 计划书 §十三：危险命令检测。命中返回原因，未命中返回 null。 */
  screen(command: string): string | null {
    return this.detector.explain(command);
  }

  /**
   * 一次性闸门（工程化封装 §十一 的执行流程）：
   *   Permission Check → Threat Detect → Monitor Log
   * 不抛异常，返回结构化判定，让 Agent Loop 能观察→反思→存教训。
   */
  guard(action: string, command?: string): GuardResult {
    if (!this.authorize(action)) {
      const reason = `Permission denied: ${action} (policy)`;
      this.record({ action, target: command, allowed: false, reason });
      return { allowed: false, reason };
    }

    if (command) {
      const threat = this.screen(command);
      if (threat) {
        const reason = `Blocked dangerous command (${threat})`;
        this.record({ action, target: command, allowed: false, reason, threat });
        return { allowed: false, reason };
      }
    }

    this.record({ action, target: command, allowed: true });
    return { allowed: true };
  }

  get policy(): SecurityPolicy {
    return this.permission.getPolicy();
  }

  setPolicy(policy: SecurityPolicy): void {
    this.permission.setPolicy(policy);
  }
}

/** 全局安全内核单例（Runtime 在 boot() 时按 Config 装载策略）。 */
export const security = new SecurityKernel();
