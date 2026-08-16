// llm/local.ts
// V3 Phase 1 - Step 3 六、本地模型 Provider（Ollama / Qwen / Llama / DeepSeek）
// V3 Phase 2 - Step 1 七、真实本地模型接入 —— 直连 Ollama /api/chat。
//
// 棕地说明：
//   仓库既有 OllamaProvider（流式 + tool_calls 聚合 + 自动选模）继续服务 V1/V2 生产管线，
//   本文件保留它用于「可用性探测 + 模型名解析」；而 chat() 按计划书 §七 改为直连
//   /api/chat，因为只有原始响应里才有 eval_count / prompt_eval_count ——
//   §十一 要求「Token统计 ✅ 延迟统计 ✅」，桥接层拿不到这两个数。
//   Ollama 未运行时退回占位响应，保证离线环境启动不报错。

import type { LLMProvider, LLMResponse } from './provider';
import type { ChatMessage } from '../core/types';
import { OllamaProvider } from './ollama';
import { CONFIG, config, env } from '../config';

const PLACEHOLDER: LLMResponse = { content: 'Local model response', model: 'local', tokens: 0, latency: 0 };

export class LocalProvider implements LLMProvider {
  name = 'local';

  private impl: OllamaProvider;
  /** null = 未探测；true/false = 探测结果（OllamaProvider 内部亦有缓存） */
  private online: boolean | null = null;

  constructor() {
    const llmCfg = config.getLLM();
    const model = llmCfg.provider === 'local' && llmCfg.model && llmCfg.model !== 'mock'
      ? llmCfg.model
      : env.get('LOCAL_MODEL') || CONFIG.OLLAMA_MODEL;
    this.impl = new OllamaProvider(CONFIG.OLLAMA_BASE, model);
  }

  /** 启动期探测：由 LLMRouter.ready() 并行调用，3s 超时，失败不抛 */
  async probe(): Promise<void> {
    try {
      this.online = await this.impl.isAvailable();
    } catch {
      this.online = false;
    }
  }

  isConfigured(): boolean {
    return this.online === true;
  }

  status(): string {
    if (this.online === null) return 'not probed';
    return this.online
      ? `ready (ollama: ${this.impl.modelName})`
      : `offline — ${CONFIG.OLLAMA_BASE} 无响应`;
  }

  private endpoint(): string {
    return `${CONFIG.OLLAMA_BASE.replace(/\/+$/, '')}/api/chat`;
  }

  private payload(messages: ChatMessage[], stream: boolean) {
    return JSON.stringify({
      model: this.impl.modelName,
      messages: messages.map((m: any) => ({ role: m.role, content: String(m.content ?? '') })),
      stream,
    });
  }

  async chat(messages: ChatMessage[]): Promise<LLMResponse> {
    if (this.online === null) await this.probe();
    if (!this.online) return { ...PLACEHOLDER };

    const start = Date.now();
    const response = await fetch(this.endpoint(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: this.payload(messages, false),
    });

    const data: any = await response.json();

    return {
      content: data?.message?.content ?? '',
      model: this.impl.modelName,
      tokens: (data?.prompt_eval_count ?? 0) + (data?.eval_count ?? 0),
      latency: Date.now() - start,
    };
  }

  /** Phase 2 - Step 1 §三：流式输出（Ollama NDJSON 流） */
  async *stream(messages: ChatMessage[]): AsyncGenerator<string> {
    if (this.online === null) await this.probe();
    if (!this.online) {
      yield PLACEHOLDER.content;
      return;
    }

    const response = await fetch(this.endpoint(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: this.payload(messages, true),
    });
    if (!response.body) return;

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const j = JSON.parse(line);
          const piece = j?.message?.content;
          if (piece) yield piece as string;
        } catch {
          /* 忽略半行 */
        }
      }
    }
  }
}
