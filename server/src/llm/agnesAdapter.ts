// llm/agnesAdapter.ts
// AgnesProvider → Provider 接口适配器
// P2 BUG-FIX：getProvider() 期望 V1/V2 Provider 接口（isAvailable + chat→ChatMessage），
// 而 AgnesProvider 实现 V3 LLMProvider 接口（chat→LLMResponse）。此适配器桥接两者。

import type { Provider, ChatMessage, ChatOptions } from '../core/types';
import { AgnesProvider } from './agnes';

export class AgnesProviderAdapter implements Provider {
  readonly name = 'agnes';
  private inner: AgnesProvider;

  constructor(model?: string) {
    this.inner = model ? new AgnesProvider({ model }) : new AgnesProvider();
  }

  async isAvailable(): Promise<boolean> {
    try {
      await this.inner.probe();
      return this.inner.isConfigured();
    } catch {
      return false;
    }
  }

  async chat(opts: ChatOptions): Promise<ChatMessage> {
    const resp = await this.inner.chat(opts.messages);
    const msg: ChatMessage = {
      role: 'assistant',
      content: resp.content,
      finish_reason: resp.finish_reason,
    };
    // LLMResponse 可能带 tool_calls（V3 接口），这里透传
    if ((resp as any).tool_calls) {
      msg.tool_calls = (resp as any).tool_calls;
    }
    return msg;
  }

  async embed?(text: string): Promise<number[]> {
    // Agnes 未提供 embed；返回空向量占位
    return [];
  }
}
