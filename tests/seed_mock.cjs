// 用 WS 发起几次对话（mock provider 立即返回），建立会话 mockcomp
const WebSocket = require('ws');
const ws = new WebSocket('ws://localhost:8787/ws');
let n = 0;
const msgs = ['记住：我喜欢蓝色。', '我的宠物是一只猫。', '我最担心台风天航行。'];
ws.on('open', () => ws.send(JSON.stringify({ type: 'chat', content: msgs[0], sessionId: 'mockcomp' })));
ws.on('message', (d) => {
  const m = JSON.parse(d.toString());
  if (m.type === 'done') {
    n++;
    if (n < msgs.length) ws.send(JSON.stringify({ type: 'chat', content: msgs[n], sessionId: 'mockcomp' }));
    else { console.log('seeded', n, 'chats'); ws.close(); process.exit(0); }
  }
});
ws.on('error', e => { console.log('ERR', e.message); process.exit(1); });
setTimeout(() => { console.log('timeout'); process.exit(1); }, 20000);
