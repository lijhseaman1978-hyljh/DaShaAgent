import { LoopGuard, systemReminder } from '../../server/src/core/reminders';
import { setActiveModel, currentModelCaps, modelSupportsImages } from '../../server/src/core/modelCaps';
import { pushImage, drainImages } from '../../server/src/core/imageBus';

console.log('[1] 模块加载 OK');

// 护栏三级响应验证
const g = new LoopGuard();
const call = { name: 'fs_read', arguments: { path: 'a.txt' } };
console.log('[2] 第1次相同调用 ->', g.inspect([call]).action);
g.noteResult(call, { ok: true, content: 'hello' });
const v2 = g.inspect([call]);
console.log('[3] 第2次相同调用 ->', v2.action, v2.action === 'block' ? '(已拦截并回述上次结果)' : '');
const v3 = g.inspect([call]);
const v4 = g.inspect([call]);
const v5 = g.inspect([call]);
console.log('[4] 第5次相同调用 ->', v5.action);

// 同工具不同参数连发
const g2 = new LoopGuard();
let last: any;
for (let i = 0; i < 4; i++) last = g2.inspect([{ name: 'fs_read', arguments: { path: 'x' + i } }]);
console.log('[5] fs_read 换参连发4次 ->', last.action);
console.log('    提醒片段:', (last.reminder || '').split('\n')[1]?.slice(0, 50));

// 只读空转
const g3 = new LoopGuard();
let ro: any;
for (const n of ['fs_read','fs_list','use_skill','fs_read','fs_list']) ro = g3.inspect([{ name: n, arguments: { k: Math.random() } }]);
console.log('[6] 只读空转5次 ->', ro.action);

// 模型能力
setActiveModel({ type: 'cloud', model: 'gpt-4o' });
console.log('[7] gpt-4o supportsImages ->', await modelSupportsImages());
setActiveModel({ type: 'cloud', model: 'qwen2.5-7b-instruct' });
console.log('[8] qwen2.5-7b supportsImages ->', await modelSupportsImages());
setActiveModel({ type: 'cloud', model: 'qwen2.5-vl-7b' });
console.log('[9] qwen2.5-VL supportsImages ->', await modelSupportsImages());

// 图片总线
pushImage('s1', { b64: 'AAA', mime: 'image/png', path: 'a.png' });
console.log('[10] 图片总线 drain ->', drainImages('s1').length, '再 drain ->', drainImages('s1').length);
