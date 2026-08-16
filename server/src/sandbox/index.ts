// sandbox/index.ts
// 计划书 Phase 3 - Step 1 §五：Docker Runtime 模块桶导出。

export * from './docker';
export * from './container';
export * from './executor';

import { ContainerManager } from './container';
import { SandboxExecutor } from './executor';

/** 全局沙箱运行时（Runtime 复用同一容器，避免每条命令冷启动）。 */
export const sandboxContainers = new ContainerManager();
export const sandboxExecutor = new SandboxExecutor();
