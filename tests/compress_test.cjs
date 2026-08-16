// 1) 通过 WS 发起一次对话，建立会话 comptest（含多条消息）
// 2) 调用 POST /api/sessions/comptest/compress 压缩上下文
const WebSocket = require('ws');
const http = require('http');

const ws = new WebSocket('ws://localhost:8787/ws');
let steps = [];

ws.on('open', () => {
  ws.send(JSON.stringify({ type: 'chat', content: '请记住：我最喜欢的颜色是蓝色，宠物是一只猫。', sessionId: 'comptest' }));
});
ws.on('message', (d) => {
  const m = JSON.parse(d.toString());
  if (m.type === 'done') {
    steps.push('chat done');
    // 再发一条，制造至少 4 条消息
    ws.send(JSON.stringify({ type: 'chat', content: '那我的宠物是什么动物？', sessionId: 'comptest' }));
  } else if (m.type === 'token') {
    // 忽略
  } else if (m.type === 'error') {
    console.log('CHAT ERROR', m.message); ws.close(); process.exit(1);
  }
});
// 用超时兜底：等对话完成后做压缩
setTimeout(() => {
  const req = http.request({
    host: 'localhost', port: 8787, path: '/api/sessions/comptest/compress', method: 'POST',
  }, (res) => {
    let b = '';
    res.on('data', c => b += c);
    res.on('end', () => {
      console.log('COMPRESS STATUS', res.statusCode);
      console.log('COMPRESS BODY', b.slice(0, 400));
      process.exit(0);
    });
  });
  req.on('error', e => { console.log('COMPRESS ERR', e.message); process.exit(1); });
  req.end();
}, 45000);
ws.on('error', e => { console.log('WS ERR', e.message); process.exit(1); });
