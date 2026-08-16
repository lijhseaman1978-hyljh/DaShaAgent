import { CONFIG } from '../config';
import { cost } from '../observability';
import type { ChatMessage, ChatOptions, Provider, ToolDef, ToolCall } from '../core/types';
import { parseArgs } from '../tools/json';

/**
 * LM Studio / 部分本地 Qwen 模型的 chat template 强制要求 system 只能出现在 index 0，
 * 否则返回 500: "System message must be at the beginning"。
 * 实际会触发该限制的几类情况：
 *  1) 内部路径（启动自检、调度器、技能生成）以 [{role:'user'}] 直接请求，完全没有 system；
 *  2) 会话自动压缩后，压缩摘要以第二条 system 消息插入（messages[1] 仍是 system）；
 *  3) 上述两者叠加，出现多条 system。
 * 这里在请求边界统一「合并所有 system 为一条并置于首位」，彻底满足严格模板；
 * 正常单 system 请求合并后内容不变，零副作用。
 */
const DEFAULT_SYSTEM = 'You are a helpful assistant.';
function normalizeSystemMessages(messages: any[]): any[] {
  if (!messages || !messages.length) return [{ role: 'system', content: DEFAULT_SYSTEM }];
  // 收集所有非空 system 消息，其余按原序保留
  const sysMsgs = messages.filter(m => m && m.role === 'system' && String(m.content ?? '').trim() !== '');
  const others = messages.filter(m => !m || m.role !== 'system');
  if (sysMsgs.length === 0) {
    // 完全没有 system：补一条默认 system 到最前
    return [{ role: 'system', content: DEFAULT_SYSTEM }, ...others];
  }
  // 合并多条 system（如主提示 + 压缩摘要）为一条，避免 "多条 system" 触发 500
  const merged = sysMsgs.map(m => String(m.content ?? '')).join('\n\n——\n\n');
  return [{ role: 'system', content: merged }, ...others];
}

// OpenAI 兼容云端 Provider：默认关闭（需配置 AH_CLOUD_KEY）。
// 为稳妥起见采用非流式，避免 tool_calls 分片合并的边界问题；onToken 在拿到完整内容后逐段回调。
export class CloudProvider implements Provider {
  readonly name = 'cloud';
  private base: string;
  private key: string;
  private model: string;
  private defaultTemp: number;
  private billable: boolean;
  /** 流式请求最近一次 usage（stream_options.include_usage 回传） */
  private lastUsage: { prompt: number; completion: number } | null = null;

  constructor(base = CONFIG.CLOUD_BASE, key = CONFIG.CLOUD_KEY, model = CONFIG.CLOUD_MODEL, defaultTemp = 0.7, billable = false) {
    this.base = base.replace(/\/$/, '');
    this.key = key;
    this.model = model;
    this.defaultTemp = defaultTemp;
    this.billable = billable; // 2026-08-13: type=cloud 付费云模型才计费，local 本地不计费
  }

  // 对外暴露只读模型标识，供 modelCaps 能力探测使用。
  get modelName(): string { return this.model; }
  get baseUrl(): string { return this.base; }

  async isAvailable(): Promise<boolean> {
    return true;  // 本地服务器 (vLLM/llama.cpp 等) 不需要 key
  }

  async chat(opts: ChatOptions): Promise<ChatMessage> {
    const normMessages = normalizeSystemMessages(opts.messages);
    const body: any = {
      model: this.model,
      messages: normMessages.map(m => {
        // 严格 OpenAI 兼容端点（含部分 agnes 网关）要求：带 tool_calls 的 assistant 消息 content 必须为 null，
        // 否则会 400。这里按消息类型精确构造，避免"工具调用后再次请求即失败"的隐患。
        if (m.role === 'assistant' && m.tool_calls && m.tool_calls.length) {
          return {
            role: 'assistant',
            content: null,
            tool_calls: m.tool_calls.map((tc: any) => ({
              id: tc.id,
              type: 'function',
              function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
            })),
          };
        }
        // 多模态：OpenAI 兼容接口用 content parts 数组承载图片。
        // 注意只能挂在 user 消息上，tool 消息带 image 会被服务端 400。
        if (m.images && m.images.length && m.role === 'user') {
          const parts: any[] = [];
          if (m.content) parts.push({ type: 'text', text: m.content });
          m.images.forEach((b64: any, i: number) => {
            const mime = (m.imageMimes && m.imageMimes[i]) || 'image/png';
            parts.push({ type: 'image_url', image_url: { url: `data:${mime};base64,${b64}` } });
          });
          return { role: 'user', content: parts };
        }
        const base: any = { role: m.role, content: m.content || '' };
        if (m.role === 'tool') {
          base.tool_call_id = (m as any).tool_call_id || ('call_' + m.name);
          base.name = m.name;
        }
        return base;
      }),
      temperature: opts.temperature ?? this.defaultTemp,
    };
    if (opts.tools && opts.tools.length) {
      body.tools = opts.tools.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));
      body.tool_choice = 'auto';
      // 2026-08-13: 显式声明并行工具调用（OpenAI 兼容协议默认即并行，但显式声明能
      // 明确提示模型"可以一次返回多个 tool_calls"，显著减少无依赖任务的串行往返）。
      // 若个别模型不支持该字段，服务端会忽略，不影响请求。
      body.parallel_tool_calls = true;
    }

    // 流式：将 stream=true 注入请求体
    const doStream = opts.stream !== false;
    if (doStream) {
      body.stream = true;
      body.stream_options = { include_usage: true };
    }

    // 浏览器 UA：部分网关（如 OpenCode Zen）Cloudflare 拦截非浏览器请求，必须带 UA 才能 200
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
    };
    if (this.key) headers['Authorization'] = 'Bearer ' + this.key;

    const res = await fetch(this.base + '/chat/completions', {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: opts.signal,
    });
    if (!res.ok) throw new Error('Cloud chat 失败: ' + res.status + ' ' + (await res.text()).slice(0, 200));

    // ── SSE 流式读取 ──
    if (body.stream && res.body) {
      return await this.readStream(res.body, opts);
    }

    // ── 非流式（兜底） ──
    const j = await res.json();
    const msg = j.choices?.[0]?.message;
    if (!msg) throw new Error('Cloud 返回结构异常');
    // 计费（2026-08-13）：仅 billable 云模型记录 usage，供 dashboard Costs/Metrics 显示
    if (this.billable && j.usage) {
      const pt = j.usage.prompt_tokens || 0, ct = j.usage.completion_tokens || 0;
      if (pt + ct > 0) cost.record({ provider: 'cloud', model: this.model, inputTokens: pt, outputTokens: ct, tokens: pt + ct });
    }

    const toolCalls: ToolCall[] = [];
    if (msg.tool_calls) {
      for (const tc of msg.tool_calls) {
        if (tc.type === 'function') {
          toolCalls.push({
            id: tc.id || 'call_' + Math.random().toString(36).slice(2),
            name: tc.function.name,
            arguments: typeof tc.function.arguments === 'string' ? parseArgs(tc.function.arguments) : (tc.function.arguments || {}),
          });
        }
      }
    }
    if (msg.content && opts.onToken) {
      opts.onToken(msg.content);
    }
    return { role: 'assistant', content: msg.content || '', tool_calls: toolCalls.length ? toolCalls : undefined };
  }

  /** 解析 SSE (Server-Sent Events) 流式响应 */
  private async readStream(body: ReadableStream<Uint8Array>, opts: ChatOptions): Promise<ChatMessage> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let fullContent = '';
    const toolAcc: Map<number, { id: string; name: string; args: string }> = new Map();

    let buf = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        let line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        // SSE 格式: "data: {...}" 或 "data: [DONE]"
        if (!line.startsWith('data: ')) continue;
        const payload = line.slice(6).trim();
        if (payload === '[DONE]') break;
        try {
          const obj = JSON.parse(payload);
          // 计费（2026-08-13）：流式末帧 usage（include_usage=true 时回传）
          if (obj.usage) this.lastUsage = { prompt: obj.usage.prompt_tokens || 0, completion: obj.usage.completion_tokens || 0 };
          const choice = obj.choices?.[0];
          if (!choice) continue;
          const delta = choice.delta || {};

          // 思维链文本
          if (delta.reasoning_content) {
            opts.onThought?.(delta.reasoning_content);
          }

          // 普通文本增量
          if (delta.content) {
            fullContent += delta.content;
            opts.onToken?.(delta.content);
          }

          // 工具调用增量（分片累积）
          if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index ?? 0;
              if (!toolAcc.has(idx)) toolAcc.set(idx, { id: tc.id || '', name: '', args: '' });
              const acc = toolAcc.get(idx)!;
              if (tc.id) acc.id = tc.id;
              if (tc.function?.name) acc.name = tc.function.name;
              if (tc.function?.arguments) acc.args += tc.function.arguments;
            }
          }
        } catch { /* 忽略解析失败的行 */ }
      }
    }

    const toolCalls: ToolCall[] = [];
    for (const [, acc] of toolAcc) {
      if (acc.name) {
        toolCalls.push({
          id: acc.id || 'call_' + Math.random().toString(36).slice(2),
          name: acc.name,
          arguments: parseArgs(acc.args),
        });
      }
    }
    // 计费（2026-08-13）：流式结束按 usage 记账（billable 云模型）
    if (this.billable && this.lastUsage) {
      const { prompt, completion } = this.lastUsage;
      if (prompt + completion > 0) cost.record({ provider: 'cloud', model: this.model, inputTokens: prompt, outputTokens: completion, tokens: prompt + completion });
    }
    return { role: 'assistant', content: fullContent, tool_calls: toolCalls.length ? toolCalls : undefined };
  }

  async embed(text: string): Promise<number[]> {
    const res = await fetch(this.base + '/embeddings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36', Authorization: 'Bearer ' + this.key },
      body: JSON.stringify({ model: 'text-embedding-3-small', input: text }),
      signal: undefined,
    });
    if (!res.ok) throw new Error('Cloud embed 失败');
    const j = await res.json();
    return j.data?.[0]?.embedding || [];
  }
}
