// llm/openai.ts
// V3 Phase 1 - Step 3 三、OpenAI Provider（契约 + 状态上报）
// V3 Phase 2 - Step 1 四、真实 OpenAI Provider —— 接入官方 `openai` SDK。
//
// 棕地合并说明：
//   仓库另有 CloudProvider（OpenAI 兼容协议，支持 tools / 多模态 / embed），
//   它服务于 V1/V2 生产管线，保留不动。本文件按计划书改为官方 SDK 直连，
//   并保留两条兜底：
//     1) 配了自定义 base（AH_CLOUD_BASE 指向非官方端点）时走 CloudProvider 桥接，
//        兼容 DeepSeek / Qwen / Moonshot 等 OpenAI 兼容网关（计划书开篇「国产模型」目标）；
//     2) 未配 Key 时返回占位响应，保证零网络、零 token 的启动自检输出稳定。

import OpenAI from 'openai';
import type { LLMProvider, LLMResponse } from './provider';
import type { ChatMessage } from '../core/types';
import { CloudProvider } from './cloud';
import { CONFIG, config, env } from '../config';

const PLACEHOLDER: LLMResponse = { content: 'OpenAI response', model: 'gpt', tokens: 0, latency: 0 };

const OFFICIAL_BASE = 'https://api.openai.com/v1';

export class OpenAIProvider implements LLMProvider {
  name = 'openai';

  private client: OpenAI | null = null;
  private bridge: CloudProvider | null = null;

  /** 动态 base/key：优先读取 V2 ModelManager 的配置文件（用户通过 UI 设置的云端配置），
   *  其次读环境变量，最后用默认值 */
  private key(): string {
    // 从 V2 配置文件读取（用户 UI 设置的 cloud key）
    try {
      const cfg = (config as any).get?.() ?? {};
      const cloudKey = cfg?.cloud?.key || CONFIG.CLOUD_KEY || env.get('OPENAI_API_KEY') || '';
      if (cloudKey) return cloudKey;
    } catch { /* fallthrough */ }
    return env.get('OPENAI_API_KEY') || CONFIG.CLOUD_KEY || '';
  }

  private model(): string {
    const llmCfg = config.getLLM();
    if (llmCfg.provider === 'openai' && llmCfg.model) return llmCfg.model;
    return env.get('OPENAI_MODEL') || CONFIG.CLOUD_MODEL;
  }

  private baseURL(): string {
    // 从 V2 配置文件读取（用户 UI 设置的 cloud base）
    try {
      const cfg = (config as any).get?.() ?? {};
      const cloudBase = cfg?.cloud?.base;
      if (cloudBase && cloudBase !== OFFICIAL_BASE) return cloudBase.replace(/\/+$/, '');
    } catch { /* fallthrough */ }
    return (CONFIG.CLOUD_BASE || OFFICIAL_BASE).replace(/\/+$/, '');
  }

  /** 非官方端点 → 走既有 CloudProvider（它已处理各家网关的差异） */
  private useBridge(): boolean {
    return this.baseURL() !== OFFICIAL_BASE;
  }

  isConfigured(): boolean {
    return !!this.key();
  }

  status(): string {
    if (!this.isConfigured()) return 'stub — set OPENAI_API_KEY';
    return this.useBridge()
      ? `ready (${this.model()} @ compatible endpoint)`
      : `ready (${this.model()} @ openai sdk)`;
  }

  private sdk(): OpenAI {
    if (!this.client) {
      this.client = new OpenAI({ apiKey: this.key(), baseURL: this.baseURL() });
    }
    return this.client;
  }

  async chat(messages: ChatMessage[]): Promise<LLMResponse> {
    if (!this.isConfigured()) return { ...PLACEHOLDER };

    const start = Date.now();
    const model = this.model();

    if (this.useBridge()) {
      if (!this.bridge) this.bridge = new CloudProvider(CONFIG.CLOUD_BASE, this.key(), model);
      const msg = await this.bridge.chat({ messages });
      return { content: msg.content || '', model, tokens: 0, latency: Date.now() - start };
    }

    const response = await this.sdk().chat.completions.create({
      model,
      messages: messages as any,
    });

    return {
      content: response.choices[0]?.message?.content || '',
      model,
      tokens: response.usage?.total_tokens || 0,
      latency: Date.now() - start,
    };
  }

  /** Phase 2 - Step 1 §三：流式输出 */
  async *stream(messages: ChatMessage[]): AsyncGenerator<string> {
    if (!this.isConfigured()) {
      yield PLACEHOLDER.content;
      return;
    }
    const s = await this.sdk().chat.completions.create({
      model: this.model(),
      messages: messages as any,
      stream: true,
    });
    for await (const chunk of s) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) yield delta;
    }
  }
}
