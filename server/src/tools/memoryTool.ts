import { registry } from './registry';
import { MemoryManager } from '../memory';

// 记忆写入工具：让 agent 能把用户提供的稳定信息真实落盘到 data/memory。
// 否则本地小模型只会"口头声称已保存"而实际什么都不写（幻觉）。
export function registerMemoryTools(memory: MemoryManager) {
  registry.register({
    name: 'save_profile',
    description:
      '保存/更新用户画像（profile.json）。当用户告知稳定的个人信息、背景资料，或明确要求"记住/保存"时调用。' +
      '把信息整理成键值对传入 fields，会与已有画像合并（不覆盖其它字段）。' +
      '适合：姓名、职业、邮箱、笔名、QQ、船名、IMO、船型、船旗、公司、设备、系统、工作地点等结构化字段。',
    parameters: {
      type: 'object',
      properties: {
        fields: {
          type: 'object',
          description:
            '要写入/更新的画像字段，例如 {"姓名":"示例用户","职业":"船长","邮箱":"a@b.com","笔名":"示例用户","QQ":"12345","船名":"EXAMPLE_VESSEL","IMO":"EXAMPLE_IMO","船型":"油轮","船旗":"Bahamas","公司":"XX","设备":"MACAEX 笔记本 / RTX 5060 8GB / i7-13620H / 32GB DDR5 / Win10+WSL"}',
        },
      },
      required: ['fields'],
    },
  }, async (args: any) => {
    if (!args.fields || typeof args.fields !== 'object') {
      return { error: 'fields 必须是对象' };
    }
    const updated = memory.updateProfile(args.fields);
    return { ok: true, profile: updated };
  });

  registry.register({
    name: 'save_note',
    description:
      '保存一条长期记忆笔记到指定主题（notes/<主题>.md，如「硬件环境」「职业背景」「项目约定」）。' +
      '同一主题会按日期追加、保留历史。适合保存叙述性/段落式的背景信息。' +
      'topic 为主题名，content 为要记录的内容（支持多行）。',
    parameters: {
      type: 'object',
      properties: {
        topic: { type: 'string', description: '笔记主题，如 硬件环境 / 职业背景 / 项目约定' },
        content: { type: 'string', description: '要记录的内容（支持多行）' },
      },
      required: ['topic', 'content'],
    },
  }, async (args: any) => {
    const topic = String(args.topic || '').trim();
    const content = String(args.content || '');
    if (!topic || !content) return { error: 'topic 与 content 必填' };
    const fp = memory.remember(topic, content);
    return { ok: true, path: fp };
  });
}
