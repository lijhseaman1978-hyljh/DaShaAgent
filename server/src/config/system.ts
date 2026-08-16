// config/system.ts
// V1/V2 全局运行时配置（原 server/src/config.ts）。
// V3 Phase 1 - Step 2：迁入 config/ 目录，由 config/index.ts 重导出，
// 使既有 23 处 `import { CONFIG, ensureDir } from '../config'` 保持零改动。
// 职责：端口 / 数据目录 / 模型端点 / 循环护栏 —— 属于"进程级运行时设置"。
// 结构化的 SystemConfig（agent/llm/memory/sandbox）见 ./schema.ts + ./loader.ts。

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// config.ts 原位于 server/src，现位于 server/src/config → 需向上三级才到项目根
const ROOT = path.resolve(__dirname, '..', '..', '..'); // D:/DaShaAgent

// P2 BUG-FIX: 在读取任何 AH_* 环境变量之前先加载 .env。
// ESM 模块求值顺序下，system.ts 可能在 env.ts（dotenv.config）之前被求值，
// 导致 AH_PROVIDER 读不到 → 默认 'auto' → Agnes provider 永不生效。
// dotenv.config 幂等，重复调用安全。
try {
  const rootEnv = path.join(ROOT, '.env');
  if (fs.existsSync(rootEnv)) dotenv.config({ path: rootEnv, quiet: true });
  dotenv.config({ quiet: true });
} catch { /* .env 缺失时静默 */ }

export const CONFIG = {
  ROOT,
  // 端口清理(2026-08-08)：V2 生产网关(server.ts)已删除，旧端口 8787 废弃，
  // 实际服务(Control Center)由 .env 的 AH_CONTROL_PORT=3001 决定，此处默认值统一为 3001。
  PORT: parseInt(process.env.AH_PORT || '3001', 10),
  DATA_DIR: path.join(ROOT, 'data'),
  WORKSPACE_DIR: path.join(ROOT, 'data', 'workspace'),
  MEMORY_DIR: path.join(ROOT, 'data', 'memory'),
  VECTOR_DIR: path.join(ROOT, 'data', 'vector'),
  KNOWLEDGE_DIR: path.join(ROOT, 'data', 'knowledge'),
  OUTPUT_DIR: path.join(ROOT, 'data', 'output'),

  // 模型来源：'auto'=自动选最优 / 'ollama' / 'cloud' / 'agnes' / 'mock'
  PROVIDER: (process.env.AH_PROVIDER || 'auto').toLowerCase(),

  // Ollama
  OLLAMA_BASE: process.env.AH_OLLAMA_BASE || 'http://127.0.0.1:11434',
  OLLAMA_MODEL: process.env.AH_OLLAMA_MODEL || (detectOllamaToolModel()),
  OLLAMA_EMBED: process.env.AH_OLLAMA_EMBED || detectEmbedModel(),

  // 云端（OpenAI 兼容，默认关闭）
  CLOUD_BASE: process.env.AH_CLOUD_BASE || 'https://api.openai.com/v1',
  CLOUD_KEY: process.env.AH_CLOUD_KEY || '',
  CLOUD_MODEL: process.env.AH_CLOUD_MODEL || 'gpt-4o-mini',

  // Agent 循环保护
  // BUG-FIX(2026-08-08): 循环轮数 24 偏小，长任务(多工具调用+验证重试)易被截断；默认 40，AH_MAX_ITER 可覆盖
  // BUG-FIX(2026-08-11): 用户要求长任务不被截断 → 默认 0 = 无限步数；AH_MAX_ITER 可覆盖为有限值
  MAX_ITER: parseInt(process.env.AH_MAX_ITER || '0', 10),

  // 单任务累计工具调用预算（防弱模型空转；AH_MAX_TOOL_CALLS 可覆盖）
  // 语义与 MAX_ITER 一致：0 = 无限（用户 .env 既有约定「0=无限，长任务不截断」）；未设置默认 24。
  // ⚠️ 2026-08-12 回归事故：此前误把 0 当上限 → toolCallCount+1 > 0 恒真 → 首次工具调用即被关通道。
  MAX_TOOL_CALLS: parseInt(process.env.AH_MAX_TOOL_CALLS || '24', 10),

  // 上下文自动压缩（2026-08-11：适配 128K 窗口模型，环境变量可配）
  // 触发阈值：估算 token 超过该值才压缩；默认 100000（约 128K 窗口的 78%）
  COMPRESS_THRESHOLD: parseInt(process.env.AH_COMPRESS_THRESHOLD || '100000', 10),
  // 压缩时保留最近 N 条消息；默认 80（配合 tool-call 完整性保护，足够覆盖 10+ 轮工具调用）
  COMPRESS_KEEP: parseInt(process.env.AH_COMPRESS_KEEP || '80', 10),
  // 压缩摘要是否调用 LLM 生成语义摘要（关键事实/结论/未决事项）；'0'=关闭仅统计兜底
  COMPRESS_LLM_SUMMARY: (process.env.AH_COMPRESS_LLM_SUMMARY || '1') !== '0',

  // 是否启用微信(OpenClaw)通道，缺省关闭（不可用时安全跳过）
  WECHAT_ENABLED: (process.env.AH_WECHAT || '0') === '1',
};

function detectOllamaToolModel(): string {
  if (process.env.AH_OLLAMA_MODEL) return process.env.AH_OLLAMA_MODEL;
  // 优先带 tool 的模型（函数调用更稳），其次通用模型
  return 'qwen3.5-9b-tool:q5';
}

function detectEmbedModel(): string {
  if (process.env.AH_OLLAMA_EMBED) return process.env.AH_OLLAMA_EMBED;
  return 'nomic-embed-text';
}

// 确保数据目录存在
for (const d of [CONFIG.DATA_DIR, CONFIG.WORKSPACE_DIR, CONFIG.MEMORY_DIR, CONFIG.VECTOR_DIR, CONFIG.KNOWLEDGE_DIR, CONFIG.OUTPUT_DIR]) {
  try { fs.mkdirSync(d, { recursive: true }); } catch {}
}

export function ensureDir(d: string) { try { fs.mkdirSync(d, { recursive: true }); } catch {} }
