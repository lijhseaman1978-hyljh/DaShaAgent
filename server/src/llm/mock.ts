import { CONFIG } from '../config';
import type { ChatMessage, ChatOptions, Provider, ToolDef, ToolCall } from '../core/types';

// 确定性 Provider：用于自动化测试与离线兜底。
// 约定（仅供测试脚本使用）：若最后一条 user 消息包含形如
//   TOOL:<name>:<json>
// 则返回一个工具调用；否则返回固定回复并回显用户意图。
export class MockProvider implements Provider {
  readonly name = 'mock';

  async isAvailable(): Promise<boolean> { return true; }

  async chat(opts: ChatOptions): Promise<ChatMessage> {
    // 若对话中已存在工具结果，说明工具已执行，直接给最终总结，避免重复发起工具调用（防死循环）
    if (opts.messages.some(m => m.role === 'tool')) {
      const toolRes = opts.messages.filter(m => m.role === 'tool').slice(-1)[0];
      const summary = `【Mock】已根据工具结果完成处理。最近一次工具返回：${(toolRes?.content || '').slice(0, 80)}`;
      if (opts.onToken) opts.onToken(summary);
      return { role: 'assistant', content: summary };
    }

    const lastUser = [...opts.messages].reverse().find(m => m.role === 'user');
    const text = (lastUser?.content || '').toString();

    const m = text.match(/TOOL:([\w-]+):(\{.*\})/s);
    if (m) {
      const name = m[1];
      let args: Record<string, any> = {};
      try { args = JSON.parse(m[2]); } catch { args = {}; }
      const tc: ToolCall = { id: 'call_' + Date.now(), name, arguments: args };
      if (opts.onToken) opts.onToken('（调用工具 ' + name + '）\n');
      return { role: 'assistant', content: null, tool_calls: [tc] };
    }

    // 普通回复：带一点"记忆"感——看历史里有没有提到名字
    const hasTools = (opts.tools && opts.tools.length) ? '我当前可用工具：' + opts.tools.map(t => t.name).join('、') + '。' : '';
    const reply = `【Mock】已收到你的消息：「${text.slice(0, 60)}」。` + (hasTools ? hasTools : '');
    if (opts.onToken) opts.onToken(reply);
    return { role: 'assistant', content: reply };
  }

  // 确定性嵌入：基于字符哈希的 32 维向量（仅用于离线测试，非语义）
  async embed(text: string): Promise<number[]> {
    const dim = 32;
    const v = new Array(dim).fill(0);
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      v[i % dim] += (c % 7) - 3;
    }
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
    return v.map(x => x / norm);
  }
}
