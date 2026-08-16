// config/index.ts
// V3 Phase 1 - Step 2 六、导出模块
//
// 注意（棕地合并要点）：
// 原 `server/src/config.ts` 已迁入本目录的 system.ts。
// 通过在此重导出 CONFIG / ensureDir，全仓 23 处 `import { CONFIG } from '../config'`
// 无需任何改动即可继续工作 —— 目录 index 解析接管了原来的单文件。

export * from './config';
export * from './env';
export * from './schema';

// V1/V2 遗留运行时配置（端口 / 数据目录 / 模型端点 / MAX_ITER）
export * from './system';
