// 单元测试：验证 sessions.compress() 正确把旧历史替换为摘要，保留最近 keepLast 条。
// 不依赖真实模型 —— 直接断言会话重写逻辑。
import { sessions } from '../server/src/core/session';

function assert(cond: any, msg: string) {
  if (!cond) { console.error('FAIL:', msg); process.exit(1); }
}

const id = 'unit_compress_test_' + Date.now(); // 2026-08-13：唯一 id 隔离（全局 session 单例无删除 API，固定 id 会残留上次运行的数据）
// 构造 6 条历史
for (let i = 1; i <= 6; i++) {
  sessions.append(id, { role: i % 2 ? 'user' : 'assistant', content: `消息${i}` });
}
const before = sessions.get(id)!;
console.log('压缩前消息数:', before.messages.length);
assert(before.messages.length === 6, '压缩前应为 6 条');

const ok = sessions.compress(id, '【摘要】用户喜欢蓝色，养了一只猫。', 4);
assert(ok, 'compress 应返回 true');

const after = sessions.get(id)!;
console.log('压缩后消息数:', after.messages.length);
console.log('首条 role:', after.messages[0].role);
console.log('首条内容:', String(after.messages[0].content).slice(0, 60));

assert(after.messages.length === 5, '压缩后应为 1 摘要 + 4 最近 = 5 条');
assert(after.messages[0].role === 'system', '首条应为 system 摘要');
assert(String(after.messages[0].content).includes('以下为压缩前的对话历史摘要'), '首条应包含压缩标记');
assert(String(after.messages[0].content).includes('用户喜欢蓝色'), '摘要应包含关键信息');
assert(after.messages[after.messages.length - 1].content === '消息6', '最后一条应保留最近内容');

// 确认 toChatMessages 也能带上摘要（供模型上下文）
const chat = sessions.toChatMessages(id);
assert(chat[0].role === 'system' && chat[0].content.includes('以下为压缩前的对话历史摘要'), 'toChatMessages 应包含摘要');

console.log('PASS: 上下文压缩重写逻辑正确');
