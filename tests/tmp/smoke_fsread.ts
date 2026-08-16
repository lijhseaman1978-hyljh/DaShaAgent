import { registerFsTools } from '../../server/src/tools/fsTool';
import { registry } from '../../server/src/tools/registry';
import { setActiveModel } from '../../server/src/core/modelCaps';
import { drainImages } from '../../server/src/core/imageBus';
import path from 'node:path';

registerFsTools();
const S = path.resolve('data/workspace/_probe/samples');
const ctx = { sessionId: 'test', emit: () => {}, provider: null } as any;

async function read(p: string, args: any = {}) {
  return await registry.execute(
    { id: '1', name: 'fs_read', arguments: { path: p, ...args } } as any, ctx);
}

const brief = (r: any) => {
  if (r.error) return `ERROR ${r.error} | ${(r.detail || '').slice(0, 70)}`;
  const c = (r.content || '').replace(/\s+/g, ' ').slice(0, 60);
  return `${String(r.type).padEnd(6)} unit=${String(r.unit || '-').padEnd(7)} ` +
    `total=${String(r.total_units ?? '-').padEnd(4)} ret=${String(r.returned_units ?? '-').padEnd(4)} ` +
    `tok=${String(r.est_tokens ?? '-').padEnd(5)} next=${r.next_offset ?? '-'} | ${c}`;
};

console.log('══ 各格式解析 ══');
for (const f of ['test.epub', 'test.ipynb', 'test.html', 'test.rtf', 'test.eml',
                 'test.zip', 'test_gbk.csv', 'test.tsv', 'disguised.txt', 'test.bin']) {
  console.log(f.padEnd(16), brief(await read(path.join(S, f))));
}

console.log('\n══ 分页 / Token 预算（big.txt）══');
const p1 = await read(path.join(S, 'big.txt'), { limit: 5 });
console.log('limit=5      ', brief(p1));
const p2 = await read(path.join(S, 'big.txt'), { offset: p1.next_offset, limit: 5 });
console.log('续读 offset=' + p1.next_offset, brief(p2));
console.log('续读提示:', (p1.continue_hint || '').slice(0, 90));

const tiny = await read(path.join(S, 'big.txt'), { max_tokens: 60 });
console.log('max_tokens=60', brief(tiny));

console.log('\n══ 图片双通道 ══');
setActiveModel({ type: 'cloud', model: 'qwen2.5-7b-instruct' }); // 纯文本模型
const noVision = await read(path.join(S, 'test.png'));
console.log('文本模型 -> mode=' + noVision.mode, '|', (noVision.note || '').slice(0, 40));
console.log('  内容:', (noVision.content || '').replace(/\s+/g, ' ').slice(0, 60));

setActiveModel({ type: 'cloud', model: 'gpt-4o' }); // 多模态模型
const vision = await read(path.join(S, 'test.png'));
console.log('视觉模型 -> mode=' + vision.mode, '| 尺寸', vision.dimensions);
console.log('  观察文本长度:', JSON.stringify(vision).length, '字符（base64 未污染观察）');
const pending = drainImages('test');
console.log('  旁路总线待注入图片:', pending.length, '张, b64 长度', pending[0]?.b64.length);

console.log('\n══ 错误路径 ══');
console.log('不存在   ', brief(await read(path.join(S, 'nope.pdf'))));
console.log('是目录   ', brief(await read(S)));
