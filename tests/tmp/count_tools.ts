import { registry } from '../../server/src/tools/registry';
import { registerFsTools } from '../../server/src/tools/fsTool';
import { registerDocxTool } from '../../server/src/tools/docxTool';
import { registerPdfTool } from '../../server/src/tools/pdfTool';
import { registerXlsxTool } from '../../server/src/tools/xlsxTool';
import { registerPptxTool } from '../../server/src/tools/pptxTool';
registerFsTools(); 
try { (registerDocxTool as any)(); } catch {}
try { (registerPdfTool as any)(); } catch {}
try { (registerXlsxTool as any)(); } catch {}
try { (registerPptxTool as any)(); } catch {}
const all = registry.list();
console.log('工具数:', all.length);
let chars = 0;
for (const t of all) chars += t.name.length + t.description.length + JSON.stringify(t.parameters).length;
console.log('全量 schema 字符数:', chars);
for (const t of all) console.log(' -', t.name.padEnd(22), t.description.length, 'chars');
