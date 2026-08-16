// 真实 Ollama 冒烟测试（纯 JS，复用已运行的 gateway 8787）
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const WS_URL = 'ws://127.0.0.1:8787/ws';

function chat(content, sessionId, timeoutMs = 60000) {
  return new Promise((resolve) => {
    const ws = new WebSocket(WS_URL);
    let tokens = '';
    let activity = 0;
    let done = false;
    const finish = (extra) => { try { ws.close(); } catch {} resolve({ tokens, activity, done, ...extra }); };
    ws.on('open', () => ws.send(JSON.stringify({ type: 'chat', content, sessionId })));
    ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.type === 'token') tokens += m.text;
      if (m.type === 'activity') activity++;
      if (m.type === 'done') { done = true; finish({ content: m.content }); }
      if (m.type === 'error') finish({ error: m.message });
    });
    ws.on('error', (e) => finish({ error: e.message }));
    setTimeout(() => finish({ timeout: true }), timeoutMs);
  });
}

(async () => {
  console.log('=== 真实模型冒烟测试 (Ollama qwen3.5-9b-tool) ===');
  // 1. 普通对话
  const r1 = await chat('用一句话介绍你自己，并说明你运行在什么模型上。', 'real1');
  console.log('[1] 流式 token 数:', r1.tokens.length, '| done:', r1.done);
  console.log('    回复片段:', (r1.content || r1.tokens).slice(0, 120));

  // 2. 工具调用：写文件
  const r2 = await chat('请使用 fs_write 工具创建一个文件 notes/ollama_demo.txt，内容为「由本地 Ollama 大模型生成」。', 'real2');
  const fp = path.join(ROOT, 'data', 'workspace', 'notes', 'ollama_demo.txt');
  const fileOk = fs.existsSync(fp);
  console.log('[2] 工具活动事件数:', r2.activity, '| done:', r2.done);
  console.log('    文件已创建:', fileOk, fileOk ? '(' + fs.readFileSync(fp, 'utf8') + ')' : '');

  const pass = r1.done && r1.tokens.length > 0 && r2.done;
  console.log('\n结果:', pass ? 'PASS' : 'FAIL');
  process.exit(pass ? 0 : 1);
})();
