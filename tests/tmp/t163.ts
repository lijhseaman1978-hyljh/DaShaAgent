// Task #163 验收：两阶段工具加载
import { MemoryManager } from '../../server/src/memory';
import { registry } from '../../server/src/tools/registry';
import { registerFsTools } from '../../server/src/tools/fsTool';
import { registerMemoryTools } from '../../server/src/tools/memoryTool';
import { registerSkillTool } from '../../server/src/tools/skillTool';
import { registerScriptTool, registerSkillExecTools, registerRunCodeTool } from '../../server/src/tools/scriptTool';
import { registerDocxTool } from '../../server/src/tools/docxTool';
import { registerPdfTool } from '../../server/src/tools/pdfTool';
import { registerXlsxTool } from '../../server/src/tools/xlsxTool';
import { registerPptxTool } from '../../server/src/tools/pptxTool';
import { loadCustomTools } from '../../server/src/tools/custom';
import { registerToolSearchTool, composeTools, composeStats, searchTools, getActivated } from '../../server/src/tools/toolSearch';

registerFsTools();
registerMemoryTools(new MemoryManager());
registerSkillTool();
registerScriptTool();
registerRunCodeTool();
registerSkillExecTools();
registerDocxTool();
registerPdfTool();
registerXlsxTool();
registerPptxTool();
loadCustomTools();
registerToolSearchTool();

const ctx: any = { sessionId: 'S1', emit: () => {} };
const line = (s: string) => console.log('\n=== ' + s + ' ===');

line('1. 基线：通用输入（无任何信号）');
const base = composeStats('你好，帮我看看今天有什么安排', [], 'S1');
console.log(`可见 ${base.visible} / 隐藏 ${base.hidden} | schema ${base.fullChars} → ${base.chars} 字符，省 ${(base.saved / base.fullChars * 100).toFixed(1)}%`);
console.log('可见工具:', base.names.join(', '));

line('2. 信号命中：输入含 .xlsx 应自动展开 skill_xlsx（无需检索）');
const sig = composeStats('帮我把 D:/report.xlsx 里的数据重算一下', ['report.xlsx'], 'S2');
console.log(`可见 ${sig.visible} / 隐藏 ${sig.hidden} | schema ${sig.chars} 字符`);
console.log('skill_xlsx 是否展开:', sig.names.includes('skill_xlsx') ? '✅ 是' : '❌ 否');

line('3. tool_search 描述里是否真带了隐藏工具目录');
const t = composeTools('你好', [], 'S1').find((x) => x.name === 'tool_search')!;
const m = t.description.match(/<deferred_tools count="(\d+)">([\s\S]*?)<\/deferred_tools>/);
console.log('目录条目数:', m ? m[1] : '❌ 缺失', '| 目录字符:', m ? m[2].trim().length : 0);
console.log('目录前 5 行:\n' + (m ? m[2].trim().split('\n').slice(0, 5).map(x => '  ' + x).join('\n') : ''));

line('4. 中文 BM25 检索（这是自研分词的核心验证点）');
for (const q of ['生成一张海报', '发邮件', 'excel 表格重算', '存储空间占用分析', 'github 授权']) {
  const r = searchTools(q, { limit: 3, pool: new Set(registry.deferredNames()) });
  console.log(`  "${q}" → ${r.map((x) => x.name).join(', ') || '(无命中)'}`);
}

line('5. tool_search 执行 + 激活闭环');
const exec = async () => {
  const before = composeTools('你好', [], 'S1').map((x) => x.name);
  console.log('检索前 skill_agnes_ai_generation 可调用:', before.includes('skill_agnes_ai_generation'));

  const res: any = await registry.execute(
    { id: 'c1', name: 'tool_search', arguments: { queries: ['生成图片 海报'], top_k: 2 } } as any,
    ctx,
  );
  console.log('检索结果 ok:', res.ok, '| 已加载:', res.已加载);
  console.log('会话激活集:', [...getActivated('S1')]);

  const after = composeTools('你好', [], 'S1');
  const names = after.map((x) => x.name);
  console.log('检索后可调用:', res.已加载?.every((n: string) => names.includes(n)) ? '✅ 全部进入 tools 数组' : '❌ 未进入');
  console.log('检索后规模:', after.length, '个 /', after.reduce((s, d) => s + JSON.stringify(d).length, 0), '字符');

  line('6. 精确名加载 + 容错（漏写 skill_ 前缀 / 名字写错）');
  const r2: any = await registry.execute(
    { id: 'c2', name: 'tool_search', arguments: { tool_names: ['email_workflow', 'skill_不存在的东西'] } } as any,
    ctx,
  );
  console.log('已加载:', r2.已加载, '| 未命中:', r2.未命中);

  line('7. 空参数保护');
  const r3: any = await registry.execute({ id: 'c3', name: 'tool_search', arguments: {} } as any, ctx);
  console.log('返回:', r3.error, '|', r3.hint);

  line('8. LRU 上限（MAX_ACTIVE=10）');
  await registry.execute({ id: 'c4', name: 'tool_search', arguments: { queries: ['视频', '图像', '代码', '数据', '文档', '自动化', '邮件', '搜索', '存储', '部署', '网页', '笔记'], top_k: 3 } } as any, ctx);
  console.log('激活集大小:', getActivated('S1').size, getActivated('S1').size <= 10 ? '✅ 未超上限' : '❌ 越界');
  const fin = composeStats('你好', [], 'S1');
  console.log(`满激活时规模: 可见 ${fin.visible} / 隐藏 ${fin.hidden} | ${fin.chars} 字符（仍比全量 ${fin.fullChars} 少 ${fin.saved}）`);
};
exec();
