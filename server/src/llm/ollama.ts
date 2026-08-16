import { CONFIG } from '../config';
import type { ChatMessage, ChatOptions, Provider, ToolDef, ToolCall } from '../core/types';
import { parseArgs } from '../tools/json';

interface OllamaToolMsg {
  role: string;
  content?: string | null;
  tool_calls?: { function: { name: string; arguments: any } }[];
}

function toOllamaMessages(messages: ChatMessage[]): any[] {
  // 同源兜底：部分本地 Qwen 模板要求 system 只能出现在 index 0，多条 system 会 500。
  // 合并所有 system 为一条置于首位，其余按原序保留。
  const msgs = messages || [];
  const sysMsgs = msgs.filter(m => m && m.role === 'system' && String((m as any).content ?? '').trim() !== '');
  const others = msgs.filter(m => !m || m.role !== 'system');
  const norm = sysMsgs.length
    ? [{ role: 'system', content: sysMsgs.map(m => String((m as any).content ?? '')).join('\n\n——\n\n') } as ChatMessage, ...others]
    : [{ role: 'system', content: 'You are a helpful assistant.' } as ChatMessage, ...others];
  return norm.map(m => {
    if (m.role === 'tool') {
      return { role: 'tool', content: m.content || '', name: m.name, tool_call_id: m.tool_call_id };
    }
    if (m.role === 'assistant' && m.tool_calls && m.tool_calls.length) {
      return {
        role: 'assistant',
        content: m.content || '',
        tool_calls: m.tool_calls.map(tc => ({ function: { name: tc.name, arguments: tc.arguments } })),
      };
    }
    // 多模态：Ollama /api/chat 的 message 支持 images: [base64...]（不带 data: 前缀）
    if (m.images && m.images.length) {
      return { role: m.role, content: m.content || '', images: m.images };
    }
    return { role: m.role, content: m.content || '' };
  });
}

function toOllamaTools(tools?: ToolDef[]): any[] | undefined {
  if (!tools || !tools.length) return undefined;
  return tools.map(t => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));
}

export class OllamaProvider implements Provider {
  readonly name = 'ollama';
  private base: string;
  private model: string;
  private embedModel: string;
  private defaultTemp: number;
  private cacheAvailable: boolean | null = null;

  constructor(base = CONFIG.OLLAMA_BASE, model = CONFIG.OLLAMA_MODEL, embedModel = CONFIG.OLLAMA_EMBED, defaultTemp = 0.7) {
    this.base = base.replace(/\/$/, '');
    this.model = model;
    this.embedModel = embedModel;
    this.defaultTemp = defaultTemp;
  }

  // 对外暴露只读的模型标识，供 modelCaps 做能力探测（图片支持、tool calling 等）。
  // 注意：isAvailable() 里可能因配置模型缺失而自动改用别的模型，所以必须读实时值而非构造值。
  get modelName(): string { return this.model; }
  get baseUrl(): string { return this.base; }

  async isAvailable(): Promise<boolean> {
    if (this.cacheAvailable !== null) return this.cacheAvailable;
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 3000);
      const r = await fetch(this.base + '/api/tags', { signal: ctrl.signal });
      clearTimeout(t);
      if (!r.ok) { this.cacheAvailable = false; return false; }
      const j = await r.json();
      const models: string[] = (j.models || []).map((m: any) => m.name);
      if (!models.length) { this.cacheAvailable = false; return false; } // 服务在但没拉模型，等同不可用
      // 校验配置模型是否存在，不存在则自动选用一个可用模型（优先带 tool 的）
      if (!models.includes(this.model)) {
        const pick = models.find(m => /tool/i.test(m)) || models[0];
        if (pick) { console.warn(`[Ollama] 配置模型 ${this.model} 不存在，自动改用 ${pick}`); this.model = pick; }
        else { this.cacheAvailable = false; return false; }
      }
      this.cacheAvailable = true;
    } catch {
      this.cacheAvailable = false;
    }
    return this.cacheAvailable;
  }

  async chat(opts: ChatOptions): Promise<ChatMessage> {
    const body: any = {
      model: this.model,
      messages: toOllamaMessages(opts.messages),
      stream: true,
      options: { temperature: opts.temperature ?? this.defaultTemp },
    };
    const toolsNative = toOllamaTools(opts.tools);
    if (toolsNative) body.tools = toolsNative;

    const res = await fetch(this.base + '/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: opts.signal,
    });
    if (!res.ok || !res.body) {
      throw new Error('Ollama /api/chat 失败: ' + res.status);
    }

    let fullContent = '';
    // 流式 tool_calls 聚合：按索引合并分片（Qwen 等会把同一调用的参数分多次下发）
    const toolAcc: { id: string; name: string; args: string }[] = [];
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        try {
          const obj = JSON.parse(line);
          const msg: OllamaToolMsg = obj.message || {};
          // 思维链（thinking）：绝不进入答案气泡，改走独立的 onThought 通道
          if ((msg as any).thinking) {
            opts.onThought && opts.onThought((msg as any).thinking);
          }
          if (msg.content) {
            fullContent += msg.content;
            opts.onToken && opts.onToken(msg.content);
          }
          if (msg.tool_calls && msg.tool_calls.length) {
            for (let i = 0; i < msg.tool_calls.length; i++) {
              const inc = msg.tool_calls[i];
              const fn = (inc as any).function || {};
              if (!toolAcc[i]) toolAcc[i] = { id: 'call_' + Math.random().toString(36).slice(2), name: '', args: '' };
              if (fn.name) toolAcc[i].name = fn.name;
              const argStr = typeof fn.arguments === 'string' ? fn.arguments : JSON.stringify(fn.arguments || {});
              if (argStr) toolAcc[i].args += argStr;
            }
          }
        } catch { /* 忽略半行 */ }
      }
    }
    const toolCalls: ToolCall[] = toolAcc
      .filter(a => a.name)
      .map(a => ({
        id: a.id,
        name: a.name,
        arguments: parseArgs(a.args),
      }));
    return { role: 'assistant', content: fullContent, tool_calls: toolCalls.length ? toolCalls : undefined };
  }

  async embed(text: string): Promise<number[]> {
    const res = await fetch(this.base + '/api/embeddings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.embedModel, prompt: text }),
    });
    if (!res.ok) throw new Error('Ollama embed 失败: ' + res.status);
    const j = await res.json();
    return j.embedding as number[];
  }
}
