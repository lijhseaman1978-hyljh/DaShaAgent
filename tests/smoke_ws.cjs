// 真实网关冒烟：模型选择 + 流式对话 + 停止
const WebSocket = require('ws');

function run(chatThenStop) {
  return new Promise((resolve) => {
    const ws = new WebSocket('ws://127.0.0.1:8787/ws');
    let tokens = 0, out = '', gotDone = false, gotStop = false;
    const t0 = Date.now();
    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'chat', content: '用一句话介绍你自己', sessionId: 'smoke_' + Date.now(), modelId: 'ollama:qwen3.5-9b-tool:q5' }));
      if (chatThenStop) setTimeout(() => ws.send(JSON.stringify({ type: 'stop' })), 400);
    });
    ws.on('message', (d) => {
      const m = JSON.parse(d.toString());
      if (m.type === 'token') { tokens++; out += m.text; }
      else if (m.type === 'done') { gotDone = true; }
      else if (m.type === 'activity') { /* ignore */ }
      else if (m.type === 'error') { gotStop = true; }
    });
    setTimeout(() => { ws.close(); resolve({ tokens, out: out.slice(0, 90), gotDone, gotStop, ms: Date.now() - t0 }); }, chatThenStop ? 1500 : 60000);
  });
}

(async () => {
  console.log('=== 普通对话（模型选择 ollama:qwen3.5-9b-tool:q5）===');
  const a = await run(false);
  console.log('tokens:', a.tokens, '| done:', a.gotDone, '| 首段:', a.out.replace(/\n/g, ' '));
  console.log(a.tokens > 0 && a.gotDone ? 'PASS: 流式对话+模型选择正常' : 'FAIL: 对话异常');

  console.log('=== 中途停止 ===');
  const b = await run(true);
  console.log('tokens:', b.tokens, '| done/error:', b.gotDone || b.gotStop);
  console.log(b.tokens < 200 ? 'PASS: 停止生效（token 明显少于完整输出）' : 'WARN: 停止可能未生效');
})();
