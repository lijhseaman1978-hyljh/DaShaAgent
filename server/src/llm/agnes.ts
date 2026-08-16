// llm/agnes.ts
// V3 Phase 3 补充：Agnes AI Provider（OpenAI 兼容 /chat/completions）。
//
// 模型：agnes-2.5-flash（用户首选）
// 端点：https://apihub.agnes-ai.com/v1/chat/completions
// 认证：Agnes API Key（从环境变量 AGNES_API_KEY 读取）

import type { LLMProvider, LLMResponse } from './provider';
import type { ChatMessage } from '../core/types';

const DEFAULT_MODEL = 'deepseek-v4-flash'; // 2026-08-13: 默认模型改为 deepseek-v4-flash
// Endpoint is configurable via AGNES_BASE_URL; defaults to the Agnes AI gateway.
const BASE = process.env.AGNES_BASE_URL || 'https://apihub.agnes-ai.com/v1';

export class AgnesProvider implements LLMProvider {
  name = 'agnes';

  private apiKey: string;
  private model: string;
  private online: boolean | null = null;

  constructor(opts?: { apiKey?: string; model?: string }) {
    // 优先技能内部 .env，其次进程环境变量
    this.apiKey = opts?.apiKey
      || process.env.AGNES_API_KEY
      || process.env.AGNES_API_TOKEN
      || process.env.APIHUB_AGNES_API_KEY
      || '';
    this.model = opts?.model || DEFAULT_MODEL;
  }

  /** 启动期探测：发一条最便宜的请求验证 Key 有效 & 服务可达 */
  async probe(): Promise<void> {
    if (!this.apiKey) { this.online = false; return; }
    try {
      const response = await fetch(`${BASE}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 1,
          temperature: 0,
        }),
        signal: AbortSignal.timeout(8000),
      });
      this.online = response.ok;
    } catch {
      this.online = false;
    }
  }

  isConfigured(): boolean {
    return this.online === true;
  }

  status(): string {
    if (this.online === null) return 'not probed';
    if (!this.apiKey) return 'no API key — set AGNES_API_KEY';
    return this.online ? `ready (${this.model})` : `offline — ${BASE} 不可达`;
  }

  async chat(messages: ChatMessage[]): Promise<LLMResponse> {
    if (this.online === null) await this.probe();

    if (!this.apiKey) {
      return { content: `[Agnes] 未配置 API Key。请在 .env 或环境变量中设置 AGNES_API_KEY。`, model: this.model, tokens: 0, latency: 0 };
    }

    if (!this.online) {
      return { content: `[Agnes] 服务不可达 (${BASE})。请检查网络连接。`, model: this.model, tokens: 0, latency: 0 };
    }

    const start = Date.now();
    const body = JSON.stringify({
      model: this.model,
      messages: messages.map((m) => ({ role: m.role, content: String(m.content ?? '') })),
      temperature: 0.7,
      max_tokens: 4096,
    });

    const response = await fetch(`${BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body,
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => 'unknown error');
      return {
        content: `[Agnes] API 错误 ${response.status}: ${errText.slice(0, 200)}`,
        model: this.model,
        tokens: 0,
        latency: Date.now() - start,
      };
    }

    const data: any = await response.json();
    const content = data?.choices?.[0]?.message?.content ?? '';
    const tokens = (data?.usage?.prompt_tokens ?? 0) + (data?.usage?.completion_tokens ?? 0);
    const finish_reason = data?.choices?.[0]?.finish_reason;

    return {
      content,
      model: data?.model ?? this.model,
      tokens,
      latency: Date.now() - start,
      finish_reason,
    };
  }

  /** 流式输出（Server-Sent Events） */
  async *stream(messages: ChatMessage[]): AsyncGenerator<string> {
    if (!this.apiKey || !this.online) {
      const res = await this.chat(messages);
      yield res.content;
      return;
    }

    const response = await fetch(`${BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: messages.map((m) => ({ role: m.role, content: String(m.content ?? '') })),
        temperature: 0.7,
        max_tokens: 4096,
        stream: true,
      }),
    });

    if (!response.ok || !response.body) {
      const res = await this.chat(messages);
      yield res.content;
      return;
    }

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
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;
        const data = trimmed.slice(6);
        if (data === '[DONE]') return;
        try {
          const j = JSON.parse(data);
          const piece = j?.choices?.[0]?.delta?.content;
          if (piece) yield piece as string;
        } catch {
          // 忽略半行
        }
      }
    }
  }
}
