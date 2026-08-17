// server/src/unified.ts
// DaShaAgent 统一入口 — 引擎 + 控制台，单端口 3001
//
// 设计理念：
//   引擎层（AgentLoop + Tools + Memory + RAG + Scheduler）——干活的大脑和手脚
//   控制台（Dashboard + Chat + Observability + Workflow）——用户界面
//   两者是同一产品的两个层。引擎内嵌在控制台里，用户只看到一个端口。

import './core/crashHandlers'; // F-01：最先安装全局异常兜底（见 core/crashHandlers.ts）
import { CONFIG } from './config';
import './runtime';
import fsp from 'node:fs/promises';
import { join } from 'node:path';
import { getProvider, resetProviderCache } from './llm/provider';
import { MemoryManager, injectV3 } from './memory';
import { RAG } from './rag';
import { AgentLoop, type AgentHooks } from './core/agentLoop';
import { heartbeat } from './core/heartbeat';
import { registerHeartbeatSelfHeal } from './core/heartbeatSelfHeal';
import { sessions } from './core/session';
import { Orchestrator } from './core/orchestrator';
import { TeamRunner } from './team/runner';
import { Scheduler } from './scheduler';
import { llm as llmRouter } from './llm';
import { cognitiveMemory } from './cognitive';
import { registerFsTools } from './tools/fsTool';
import { registerMemoryTools } from './tools/memoryTool';
import { loadCustomTools } from './tools/custom';
import { registerSkillTool } from './tools/skillTool';
import { registerScriptTool, registerSkillExecTools, registerRunCodeTool } from './tools/scriptTool';
import { registerToolSearchTool, composeStats } from './tools/toolSearch';
import { registerDocxTool } from './tools/docxTool';
import { registerPdfTool } from './tools/pdfTool';
import { registerXlsxTool } from './tools/xlsxTool';
import { registerPptxTool } from './tools/pptxTool';
import { registerWebSearchTool } from './tools/webSearchTool';
import { registerImageGenTool } from './tools/imageGenTool';
import { registerEmailTool } from './tools/emailTool';
import { registerBlogTool } from './tools/blogTool';
import { registerUtilityTools } from './tools/utilityTools';
import { ModelManager } from './models';
import { getSkills } from './skills/loader';
import { registry } from './tools/registry';
import { createWorkflowEngine } from './workflow';
import { autonomy } from './autonomy';
import { learning } from './learning';

// ── 引擎初始化 ──


// ── P3: Observability 轮转（防止 observability.json 无限膨胀）──
// 每次写入前检查文件大小，超过阈值（500KB）则轮转为备份文件
function rotateObservabilityFile(filePath: string) {
  try {
    if (fs.existsSync(filePath)) {
      const stat = fs.statSync(filePath);
      if (stat.size > 500_000) { // 500KB 阈值
        const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const bak = filePath.replace('.json', `-${ts}.json`);
        fs.renameSync(filePath, bak);
        console.log(`[Engine] Observability rotated: ${path.basename(bak)} (was ${(stat.size/1024).toFixed(0)}KB)`);
      }
    }
  } catch (e: any) { console.warn('[Engine] Observability rotation failed:', e?.message ?? e); }
}

async function bootEngine() {
  console.log('[Engine] Booting (Tools, RAG, Scheduler)...');

  resetProviderCache();
  const provider = await getProvider();
  // BUG#1 修复：不再硬编码默认模型——auto 模式自动选最优
  const actualProvider = provider.name;
  console.log(`[Engine] Ready — boot provider: ${actualProvider} (RAG/embeddings)`);
  console.log(`[Engine] Chat/Agent tasks use LLM Router — follows UI model selection`);

  const memory = new MemoryManager();
  memory.setProvider(provider);

  // Phase 2b (V3吞并V2): 注入 V3 到 V2 兼容壳，加载持久化数据
  injectV3(cognitiveMemory);
  const cognitivePath = join(CONFIG.DATA_DIR, 'cognitive.json');
  try {
    const raw = await fsp.readFile(cognitivePath, 'utf-8');
    cognitiveMemory.load(JSON.parse(raw));
    console.log(`[Engine] Cognitive memory loaded: ${cognitiveMemory.counters().remembers} episodes, ${cognitiveMemory.notes.size} notes, profile=${Object.keys(cognitiveMemory.profile).length} keys`);
  } catch { /* 首次启动无文件 */ }

  // Phase 2b: 一次性迁移 V2 → V3（仅首次）
  const profilePath = join(CONFIG.MEMORY_DIR, 'profile.json');
  const notesDir = join(CONFIG.MEMORY_DIR, 'notes');
  let migrated = false;
  try {
    const oldProfile = JSON.parse(await fsp.readFile(profilePath, 'utf-8'));
    if (oldProfile && Object.keys(oldProfile).length) {
      cognitiveMemory.setProfile(oldProfile);
      migrated = true;
      console.log('[Engine] Migrated V2 profile → V3');
    }
  } catch { /* 无旧 profile */ }
  try {
    const oldNotes = await fsp.readdir(notesDir);
    for (const fn of oldNotes) {
      if (!fn.endsWith('.md')) continue;
      const topic = fn.replace(/\.md$/, '');
      if (cognitiveMemory.readNote(topic)) continue; // 已存在则跳过
      const content = await fsp.readFile(join(notesDir, fn), 'utf-8');
      cognitiveMemory.writeNote(topic, content);
      migrated = true;
    }
    if (migrated) console.log('[Engine] Migrated V2 notes → V3');
  } catch { /* 无旧 notes */ }

  const rag = new RAG();
  rag.setProvider(provider);
  rag.ingestOnce();

  const modelManager = new ModelManager();

  // 用 ModelManager 解析真实 Provider（取代 getProvider 可能返回的 MockProvider）
  // getProvider 在 auto 模式且无 Ollama/Cloud 环境变量时回退到 mock，但用户通过 UI
  // 配置的模型（如 deepseek-v4-flash）在 data/config.json 中，只有 ModelManager 能读到。
  let displayProvider = provider;  // 默认用 boot provider
  try {
    const resolved = await modelManager.resolveProvider();
    if (resolved?.provider && resolved.provider.name !== 'mock') {
      displayProvider = resolved.provider;
      console.log(`[Engine] Resolved active model from ModelManager: ${displayProvider.name}`);
    }
  } catch { /* 保持 boot provider */ }

  // 注册全部工具
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
  // P0 新增：联网搜索 / 图片生成 / 邮件发送
  registerWebSearchTool();
  registerImageGenTool();
  registerEmailTool();
  registerBlogTool();
  registerUtilityTools();
  loadCustomTools();
  registerToolSearchTool();

  const deps = {
    provider: displayProvider,  // 优先用用户配置的真实模型名
    memory,
    rag,
    loop: null as any,
    team: null as any,
    scheduler: null as any,
    modelManager,
    _resumeContext: null as any,  // 跨会话恢复上下文
  };

  // 创建核心 Agent Loop（这就是"会干活的 Agent"），注入认知记忆 + 可观测性钩子
  const { tracer, logger, metrics } = await import('./observability');
  const { llm: llmRouter } = await import('./llm');
  const hooks: AgentHooks = {
    // P1-4: 注入最近学习产出
    onLearn: async (task) => {
      try {
        const recent = learning.getRecentInsights(3);
        if (!recent || recent.length === 0) return '';
        return '【最近学到的教训】\n' + recent.map((r: any, i: number) => `${i+1}. ${r}`).join('\n');
      } catch { return ''; }
    },
    // 自主性闭环（消费者端）：把 Autonomy Engine 生成的待执行目标注入系统提示，
    // 让 Agent 感知到这些目标，并可在相关任务中顺带执行（此前 goals 无人消费、悬空）。
    onAutonomy: async () => {
      try {
        const pending = autonomy.generator.pending();
        if (!pending || pending.length === 0) return '';
        const lines = pending.slice(0, 5).map((g: any, i: number) =>
          `${i + 1}. ${g.title}（优先级 ${Math.round((g.priority || 0) * 100)}，风险 ${Math.round((g.risk || 0) * 100)}）—— 建议动作：${g.suggestedAction || g.reason || ''}`
        );
        return '【自主目标（Autonomy Engine 待执行）】\n' + lines.join('\n') +
          '\n若与当前任务相关且安全，可顺带处理；风险较高的目标请谨慎，不要擅自执行破坏性操作。';
      } catch { return ''; }
    },
    onRecall: async (task) => {
      try {
        return await cognitiveMemory.buildContext(task, 5);
      } catch { return ''; }
    },
    onStart: ({ task }) => {
      const spanId = `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      console.log(`[Hook] onStart [${spanId}]:`, task.slice(0, 50));
      logger.info('Agent', `Task started: ${task.slice(0, 80)}`, { spanId });
      metrics.increment('agent.task.started');
      return tracer.start('agent.task', { task: task.slice(0, 60) });
    },
    onFinish: ({ span, status, error }) => {
      if (error) tracer.fail(new Error(error), span);
      else tracer.end(span, { status });
      metrics.increment(status === 'ok' ? 'agent.task.completed' : 'agent.task.failed');
      // 持久化可观测数据到磁盘（重启不丢）
      persistObservability(metrics, logger);
    },
    onComplete: async ({ task, result, success }) => {
      console.log(`[Hook] onComplete: success=${success}, task="${task.slice(0, 40)}", result_len=${result?.length || 0}`);
      try {
        await cognitiveMemory.remember({
          task: task.slice(0, 200),
          result: success,
          lesson: result?.slice(0, 500) || '',
          tags: [],
        });
        // 学习引擎闭环（V5 Step 4）：把任务结果喂入「经验→知识→技能」管道——
        // 此前 learnFromTask() 零调用者，蒸馏引擎空转；现在每次任务完成都摄入真实经验。
        try {
          learning.learnFromTask({ taskName: 'agent.task', goal: task, result, success });
          console.log('[Hook] onComplete: learnFromTask() ingested into Learning Engine');
        } catch (e: any) { console.log('[Hook] learnFromTask error:', e.message); }
        // 持久化到磁盘，重启不丢
        try {
          const fs = await import('fs/promises');
          const dump = cognitiveMemory.dump();
          await fs.writeFile(path.join(CONFIG.DATA_DIR, 'cognitive.json'), JSON.stringify(dump), 'utf-8');
        } catch { /* 非关键 */ }
        console.log('[Hook] onComplete: remember() done + saved to disk');
      } catch(e: any) { console.log('[Hook] onComplete error:', e.message); }
    },
  };
  // AgentLoop 直接读取 deps.provider（WS handler 通过 opts.provider 动态注入）
  const loop = new AgentLoop(deps, hooks);
  // 用 Orchestrator 包裹：复杂任务先调 Brain 规划，简单任务直通
  const orchestrator = new Orchestrator(loop);
  const team = new TeamRunner({ provider, memory, rag });
  const scheduler = new Scheduler(() => deps.provider, memory, rag);
  // P4 BUG-FIX: 让调度器走完整 AgentLoop（带工具），定时任务才能真正执行
  scheduler.setLoop(orchestrator);
  scheduler.start();

  deps.loop = orchestrator as any;  // Orchestrator 兼容 AgentLoop.run() 签名
  deps.team = team;
  deps.scheduler = scheduler;

  // ── Tier 4: 能力回归测试 - 建立基线 ──
  try {
    const { setupDefaultCapabilityTests, runBaseline } = await import('./self-improve');
    setupDefaultCapabilityTests({
      toolsAvailable: () => registry.list().length > 0,
      sessionsFileOk: () => { try { fs.readFileSync(path.join(CONFIG.DATA_DIR, 'memory', 'sessions.json')); return true; } catch { return false; } },
      skillsLoaded: () => { try { return getSkills().length > 0; } catch { return false; } },
      memoryOk: () => memory instanceof MemoryManager,
      configOk: () => { try { return !!CONFIG; } catch { return false; } },
    });
    await runBaseline();
    console.log('[Engine] Tier 4: 能力基线已建立');
  } catch(e: any) { console.log('[Engine] Tier 4 baseline failed:', e.message); }

  console.log('[Engine] Booted (Tools/RAG/Scheduler ready)');
  console.log('[Engine] Embedding/RAG provider:', provider.name, '| Chat uses LLM Router (follows UI model selection)');

  // ── 方案二：跨会话恢复 — 启动时展示上次会话概要 ──
  try {
    const { buildResumeContext } = await import('./evolution');
    const resume = buildResumeContext();
    if (resume.recentSessions.length) {
      console.log('[Resume] 上次会话:', resume.recentSessions[0]?.date, resume.recentSessions[0]?.time, '|', resume.recentSessions[0]?.domain);
      console.log('[Resume] 活跃领域:', resume.activeDomains.join(', '));
    }
    if (resume.pendingTasks.length) {
      console.log('[Resume] ⚠️ 待处理:', resume.pendingTasks.join('; '));
    }
    deps._resumeContext = resume;  // 暂存供后续使用
  } catch(e: any) { console.log('[Resume] 启动恢复失败:', e.message); }

  return deps;
}

// ── Gateway 单一入口 ──
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

// ── 可观测数据持久化（重启不丢 Metrics/Logs） ──
async function persistObservability(m: any, l: any) {
  try {
    const fs = await import('fs/promises');
    const data = {
      metrics: m.snapshot(),
      logs: (l.all?.() || []).slice(-500),  // 保留最近 500 条日志
      savedAt: Date.now(),
    };
    await fs.writeFile(path.join(CONFIG.DATA_DIR, 'observability.json'), JSON.stringify(data), 'utf-8');
  } catch { /* 非关键 */ }
}

// ── 主入口 ──
async function main() {
  const HERE = path.dirname(fileURLToPath(import.meta.url));
  const PROJECT_ROOT = path.resolve(HERE, '../..');

  // 1. 启动引擎
  const deps = await bootEngine();

  // 2. 启动 Gateway（单一入口）
  //    beforeRoutes 注入控制台专属路由（Dashboard / Observability / Agent 控制）
  //    Gateway 自带：全部 REST API、静态文件（Web UI）、WebSocket（chat/team/job）、模型切换

  // 控制台运行时：轻量适配器（2026-08-13 架构收敛 R2）
  // 替代演示层 AgentRuntime：AgentController 通过 ControllableRuntime 结构化接口调用，
  // 此处直接对接生产 AgentLoop 与 Workflow Engine，功能等价且不再实例化演示层组件
  // （agent/brain、agent-loop、multiagent 等不再被生产路径拖入）。

  // Workflow Engine：常驻后台任务引擎（队列 + 调度 + Worker）
  // 提前到 ctrlRuntime 之前创建（ctrlRuntime 的 getState/startWorkflowEngine 闭包引用它）
  const wfEngine = createWorkflowEngine({
    run: async (goal: string) => {
      return deps.loop.run({ userInput: goal, sessionId: `wf-${Date.now()}` });
    }
  });
  wfEngine.start();
  console.log('[Engine] Workflow Engine: started (pollMs=1000, concurrency=2)');

  const ctrlRuntime = {
    async run(goal: string): Promise<any> {
      return deps.loop.run({ userInput: goal, sessionId: `ctrl-${Date.now().toString(36)}` });
    },
    isBooted: () => true,
    getState: () => ({ mode: 'unified', engine: 'core/agentLoop', workflow: wfEngine ? (wfEngine.isRunning() ? 'running' : 'stopped') : 'pending' }),
    startWorkflowEngine: (opts?: any) => {
      wfEngine.start(); // WorkflowEngine.start() 幂等（内部 started 守卫）
      return wfEngine;
    },
    stopWorkflowEngine: async () => {
      console.log('[Engine] Workflow stop requested via control plane (engine lifecycle owned by unified boot)');
    },
  };

  // P0-1 FIX: 可观测性模块必须在恢复块之前加载，避免 TDZ ReferenceError
  const { logger: v3logger, metrics: v3metrics, tracer: v3tracer } = await import('./observability');

  // 从磁盘恢复认知记忆（重启不丢经历/知识/技能）
  try {
    const cogPath = path.join(CONFIG.DATA_DIR, 'cognitive.json');
    const { readFile } = await import('fs/promises');
    const raw = await readFile(cogPath, 'utf-8');
    const data = JSON.parse(raw);
    cognitiveMemory.load(data);
    const st = cognitiveMemory.stats();
    console.log(`[Engine] Cognitive memory restored: ${st.episodic.total} episodes, ${st.semantic.total} rules, ${st.learning.skills} skills`);
  } catch (e: any) { console.error('[Engine] Cognitive memory restore failed:', e?.message ?? e); }

  // 从磁盘恢复可观测数据（重启不丢 Metrics / Logs）
  try {
    const obsPath = path.join(CONFIG.DATA_DIR, 'observability.json');
    const { readFile } = await import('fs/promises');
    const raw = await readFile(obsPath, 'utf-8');
    const data = JSON.parse(raw);
    if (data.metrics) Object.entries(data.metrics).forEach(([k, v]: [string, any]) => {
      v3metrics.set(k, v.value);
    });
    if (data.logs) data.logs.forEach((l: any) => v3logger.info(l.component, l.message, l.data));
    console.log(`[Engine] Observability restored: ${Object.keys(data.metrics || {}).length} metrics, ${(data.logs || []).length} logs`);
  } catch (e: any) { console.error('[Engine] Observability restore failed:', e?.message ?? e); }

  // ── V5.0 Step 2 + Step 4：Autonomy Engine + Learning Engine ──
  // Autonomy：持续监控 HARNESS 自身生态（进程存活、磁盘空间、文件变更）
  // Learning：任务完成后自动蒸馏经验→知识→技能
  // P3: 注入技能管理器，激活"成功任务→蒸馏→注册→可调用"闭环
  try {
    const { addSkill } = await import('./skills/loader');
    learning.setSkillManager({ install: (skill: any) => addSkill({ name: skill.name, description: skill.description }) });
  } catch (e: any) { console.warn('[Engine] Skill manager injection skipped:', e?.message ?? e); }
  // P3: 注册核心实战技能（公众号/航海/邮件/博客/文档/图片）
  try {
    const { registerCoreSkills } = await import('./tools/registerCoreSkills');
    registerCoreSkills();
  } catch { /* 核心技能注册失败不影响 */ }
  learning.start();
  console.log('[Engine] Learning Engine: started (auto-distill every 2h)');

  autonomy.initialize({
    watchPaths: [
      path.join(CONFIG.DATA_DIR),          // 数据目录
      path.join(PROJECT_ROOT, 'server'),   // 服务端代码
    ],
    watchDrives: ['C:', 'D:'],
    watchProcesses: [
      'node.exe',      // DaShaAgent 自身（自检）
      'httpd.exe',     // WampServer Apache（YOUR_SITE 依赖）
    ],
  });
  autonomy.start(300000); // 每 5 分钟扫描一次
  console.log('[Engine] Autonomy Engine: monitoring (filesystem + disk + processes, interval=5min)');

  // ── 自进化数据源：把全部业务技能注册进 Skill Registry（指标追踪）──
  // runtime 工具已由 AgentLoop 的 recordSkillCall 自动登记（get_time/http_request/fs_list 等）；
  // 业务技能（skill_*，如 skill_offline_office）此前不在追踪内 → 成功率/延迟/弱技能报表覆盖不到真实技能。
  // 此处启动时全量注册：id 用与工具注册一致的公式（'skill_'+slugify(name)），保证 recordSkillCall(tc.name)
  // 的调用指标能正确累加到对应技能上。registerSkill 幂等（已存在只更新元数据、保留累计指标），重复启动安全。
  try {
    const { registerSkill } = await import('./evolution');
    let registered = 0;
    for (const s of getSkills()) {
      const id = 'skill_' + s.name.trim().toLowerCase().replace(/[^\w]+/g, '_');
      registerSkill({
        id,
        name: s.name,
        version: '1.0',
        description: (s.description || s.name).slice(0, 200),
        capabilities: s.trigger ? s.trigger.split(/[;；,，、\n]/).map((t: string) => t.trim()).filter(Boolean).slice(0, 8) : [],
        createdBy: 'builtin',
      });
      registered++;
    }
    console.log(`[Evolution] 业务技能已全量注册进 Skill Registry: ${registered} 个`);
  } catch (e: any) { console.warn('[Evolution] 业务技能注册失败:', e?.message ?? e); }

  // ── 自进化闭环：定期消费能力缺口 → Skill Factory 自动造技能（闭环修复）──
  // recordGap 已在生产 AgentLoop 采集（未知工具=缺口）；此处为消费者端：
  // 启动即跑一次 + 每 6 小时检查 gaps.jsonl，对高频未解决缺口自动生成技能骨架并产出进化报告。
  try {
    const { autoFactory, saveEvolutionReport } = await import('./evolution');
    const runEvolutionFactory = () => {
      try {
        const r = autoFactory();
        if (r.created.length) {
          console.log(`[Evolution] Skill Factory 补齐 ${r.created.length} 个能力缺口: ${r.created.join(', ')}`);
        }
        saveEvolutionReport();
      } catch (e: any) { console.warn('[Evolution] autoFactory 周期失败:', e?.message ?? e); }
    };
    runEvolutionFactory();                      // 启动即跑一次（检查存量缺口）
    setInterval(runEvolutionFactory, 6 * 3600 * 1000);  // 每 6h 一次
    console.log('[Engine] Evolution Skill Factory: 已接线（启动 + 每 6h 消费能力缺口）');
  } catch (e: any) { console.warn('[Engine] Evolution factory 启动失败:', e?.message ?? e); }

  // ── P2-1: Heartbeat 主动交互引擎 ──
  heartbeat.start();
  registerHeartbeatSelfHeal(); // 廉价版：本地巡检 + 安全自愈，不调 LLM
  console.log('[Engine] Heartbeat: started (interval=30min, reads data/HEARTBEAT.md)');

  // 控制器
  const { AgentController: AC } = await import('./api/agent.controller');
  const ctrl = new AC(ctrlRuntime, {
    memory: undefined,
    agents: () => [{ id: 'agent', name: 'DaShaAgent', role: 'autonomous' }],
    skills: () => getSkills().map((s: any) => ({ name: s.name ?? s })),
    cognitive: () => cognitiveMemory,
    engine: () => wfEngine,
  });


  async function readBody(req: http.IncomingMessage): Promise<string> {
    return new Promise((resolve) => {
      let body = '';
      req.on('data', (chunk: Buffer) => (body += chunk.toString()));
      req.on('end', () => resolve(body));
    });
  }

  // MCP 事件总线（供 Dashboard 监控面板使用）
  try {
    const { agentEventBus } = await import('./websocket');
    agentEventBus.bridgeKernelEvents();
  } catch { /* 非关键 */ }

  const DASH_DIR = path.join(PROJECT_ROOT, 'dashboard', 'dist');
  const hasDash = fs.existsSync(path.join(DASH_DIR, 'index.html'));

  const port = Number(process.env.AH_CONTROL_PORT || 3001);
  // 控制台路由（2026-08-13 R7：从本文件提取至 api/controlRoutes.ts，行为等价）
  const { createControlRoutes } = await import('./api/controlRoutes');
  const controlRoutes = createControlRoutes({
    ctrl,
    metrics: v3metrics,
    logger: v3logger,
    tracer: v3tracer,
    dashDir: DASH_DIR,
    hasDash,
  });

  // ── 技能市场路由（2026-08-15 生态扩展）──
  // 自托管注册中心：列表/发布/安装/卸载/评分 + 市场页静态托管。
  // 组装 beforeRoutes：控制台优先，市场路由兜底（路径空间互不冲突）。
  const { createMarketplaceRoutes } = await import('./api/marketplaceRoutes');
  const { initMarketplace } = await import('./skills/marketplace/registry');
  initMarketplace(); // 确保 data/marketplace/{packages,registry.json} 就绪
  const marketplaceRoutes = createMarketplaceRoutes({
    webDir: join(PROJECT_ROOT, 'web'),
    token: process.env.AH_MARKETPLACE_TOKEN,
  });
  const beforeRoutes = (req: any, res: any): boolean =>
    controlRoutes(req, res) || marketplaceRoutes(req, res);

  const { startGateway } = await import('./gateway/web');
  const server = startGateway(port, deps, {
    beforeRoutes,
  });

  console.log(`
============================================================
  DaShaAgent Unified Server
  http://127.0.0.1:${port}

  Chat   →  Chat tab (AgentLoop + all tools + model switch)
  API    →  /api/health /api/sessions /api/tools …
  WS     →  ws://127.0.0.1:${port}
${hasDash ? '  Dash   →  http://127.0.0.1:' + port + '/dashboard' : ''}
============================================================
`);

  // ── 验证门：能力回归（仅 AH_VERIFY_CAPABILITY=1 时由 git 验证门触发）──
  // 在【已完整启动】的服务器内运行 regressionGuard 的运行时能力测试
  // （工具注册表 / 记忆系统 / 技能加载 / 会话持久化 / 配置有效），
  // 输出 CAPABILITY_RESULT 并退出。git 验证门据此判断核心能力是否退化，
  // 不过关则拒绝提交自进化改动。正常启动（无此环境变量）时完全跳过，行为不变。
  if (process.env.AH_VERIFY_CAPABILITY === '1') {
    try {
      const { runRegressionCheck, formatRegressionSummary } = await import('./self-improve');
      const results = await runRegressionCheck();
      const ok = results.every((r) => r.after); // 任一核心能力失败即视为不通过
      console.log('CAPABILITY_RESULT ' + JSON.stringify({ ok, results }));
      if (!ok) console.error('\n' + formatRegressionSummary(results));
      process.exit(ok ? 0 : 1);
    } catch (e: any) {
      console.error('CAPABILITY_RESULT ' + JSON.stringify({ ok: false, error: e?.message }));
      process.exit(1);
    }
  }

  // P2-1: Graceful shutdown — 保存状态后退出
  const shutdown = async (signal: string) => {
    console.log(`\n[Shutdown] Received ${signal}, shutting down gracefully...`);
    try {
      // 停止后台引擎
      heartbeat.stop();
      // 触发保存（通过 append + auto-save 机制）
      const allSessions = sessions.list();
      console.log(`[Shutdown] Saving ${allSessions.length} sessions...`);
      // 保存认知记忆
      const cogPath = path.join(CONFIG.DATA_DIR, 'cognitive.json');
      const { writeFile } = await import('fs/promises');
      await writeFile(cogPath, JSON.stringify(cognitiveMemory.dump(), null, 2), 'utf-8');
      console.log('[Shutdown] Cognitive memory saved');
    } catch (e: any) { console.error('[Shutdown] Save error:', e?.message); }
    server.close(() => {
      console.log('[Shutdown] Server closed');
      process.exit(0);
    });
    // 5秒超时强制退出
    setTimeout(() => { console.log('[Shutdown] Force exit'); process.exit(0); }, 5000);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch(e => {
  console.error('[DaShaAgent] Failed to start:', e);
  process.exit(1);
});
