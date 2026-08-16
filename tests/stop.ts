// 验证：对话进行中可被 AbortSignal 中止（停止生成）
import type { Provider, ChatMessage, ToolDef } from '../server/src/core/types';
import { AgentLoop } from '../server/src/core/agentLoop';
import { MemoryManager } from '../server/src/memory';
import { RAG } from '../server/src/rag';

class SlowProvider implements Provider {
  name = 'slow';
  async isAvailable() { return true; }
  async chat(opts: { messages: ChatMessage[]; tools?: ToolDef[]; stream?: boolean; onToken?: (t: string) => void; signal?: AbortSignal; temperature?: number; }): Promise<ChatMessage> {
    const full = '这是一个用于验证停止逻辑的较长文本，应当在中途被中止而不是完整输出完毕。';
    let count = 0;
    for (let i = 0; i < full.length; i++) {
      if (opts.signal?.aborted) throw new Error('AbortError');
      await new Promise(r => setTimeout(r, 15));
      opts.onToken?.(full[i]);
      count++;
    }
    return { role: 'assistant', content: full };
  }
}

async function main() {
  const memory = new MemoryManager();
  memory.setProvider(new SlowProvider() as any);
  const rag = new RAG(); rag.setProvider(new SlowProvider() as any);
  const loop = new AgentLoop({ provider: new SlowProvider() as any, memory, rag });

  const ac = new AbortController();
  let tokens = 0;
  const p = loop.run({
    userInput: '请生成一段长文本',
    sessionId: 'stop_test_' + Date.now(),
    temperature: 0.7,
    provider: new SlowProvider() as any,
    callbacks: {
      onToken: () => { tokens++; },
      signal: ac.signal,
    },
  });

  // 100ms 后中止（约 6 个 token）
  setTimeout(() => ac.abort(), 100);

  const out = await p;
  console.log('已收到 token 数:', tokens);
  console.log('输出长度:', out.length, '/ 全文', 28);
  if (tokens < 28 && out.length <= 28) {
    console.log('PASS: 中止生效，未输出完整文本');
    process.exit(0);
  } else {
    console.log('FAIL: 中止未生效');
    process.exit(1);
  }
}
main().catch(e => { console.log('ERROR', e); process.exit(1); });
