// llm/router.ts
// V3 Phase 1 - Step 3 七、LLM Router（核心）
// Agent 的模型调度中心：
//
//   Agent → Brain → LLM Router → GPT / Claude / Gemini / Local → Response
//
// 计划书契约：register / get / chat(provider, messages) + `llm` 单例。
// 另附四个工程化补充（list / has / getDefault / chatDefault / ready / statusOf），
// 用于 §九「连接 Config」与 §十 启动横幅的 Available Models 展示。

import type { LLMProvider, LLMResponse } from './provider';
import type { ChatMessage } from '../core/types';
import { OpenAIProvider } from './openai';
import { ClaudeProvider } from './claude';
import { GeminiProvider } from './gemini';
import { LocalProvider } from './local';
import { AgnesProvider } from './agnes';
import { config } from '../config';
import { cost, metrics } from '../observability';

export class LLMRouter {
  private providers: Map<string, LLMProvider> = new Map();

  constructor() {
    this.register(new OpenAIProvider());
    this.register(new ClaudeProvider());
    this.register(new GeminiProvider());
    this.register(new LocalProvider());
    this.register(new AgnesProvider());
  }

  register(provider: LLMProvider): void {
    this.providers.set(provider.name, provider);
  }

  get(name: string): LLMProvider {
    const provider = this.providers.get(name);
    if (!provider) {
      throw new Error(`LLM not found ${name}`);
    }
    return provider;
  }

  async chat(provider: string, messages: ChatMessage[]): Promise<LLMResponse> {
    const start = Date.now();
    metrics.increment(`llm.${provider}.calls`);
    try {
      const res = await this.get(provider).chat(messages);
      const latency = Date.now() - start;
      metrics.increment(`llm.${provider}.tokens`, res.tokens ?? 0);
      cost.record({
        provider,
        model: res.model ?? provider,
        tokens: res.tokens ?? 0,
        latencyMs: latency,
      });
      return res;
    } catch (e: any) {
      metrics.increment(`llm.${provider}.errors`);
      // ── P3: 多模型故障切换 ──
      // 主 provider 失败时，按 fallback 顺序自动尝试备用模型，而不是直接抛错。
      // 只有所有 fallback 都失败才抛出原始错误。
      const fallbackChain = this.fallbackChain(provider);
      for (const alt of fallbackChain) {
        if (alt === provider) continue;
        try {
          const altRes = await this.get(alt).chat(messages);
          const latency = Date.now() - start;
          metrics.increment(`llm.${alt}.calls`);
          metrics.increment(`llm.${alt}.tokens`, altRes.tokens ?? 0);
          metrics.increment('llm.failover.count');
          console.warn(`[LLM Router] ${provider} 失败 → 自动切换到 ${alt} (failover)`);
          cost.record({ provider: alt, model: altRes.model ?? alt, tokens: altRes.tokens ?? 0, latencyMs: latency });
          return { ...altRes, model: altRes.model ?? alt };
        } catch {
          metrics.increment(`llm.${alt}.errors`);
          // 继续尝试下一个
        }
      }
      throw e;
    }
  }

  /** P3: 备用 provider 链（按可用性偏好排序） */
  private fallbackChain(main: string): string[] {
    // 若主是 agnes → 备用：openai → local → claude → gemini
    const chain: string[] = ['agnes', 'openai', 'local', 'claude', 'gemini'];
    // 把 main 放到最前，其余按默认优先级
    const withoutMain = chain.filter((p) => p !== main);
    return [main, ...withoutMain];
  }

  // --------------------------------------------------------------------
  // V3 Phase 2 - Step 1 八、升级 LLM Router：自动选择模型
  // --------------------------------------------------------------------

  /** 按任务特征挑选 provider（计划书 §八 的规则表）
   *  优先级（2026-08-13 明确）：
   *   1. 显式配置的 LLM provider（config 非空且非 openai）→ 直接用配置，任务特征不参与
   *   2. 未配置或配置为 openai → 按任务特征路由（代码→openai / 超长→claude / 隐私→local）
   *   3. 兜底 → 配置或 openai
   */
  select(task: string): string {
    const cfgProvider = config.getLLM().provider;
    // 规则 1：配置优先（非 openai 即视为用户显式指定）
    if (cfgProvider && cfgProvider !== 'openai') return cfgProvider;

    // 规则 2：任务特征路由（仅当未显式指定其他 provider 时生效）
    if (task.includes('代码')) return 'openai';
    if (task.length > 5000) return 'claude';
    if (task.includes('隐私')) return 'local';

    // 规则 3：兜底
    return cfgProvider || 'openai';
  }

  /** 智能对话：先 select 再 chat */
  async smartChat(task: string, messages: ChatMessage[]): Promise<LLMResponse> {
    const provider = this.select(task);

    return this.chat(provider, messages);
  }

  /** §三 流式：provider 未实现 stream 时降级为整段 yield */
  async *stream(provider: string, messages: ChatMessage[]): AsyncGenerator<string> {
    const p = this.get(provider);
    if (p.stream) {
      yield* p.stream(messages);
      return;
    }
    const res = await p.chat(messages);
    yield res.content;
  }

  // --------------------------------------------------------------------
  // 工程化补充
  // --------------------------------------------------------------------

  /** 已注册的 provider 名列表（注册顺序） */
  list(): string[] {
    return [...this.providers.keys()];
  }

  has(name: string): boolean {
    return this.providers.has(name);
  }

  /** §九 连接 Config：默认 provider 取自 SystemConfig.llm.provider */
  getDefault(): LLMProvider {
    return this.get(config.getLLM().provider);
  }

  /** 用配置指定的默认模型对话，Agent / Brain 的常用入口 */
  async chatDefault(messages: ChatMessage[]): Promise<LLMResponse> {
    return this.getDefault().chat(messages);
  }

  /** 启动期并行探测（本地模型是否在跑等），失败不抛，仅影响状态展示 */
  async ready(): Promise<void> {
    await Promise.all(
      [...this.providers.values()].map(async (p) => {
        try {
          if (p.probe) await p.probe();
        } catch {
          /* 探测失败不影响启动 */
        }
      })
    );
  }

  /** 单个 provider 的一行状态描述 */
  statusOf(name: string): string {
    const p = this.providers.get(name);
    if (!p) return 'not registered';
    return p.status ? p.status() : 'registered';
  }
}

export const llm = new LLMRouter();
