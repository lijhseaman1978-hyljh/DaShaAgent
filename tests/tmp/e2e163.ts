// 真模型端到端：验证模型会在需要时主动 tool_search，并调用检索回来的工具
import { getProvider, resetProviderCache } from '../../server/src/llm/provider';
import { MemoryManager } from '../../server/src/memory';
import { RAG } from '../../server/src/rag';
import { AgentLoop } from '../../server/src/core/agentLoop';
import { registry } from '../../server/src/tools/registry';
import { registerFsTools } from '../../server/src/tools/fsTool';
import { registerMemoryTools } from '../../server/src/tools/memoryTool';
import { registerSkillTool } from '../../server/src/tools/skillTool';
import { registerScriptTool, registerSkillExecTools, registerRunCodeTool } from '../../server/src/tools/scriptTool';
import { registerDocxTool } from '../../server/src/tools/docxTool';
import { registerPdfTool } from '../../server/src/tools/pdfTool';
import { registerXlsxTool } from '../../server/src/tools/xlsxTool';
import { registerPptxTool } from '../../server/src/tools/pptxTool';
import { registerToolSearchTool, getActivated } from '../../server/src/tools/toolSearch';

async function main() {
  resetProviderCache();
  const provider = await getProvider();
  console.log('Provider:', provider.name, '| 可用:', await provider.isAvailable());

  const memory = new MemoryManager(); memory.setProvider(provider);
  const rag = new RAG(); rag.setProvider(provider);
  registerFsTools();
  registerMemoryTools(memory);
  registerSkillTool();
  registerScriptTool();
  registerRunCodeTool();
  registerSkillExecTools();
  registerDocxTool(); registerPdfTool(); registerXlsxTool(); registerPptxTool();
  registerToolSearchTool();

  const loop = new AgentLoop({ provider, memory, rag });
  const sid = 'e2e163_' + Date.now();
  const calls: string[] = [];

  // 用一个"必须靠隐藏技能才能做"的请求：磁盘占用审计（skill_storage_audit 默认是 deferred）
  const q = '帮我做一次磁盘存储占用分析，看看哪些文件可以清理';
  console.log('\n用户请求:', q);
  console.log('（skill_storage_audit 默认不在 tools 数组里——省上下文；但模型能在 tool_search 描述的 <deferred_tools> 目录里看到它。');
  console.log('  验证通过 = 模型最终抵达了该隐藏技能；抵达路径有两条都合法：① tool_search 先加载再调用 ② 直接从目录里认出名字直接 call。)\n');

  const out = await loop.run({
    userInput: q,
    sessionId: sid,
    callbacks: {
      onActivity: (ev: any) => {
        if (ev.type === 'tool_start') { calls.push(ev.tool); console.log('  → 调用', ev.tool); }
        if (ev.type === 'info') console.log('  · ' + ev.message);
      },
    },
  });

  console.log('\n--- 结果 ---');
  console.log('工具调用序列:', calls.join(' → ') || '(无)');
  console.log('会话激活集:', [...getActivated(sid)]);
  console.log('是否用了 tool_search:', calls.includes('tool_search') ? '✅' : '❌');
  console.log('是否调到了隐藏技能:', calls.some((c) => registry.tierOf(c) === 'deferred') ? '✅' : '❌（未必是错，看模型判断）');
  console.log('\n最终回复(前 400 字):\n' + String(out).slice(0, 400));
}
main().catch((e) => { console.error('FAILED:', e?.message || e); process.exit(1); });
