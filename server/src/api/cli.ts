// api/cli.ts
// CLI 交互入口：让 DaShaAgent 能在终端直接对话（对标 dasha CLI）
// 用法：npx tsx server/src/api/cli.ts "你的问题"
// 或：npx tsx server/src/api/cli.ts（进入交互模式）
// P3 升级：显示当前模型 + /model 切换 + /models 列表

import { getProvider, createProvider, resetProviderCache, type ProviderSpec } from '../llm/provider';
import { AgentLoop } from '../core/agentLoop';
import { MemoryManager, injectV3 } from '../memory';
import { cognitiveMemory } from '../cognitive';
import { RAG } from '../rag';
import { registerFsTools } from '../tools/fsTool';
import { registerMemoryTools } from '../tools/memoryTool';
import { registerSkillTool } from '../tools/skillTool';
import { registerScriptTool, registerSkillExecTools, registerRunCodeTool } from '../tools/scriptTool';
import { registerToolSearchTool } from '../tools/toolSearch';
import { registerDocxTool } from '../tools/docxTool';
import { registerPdfTool } from '../tools/pdfTool';
import { registerXlsxTool } from '../tools/xlsxTool';
import { registerPptxTool } from '../tools/pptxTool';
import { registerWebSearchTool } from '../tools/webSearchTool';
import { registerImageGenTool } from '../tools/imageGenTool';
import { registerEmailTool } from '../tools/emailTool';
import { registerBlogTool } from '../tools/blogTool';
import { registerUtilityTools } from '../tools/utilityTools';
import { sessions } from '../core/session';
import readline from 'node:readline';
import { CONFIG } from '../config';

// 可用模型规格（/model 切换用）
const MODEL_SPECS: Record<string, ProviderSpec> = {
  agnes: { type: 'agnes', model: process.env.AH_AGNES_MODEL || 'deepseek-v4-flash', },
  agnes2: { type: 'agnes', model: 'deepseek-v4-flash' },
  openai: { type: 'cloud', base: process.env.AH_OPENAI_BASE || 'https://api.openai.com/v1', model: process.env.AH_OPENAI_MODEL || 'gpt-4o-mini', key: process.env.OPENAI_API_KEY || process.env.AH_CLOUD_KEY },
  claude: { type: 'cloud', base: 'https://api.anthropic.com/v1', model: process.env.AH_CLAUDE_MODEL || 'claude-3-5-sonnet', key: process.env.ANTHROPIC_API_KEY },
  gemini: { type: 'cloud', base: 'https://generativelanguage.googleapis.com/v1beta/openai', model: process.env.AH_GEMINI_MODEL || 'gemini-2.0-flash', key: process.env.GOOGLE_API_KEY },
  ollama: { type: 'ollama', base: process.env.AH_OLLAMA_BASE || 'http://127.0.0.1:11434', model: process.env.AH_OLLAMA_MODEL || 'qwen3.5:9b' },
  local: { type: 'ollama', base: 'http://127.0.0.1:11434', model: 'qwen3.5:9b' },
  mock: { type: 'mock' },
};

let currentProviderName = 'agnes';
let currentLoop: AgentLoop | null = null;
let currentMemory: MemoryManager | null = null;
let currentRag: RAG | null = null;

function setupTools(memory: MemoryManager) {
  registerFsTools();
  registerMemoryTools(memory);
  registerSkillTool();
  registerScriptTool();
  registerRunCodeTool();
  registerSkillExecTools();
  registerDocxTool();
  registerPdfTool();
  registerXlsxTool();
  registerPptxTool();
  registerWebSearchTool();
  registerImageGenTool();
  registerEmailTool();
  registerBlogTool();
  registerUtilityTools();
  registerToolSearchTool();
}

async function createLoop(providerName: string): Promise<AgentLoop> {
  const spec = MODEL_SPECS[providerName];
  if (!spec) throw new Error('未知模型: ' + providerName);

  let provider;
  if (providerName === 'agnes' || providerName === 'agnes2') {
    // 直接用 getProvider 能拿到 agnes（已修）；但为了明确指定模型，用 createProvider
    provider = createProvider(spec);
  } else {
    provider = createProvider(spec);
  }

  currentProviderName = providerName;
  const memory = new MemoryManager();
  memory.setProvider(provider);
  const rag = new RAG();
  rag.setProvider(provider);
  currentMemory = memory;
  currentRag = rag;
  setupTools(memory);   // B4 修复：CLI 入口此前漏调 setupTools()，导致 fs/script/skill/search 等工具注册表为空
  currentLoop = new AgentLoop({ provider, memory, rag });
  return currentLoop;
}

function modelStatus(providerName: string): string {
  const spec = MODEL_SPECS[providerName];
  return `${providerName} (${spec?.model || '默认'})`;
}

function printHelp() {
  console.log('');
  console.log('═══════════ DaShaAgent CLI ═══════════');
  console.log('  /model <名>   切换模型（agnes/openai/claude/gemini/ollama/mock）');
  console.log('  /models       列出可用模型');
  console.log('  /status       查看当前模型状态');
  console.log('  /reset        开启新会话');
  console.log('  /help         显示帮助');
  console.log('  /exit         退出');
  console.log('════════════════════════════════════════');
  console.log(`当前模型: ${modelStatus(currentProviderName)}`);
  console.log('');
}

async function main() {
  // Phase 2b (V3吞并V2): 注入 V3 认知记忆到 MemoryManager 兼容壳，否则调用记忆相关方法会抛
  // "MemoryManager: V3 cognitiveMemory not injected. Call injectV3() during boot."
  // （服务器入口 unified.ts:80 已注入；CLI 是独立入口，必须自己注入）
  injectV3(cognitiveMemory);

  const args = process.argv.slice(2);

  // 支持 -m/--model 参数：harness -m ollama "问题"
  let startModel = 'agnes';
  const mIdx = args.indexOf('-m') >= 0 ? args.indexOf('-m') : args.indexOf('--model');
  if (mIdx >= 0 && args[mIdx + 1]) {
    startModel = args[mIdx + 1];
    args.splice(mIdx, mIdx + 1 >= args.length ? 1 : 2);
  }

  // 初始化（默认 agnes，或从环境变量读）
  const envModel = (process.env.AH_CLI_MODEL || '').toLowerCase();
  if (MODEL_SPECS[envModel]) startModel = envModel;

  const loop = await createLoop(startModel);
  const sessionId = 'cli_' + Date.now();

  if (args.length > 0) {
    // 单次模式：harness "问题" 或 harness -m agnes "问题"
    const input = args.join(' ');
    console.log(`\n[模型: ${modelStatus(currentProviderName)}]`);
    console.log(`>>> ${input}\n`);
    const result = await loop.run({ userInput: input, sessionId });
    console.log('\n' + result);
    return;
  }

  // 交互模式
  printHelp();
  let cliSessionId = sessionId;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  const ask = () => rl.question('\n你> ', async (input) => {
    const text = input.trim();
    if (text === '/exit' || text === '/quit') { rl.close(); return; }
    if (text === '/reset') { cliSessionId = 'cli_' + Date.now(); console.log('[已开启新会话]'); ask(); return; }
    if (text === '/help') { printHelp(); ask(); return; }
    if (text === '/models') {
      console.log('可用模型:');
      for (const [name, spec] of Object.entries(MODEL_SPECS)) {
        const active = name === currentProviderName ? ' ◀ 当前' : '';
        console.log(`  ${name.padEnd(10)} ${spec.model || spec.type}${active}`);
      }
      ask(); return;
    }
    if (text === '/status') {
      console.log(`当前模型: ${modelStatus(currentProviderName)}`);
      console.log(`会话ID: ${cliSessionId}`);
      ask(); return;
    }
    if (text.startsWith('/model ')) {
      const name = text.slice(7).trim().toLowerCase();
      if (!MODEL_SPECS[name]) {
        console.log(`❌ 未知模型: ${name}。可用: ${Object.keys(MODEL_SPECS).join(', ')}`);
        ask(); return;
      }
      try {
        const newLoop = await createLoop(name);
        cliSessionId = 'cli_' + Date.now(); // 换模型开新会话，避免上下文错乱
        console.log(`✅ 已切换到 ${modelStatus(name)}`);
        void newLoop;
      } catch (e: any) {
        console.log(`❌ 切换失败: ${e?.message || e}`);
      }
      ask(); return;
    }
    if (!text) { ask(); return; }
    console.log(`\n[${modelStatus(currentProviderName)}]`);
    console.log('Agent> ');
    try {
      const result = await currentLoop!.run({ userInput: text, sessionId: cliSessionId });
      console.log(result);
    } catch (e: any) {
      console.log(`❌ 错误: ${e?.message || e}`);
    }
    ask();
  });
  ask();
}

main().catch((e) => {
  console.error('CLI 启动失败:', e);
  process.exit(1);
});
