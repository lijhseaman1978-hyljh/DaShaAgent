// 真实规模测量：按 server.ts 的顺序注册全部工具，统计数量与 schema 字符数
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

registerFsTools();
registerMemoryTools(new MemoryManager());
registerSkillTool();
registerScriptTool();
registerRunCodeTool();
const st = registerSkillExecTools();
registerDocxTool();
registerPdfTool();
registerXlsxTool();
registerPptxTool();
loadCustomTools();

const all = registry.listForAgent();
let total = 0;
const rows: Array<[string, number]> = [];
for (const d of all) {
  const n = JSON.stringify(d).length;
  total += n;
  rows.push([d.name, n]);
}
rows.sort((a, b) => b[1] - a[1]);
console.log('技能执行工具注册数:', st.registered);
console.log('工具总数:', all.length, '| 全量 schema 字符:', total);
console.log('--- Top 15 体积 ---');
for (const [n, c] of rows.slice(0, 15)) console.log(String(c).padStart(6), n);
const skillCnt = all.filter(d => d.name.startsWith('skill_')).length;
console.log('--- skill_* 工具:', skillCnt, '个，占字符:',
  all.filter(d => d.name.startsWith('skill_')).reduce((s, d) => s + JSON.stringify(d).length, 0));
console.log('--- 非 skill 工具:', all.length - skillCnt, '个 ---');
console.log(all.filter(d => !d.name.startsWith('skill_')).map(d => d.name).join(', '));
