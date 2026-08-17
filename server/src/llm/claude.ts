// llm/claude.ts
// V3 Phase 1 - Step 3 四、Claude Provider（契约 + 状态上报）
// V3 Phase 2 - Step 1 五、真实 Claude Provider —— 接入官方 `@anthropic-ai/sdk`。
//
// 计划书 §五 把 system 消息 filter 掉；Anthropic API 的 system 是顶层参数而非消息，
// 这里在保持"过滤 system 消息"的同时把它提到 system 字段，避免白白丢失系统提示。

import Anthropic from '@anthropic-ai/sdk';
import type { LLMProvider, LLMResponse } from './provider';
import type { ChatMessage, ToolDef } from '../core/types';
import { config, env } from '../config';

const PLACEHOLDER: LLMResponse = { content: '[未配置 ANTHROPIC_API_KEY]', model: 'claude', tokens: 0, latency: 0 };

export class ClaudeProvider implements LLMProvider {
  name = 'claude';

  private client: Anthropic | null = null;

  private key(): string {
    return env.get('ANTHROPIC_API_KEY') || '';
  }

  private model(): string {
    const llmCfg = config.getLLM();
    if (llmCfg.provider === 'claude' && llmCfg.model) return llmCfg.model;
    return env.get('CLAUDE_MODEL') || env.str('ANTHROPIC_MODEL', 'claude-sonnet-4');
  }

  isConfigured(): boolean {
    return !!this.key();
  }

  status(): string {
    return this.isConfigured() ? `ready (${this.model()} @ anthropic sdk)` : 'stub — set ANTHROPIC_API_KEY';
  }

  private sdk(): Anthropic {
    if (!this.client) this.client = new Anthropic({ apiKey: this.key() });
    return this.client;
  }

  async chat(messages: ChatMessage[], tools?: ToolDef[]): Promise<LLMResponse> {
    if (!this.isConfigured()) return { ...PLACEHOLDER };

    const start = Date.now();
    const model = this.model();

    const system = messages
      .filter((m: any) => m.role === 'system')
      .map((m: any) => String(m.content ?? ''))
      .join('\n');

    const payload: any = {
      model,
      max_tokens: 4096,
      ...(system ? { system } : {}),
      messages: messages.filter((m: any) => m.role !== 'system') as any,
    };
    if (tools?.length) {
      payload.tools = tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters || {} }));
    }
    const result = await this.sdk().messages.create(payload);

    const first = result.content[0] as any;
    return {
      content: first && first.type === 'text' ? first.text : '',
      model,
      tokens: (result.usage?.input_tokens ?? 0) + (result.usage?.output_tokens ?? 0),
      latency: Date.now() - start,
    };
  }

  /** Phase 2 - Step 1 §三：流式输出 */
  async *stream(messages: ChatMessage[], tools?: ToolDef[]): AsyncGenerator<string> {
    if (!this.isConfigured()) {
      yield PLACEHOLDER.content;
      return;
    }
    const system = messages
      .filter((m: any) => m.role === 'system')
      .map((m: any) => String(m.content ?? ''))
      .join('\n');

    const payload: any = {
      model: this.model(),
      max_tokens: 4096,
      ...(system ? { system } : {}),
      messages: messages.filter((m: any) => m.role !== 'system') as any,
      stream: true,
    };
    if (tools?.length) {
      payload.tools = tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters || {} }));
    }
    const s = await this.sdk().messages.create(payload);
    for await (const event of s as any) {
      if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
        yield event.delta.text as string;
      }
    }
  }
}
