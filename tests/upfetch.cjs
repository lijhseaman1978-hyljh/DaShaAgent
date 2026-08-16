// 模拟浏览器 fetch + FormData 上传路径（前端实际使用方式）
const f = new FormData();
f.append('file', new Blob(['hello from browser-style upload\n第二行\n'], { type: 'text/plain' }), 'browser_t.txt');
f.append('sessionId', 'comptest');
fetch('http://localhost:8787/api/upload', { method: 'POST', body: f })
  .then(async (r) => {
    const t = await r.text();
    console.log('STATUS', r.status, t.slice(0, 500));
  })
  .catch(e => console.log('ERR', e.message));
