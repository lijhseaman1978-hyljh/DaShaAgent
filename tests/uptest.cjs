const http = require('http');
const boundary = '----b123';
const body = Buffer.concat([
  Buffer.from('--' + boundary + '\r\n'),
  Buffer.from('Content-Disposition: form-data; name="sessionId"\r\n\r\ncomptest\r\n'),
  Buffer.from('--' + boundary + '\r\n'),
  Buffer.from('Content-Disposition: form-data; name="file"; filename="t.txt"\r\nContent-Type: text/plain\r\n\r\n'),
  Buffer.from('hello world\r\n'),
  Buffer.from('\r\n--' + boundary + '--\r\n'),
]);
const req = http.request({
  host: 'localhost', port: 8787, path: '/api/upload', method: 'POST',
  headers: { 'Content-Type': 'multipart/form-data; boundary=' + boundary, 'Content-Length': body.length },
}, (res) => {
  let d = '';
  res.on('data', c => d += c);
  res.on('end', () => console.log('STATUS', res.statusCode, d.slice(0, 500)));
});
req.on('error', e => console.log('ERR', e.message));
req.write(body);
req.end();
