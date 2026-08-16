// kernel/version.ts
// OS 版本常量。原本定义在 runtime.ts，Phase 3 - Step 2 引入 api/ 控制面后，
// controller 需要读版本号而 runtime 又要启动控制面，直接互相 import 会形成循环依赖。
// 抽到无依赖的独立模块，runtime.ts 继续 re-export，既有 import 路径保持不变。

export const OS_VERSION = '3.0.0';
export const OS_VERSION_LABEL = 'v3.0';
