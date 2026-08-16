// llm/gemini.ts
// V3 Phase 1 - Step 3 五、Gemini Provider（契约 + 状态上报）
// V3 Phase 2 - Step 1 六、真实 Gemini Provider —— 接入官方 `@google/generative-ai`。
//
// 与计划书 §六 的差异：§六 里 tokens/latency 硬编码为 0；这里改为从
// usageMetadata 取真实 token 数并实测 latency —— §十一 明确要求「Token统计 ✅ 延迟统计 ✅」。

import { GoogleGenerativeAI, type GenerativeModel } from '@google/generative-ai';
import type { LLMProvider, LLMResponse } from './provider';
import type { ChatMessage } from '../core/types';
import { config, env } from '../config';

const PLACEHOLDER: LLMResponse = { content: 'Gemini response', model: 'gemini', tokens: 0, latency: 0 };

export class GeminiProvider implements LLMProvider {
  name = 'gemini';

  private model_: GenerativeModel | null = null;
  private modelName_ = '';

  private key(): string {
    return env.get('GOOGLE_API_KEY') || '';
  }

  private model(): string {
    const llmCfg = config.getLLM();
    if (llmCfg.provider === 'gemini' && llmCfg.model) return llmCfg.model;
    return env.get('GEMINI_MODEL') || env.str('GOOGLE_MODEL', 'gemini-2.5-pro');
  }

  isConfigured(): boolean {
    return !!this.key();
  }

  status(): string {
    return this.isConfigured() ? `ready (${this.model()} @ google sdk)` : 'stub — set GOOGLE_API_KEY';
  }

  private sdk(): GenerativeModel {
    const want = this.model();
    if (!this.model_ || this.modelName_ !== want) {
      const ai = new GoogleGenerativeAI(this.key());
      this.model_ = ai.getGenerativeModel({ model: want });
      this.modelName_ = want;
    }
    return this.model_;
  }

  async chat(messages: ChatMessage[]): Promise<LLMResponse> {
    if (!this.isConfigured()) return { ...PLACEHOLDER };

    const start = Date.now();
    const model = this.model();

    const result = await this.sdk().generateContent(
      messages.map((m: any) => String(m.content ?? '')).join('\n')
    );

    return {
      content: result.response.text(),
      model,
      tokens: result.response.usageMetadata?.totalTokenCount ?? 0,
      latency: Date.now() - start,
    };
  }

  /** Phase 2 - Step 1 §三：流式输出 */
  async *stream(messages: ChatMessage[]): AsyncGenerator<string> {
    if (!this.isConfigured()) {
      yield PLACEHOLDER.content;
      return;
    }
    const result = await this.sdk().generateContentStream(
      messages.map((m: any) => String(m.content ?? '')).join('\n')
    );
    for await (const chunk of result.stream) {
      const text = chunk.text();
      if (text) yield text;
    }
  }
}
