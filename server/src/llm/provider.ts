// llm/provider.ts
// V1/V2：Provider 工厂（getProvider / createProvider），server.ts 与 models.ts 依赖。
// V3 Phase 1 - Step 3 二、定义统一接口 —— 在同文件追加 Unified LLM Interface。
//
// 棕地合并说明：
//   计划书要求 provider.ts 承载 LLMProvider / LLMResponse / ChatMessage 三个契约，
//   而本文件已是工厂且被 3 处 import。因此采取「同文件扩展」而非迁移：
//   下半部分新增 V3 契约，上半部分工厂原样保留，调用方零改动。

import { CONFIG } from '../config';
import type { Provider, ChatMessage, ToolDef } from '../core/types';
import { MockProvider } from './mock';
import { OllamaProvider } from './ollama';
import { CloudProvider } from './cloud';
import { AgnesProviderAdapter } from './agnesAdapter';

// P2 BUG-FIX: 确保 .env 已加载（ESM 下 config/system.ts 可能在 dotenv 执行前被求值，
// 导致 AH_PROVIDER 读不到 → 默认 auto → Agnes 永不被选中）。
// dotenv.config 是幂等的，重复调用安全。
import dotenv from 'dotenv';
import path from 'node:path';
import fs from 'node:fs';
try {
  const rootEnv = path.join(CONFIG.ROOT, '.env');
  if (fs.existsSync(rootEnv)) dotenv.config({ path: rootEnv, quiet: true });
  dotenv.config({ quiet: true });
} catch { /* .env 缺失时静默 */ }

export { MockProvider, OllamaProvider, CloudProvider };

let _provider: Provider | null = null;

// 获取当前 Provider：依据 CONFIG.PROVIDER；若选中的不可用则回退到 mock。
export async function getProvider(): Promise<Provider> {
  if (_provider) return _provider;
  const want = CONFIG.PROVIDER;
  const candidates: Provider[] = [];
  if (want === 'mock') candidates.push(new MockProvider());
  else if (want === 'auto') {
    // 自动模式：优先云端（如果配了 key），再 Ollama，最后 mock
    if (CONFIG.CLOUD_KEY) candidates.push(new CloudProvider());
    candidates.push(new OllamaProvider());
  }
  else if (want === 'cloud') candidates.push(new CloudProvider());
  else if (want === 'agnes') {
    // BUG-FIX(P2): 之前漏加 AgnesProvider，导致 Agnes 永远回退到 mock。
    // 现在优先 Agnes（配了 key 且可用时），不可用时回退云端/Ollama。
    const { AgnesProviderAdapter } = await import('./agnesAdapter');
    candidates.push(new AgnesProviderAdapter());
    if (CONFIG.CLOUD_KEY) candidates.push(new CloudProvider());
    candidates.push(new OllamaProvider());
  }
  else if (want === 'ollama') candidates.push(new OllamaProvider());
  // 始终把 mock 作为最终兜底
  candidates.push(new MockProvider());

  for (const p of candidates) {
    try {
      if (await p.isAvailable()) { _provider = p; return p; }
    } catch {
      // 跳过不可用的
    }
  }
  _provider = candidates[candidates.length - 1];
  return _provider!;
}

export function setProvider(p: Provider) { _provider = p; }

export function resetProviderCache() { _provider = null; }

export interface ProviderSpec {
  type: 'agnes' | 'ollama' | 'cloud' | 'local' | 'mock';
  base?: string;
  model?: string;
  embed?: string;
  key?: string;
  temperature?: number;
}

// 按规格构造一个 Provider 实例（用于模型选择/自定义模型）。
export function createProvider(spec: ProviderSpec): Provider {
  const temp = spec.temperature ?? 0.7;
  if (spec.type === 'cloud' || spec.type === 'local') return new CloudProvider(spec.base, spec.key, spec.model, temp, spec.type === 'cloud'); // 2026-08-13: 仅 cloud 计费
  if (spec.type === 'mock') return new MockProvider();
  if (spec.type === 'agnes') {
    // BUG-FIX(P3): agnes 必须走 AgnesProviderAdapter，不能走 Ollama Provider
    return new AgnesProviderAdapter(spec.model);
  }
  return new OllamaProvider(spec.base, spec.model, spec.embed, temp);
}

// ============================================================================
// V3 Phase 1 - Step 3 二、统一 LLM 接口（Unified LLM Interface）
// 目标：让 Agent 不关心 OpenAI / Claude / Gemini / Ollama / DeepSeek / Qwen，
//       统一 `await llm.chat(provider, messages)`。
// ============================================================================

// ChatMessage 采用仓库既有的规范定义（core/types）。
// 计划书里的 { role: 'user'|'assistant'|'system'; content: string } 是它的子集，
// 结构兼容；此处重导出而非重新声明，避免全仓出现两个同名且不兼容的 ChatMessage。
export type { ChatMessage } from '../core/types';

// V3 Phase 2 - Step 1 三、升级 LLM Provider Interface
// 在 chat() 之外补齐可观测字段：token / latency，并新增可选 stream()。
export interface LLMResponse {
  content: string;
  model: string;
  tokens: number;
  latency: number;
  /** P1: 模型停止原因（stop/length/tool_calls），用于输出截断检测 */
  finish_reason?: string;
}

export interface LLMProvider {
  name: string;

  /**
   * 对话。tools 为可选的原生工具清单（OpenAI/Claude/Gemini 函数调用 schema），
   * 传入后模型可在规划/推理时看到可用工具（P1：V3 接口 tools 透传）。
   */
  chat(messages: ChatMessage[], tools?: ToolDef[]): Promise<LLMResponse>;

  /** Phase 2 - Step 1 §三：流式输出（可选实现） */
  stream?(messages: ChatMessage[], tools?: ToolDef[]): AsyncGenerator<string>;

  /** 可选：一行状态描述，供 OS 启动横幅展示（ready / stub 等） */
  status?(): string;

  /** 可选：启动期探测（例如本地 Ollama 是否在跑），由 LLMRouter.ready() 并行调用 */
  probe?(): Promise<void>;
}
