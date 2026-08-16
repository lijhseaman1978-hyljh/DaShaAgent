import { registry } from '../../server/src/tools/registry';
import { registerScriptTool, registerSkillExecTools } from '../../server/src/tools/scriptTool';
registerScriptTool();
registerSkillExecTools();
for (const n of ['skill_xlsx', 'skill_storage_audit', 'skill_email_workflow', 'skill_memory_system', 'skill_polymarket']) {
  const d = registry.getDef(n);
  if (!d) { console.log(n, '→ 未注册'); continue; }
  console.log('\n[' + n + ']');
  console.log('  summary:', registry.summaryOf(n));
  console.log('  desc含excel?', /excel/i.test(d.description), '| desc含存储/storage?', /storage|存储/i.test(d.description));
}
