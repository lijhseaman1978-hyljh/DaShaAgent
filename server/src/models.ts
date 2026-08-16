// 模型管理与运行时配置：负责配置持久化、Ollama 模型发现、模型分组列表、按模型解析 Provider。
import fs from 'node:fs';
import path from 'node:path';
import { CONFIG, ensureDir } from './config';
import type { Provider } from './core/types';
import { createProvider, type ProviderSpec } from './llm/provider';

export interface CustomModel {
  id: string;
  label: string;
  type: 'ollama' | 'cloud' | 'local';
  base?: string;
  model: string;
  key?: string;
  embed?: string;
}

export interface HarnessConfig {
  provider: 'custom' | 'ollama' | 'cloud';
  temperature: number;
  activeModelId?: string;
  ollama: { base: string; model: string; embed: string };
  cloud: { base: string; key: string; model: string };
  customModels: CustomModel[];
}

export interface ModelItem { id: string; label: string; }
/** 一个 Provider 及其发现的模型（如 Ollama / LM Studio / Agnes / DeepSeek） */
export interface ProviderGroup { id: string; label: string; models: ModelItem[]; }
/** 根分组（本地发现 / 云端发现）→ 其下按 Provider 再分 */
export interface ModelGroup { id: string; label: string; providers: ProviderGroup[]; }

const CONFIG_FILE = path.join(CONFIG.DATA_DIR, 'config.json');

function defaultConfig(): HarnessConfig {
  return {
    provider: (CONFIG.PROVIDER as any) || 'ollama',
    temperature: 0.7,
    activeModelId: undefined,
    ollama: { base: CONFIG.OLLAMA_BASE, model: CONFIG.OLLAMA_MODEL, embed: CONFIG.OLLAMA_EMBED },
    cloud: { base: CONFIG.CLOUD_BASE, key: CONFIG.CLOUD_KEY, model: CONFIG.CLOUD_MODEL },
    customModels: [],
  };
}

export class ModelManager {
  private cfg: HarnessConfig;
  private providerCache = new Map<string, Provider>();
  private ollamaCache: { at: number; models: string[] } | null = null;
  private cloudCache: { at: number; models: Array<{ id: string; label: string }> } | null = null;
  /** 统一模型发现缓存：key = kind|base|hasKey */
  private discoverCache = new Map<string, { at: number; models: ModelItem[] }>();

  constructor() {
    this.cfg = this.load();
  }

  private load(): HarnessConfig {
    try {
      const raw = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
      const d = defaultConfig();
      const cfg: HarnessConfig = {
        ...d,
        ...raw,
        provider: (raw.provider === 'custom' ? 'custom' : (raw.provider === 'cloud' ? 'cloud' : 'ollama')) as HarnessConfig['provider'],
        ollama: { ...d.ollama, ...(raw.ollama || {}) },
        cloud: { ...d.cloud, ...(raw.cloud || {}) },
        customModels: Array.isArray(raw.customModels) ? [...raw.customModels] : [],
      };
      // ── 迁移：旧 ollama 顶层配置并入 customModels（幂等，已有同 base+model 条目则跳过）──
      if (cfg.ollama?.model && !cfg.customModels.some(x => x.type === 'ollama' && x.model === cfg.ollama.model && (x.base || '') === cfg.ollama.base)) {
        cfg.customModels.unshift({ id: 'custom_ollama_default', label: 'Ollama · ' + cfg.ollama.model, type: 'ollama', model: cfg.ollama.model, base: cfg.ollama.base, embed: cfg.ollama.embed });
      }
      // ── 迁移：旧 cloud 顶层配置并入 customModels（有 key 才并入）──
      if (cfg.cloud?.key && cfg.cloud.model && !cfg.customModels.some(x => x.type === 'cloud' && x.model === cfg.cloud.model && (x.base || '') === cfg.cloud.base)) {
        cfg.customModels.unshift({ id: 'custom_cloud_default', label: 'Cloud · ' + cfg.cloud.model, type: 'cloud', model: cfg.cloud.model, base: cfg.cloud.base, key: cfg.cloud.key });
      }
      return cfg;
    } catch {
      return defaultConfig();
    }
  }

  save() {
    ensureDir(CONFIG.DATA_DIR);
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(this.cfg, null, 2), 'utf8');
  }

  getConfig(): HarnessConfig { return this.cfg; }

  updateConfig(patch: Partial<HarnessConfig>) {
    this.cfg = { ...this.cfg, ...patch };
    this.save();
    // 配置变更后清空默认 Provider 缓存，下次解析重建
    this.providerCache.clear();
  }

  // 仅更新嵌套字段的便捷方法
  patchOllama(p: Partial<HarnessConfig['ollama']>) {
    this.cfg.ollama = { ...this.cfg.ollama, ...p };
    this.save(); this.providerCache.clear();
  }
  patchCloud(p: Partial<HarnessConfig['cloud']>) {
    this.cfg.cloud = { ...this.cfg.cloud, ...p };
    this.save(); this.providerCache.clear();
  }
  setTemperature(t: number) { this.cfg.temperature = t; this.save(); }
  setActiveModel(id: string | undefined) { this.cfg.activeModelId = id; this.save(); }

  addCustomModel(m: CustomModel) {
    this.cfg.customModels = this.cfg.customModels.filter(x => x.id !== m.id);
    this.cfg.customModels.push(m);
    this.save();
  }
  removeCustomModel(id: string) {
    this.cfg.customModels = this.cfg.customModels.filter(x => x.id !== id);
    this.save();
  }
  updateCustomModel(id: string, patch: Partial<CustomModel>): boolean {
    const idx = this.cfg.customModels.findIndex(x => x.id === id);
    if (idx === -1) return false;
    this.cfg.customModels[idx] = { ...this.cfg.customModels[idx], ...patch, id };
    this.save();
    return true;
  }

  // 发现 Ollama 可用模型（带 60s 缓存）
  async discoverOllama(): Promise<string[]> {
    const now = Date.now();
    if (this.ollamaCache && now - this.ollamaCache.at < 60_000) return this.ollamaCache.models;
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 4000);
      const r = await fetch(this.cfg.ollama.base.replace(/\/$/, '') + '/api/tags', { signal: ctrl.signal });
      clearTimeout(t);
      if (!r.ok) throw new Error('bad');
      const j = await r.json();
      const names: string[] = (j.models || []).map((m: any) => m.name).filter(Boolean);
      this.ollamaCache = { at: now, models: names };
      return names;
    } catch {
      this.ollamaCache = { at: now, models: [] };
      return [];
    }
  }

  // 发现云端可用模型：遍历每个带 key 的 cloud 来源（顶层 cloud + 各 cloud 自定义条目），
  // 各自调 OpenAI 兼容 /v1/models 实时拉取，合并去重。返回 { id, label, sourceId }。
  // id 格式：custom:<customId>::<modelName>（来源为自定义条目）/ cloud:<modelName>（来源为顶层 cloud）
  async discoverCloud(): Promise<Array<{ id: string; label: string }>> {
    const now = Date.now();
    if (this.cloudCache && now - this.cloudCache.at < 60_000) return this.cloudCache.models;
    const out: Array<{ id: string; label: string }> = [];
    const seen = new Set<string>();
    // 顶层 cloud（key 有效且非占位符）
    if (this.cfg.cloud?.key && this.cfg.cloud.key !== '***') {
      try {
        const names = await this._fetchModelNames(this.cfg.cloud.base, this.cfg.cloud.key);
        for (const n of names) {
          if (!seen.has(n)) { seen.add(n); out.push({ id: 'cloud:' + n, label: n }); }
        }
      } catch { /* 跳过不可用来源 */ }
    }
    // 各 cloud 自定义条目
    for (const c of this.cfg.customModels) {
      if (c.type !== 'cloud' || !c.key || c.key === '***' || !c.base) continue;
      try {
        const names = await this._fetchModelNames(c.base, c.key);
        for (const n of names) {
          const key = c.id + '::' + n;
          if (!seen.has(key)) { seen.add(key); out.push({ id: 'custom:' + c.id + '::' + n, label: n }); }
        }
      } catch { /* 跳过不可用来源 */ }
    }
    this.cloudCache = { at: now, models: out };
    return out;
  }

  private async _fetchModelNames(base: string, key: string): Promise<string[]> {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    try {
      const r = await fetch(base.replace(/\/$/, '') + '/models', {
        headers: { Authorization: 'Bearer ' + key },
        signal: ctrl.signal,
      });
      if (!r.ok) throw new Error('bad');
      const j = await r.json();
      const arr = Array.isArray(j.data) ? j.data : Array.isArray(j.models) ? j.models : [];
      return arr.map((mm: any) => mm.id || mm.name).filter(Boolean);
    } finally {
      clearTimeout(t);
    }
  }

  /** 提取 base URL 的 host 作为 provider 显示名（自动化，不硬编码） */
  private _hostOf(base: string): string {
    try { return new URL(base).host; } catch { return base.replace(/^https?:\/\//, '').replace(/\/$/, ''); }
  }

  /**
   * 统一模型发现：ollama 协议 → /api/tags；OpenAI 兼容 → /v1/models。
   * prefix 决定模型 id 前缀：顶层 ollama='ollama:' / 顶层 cloud='cloud:' / 自定义条目='custom:<id>::'
   */
  private async _discoverModels(base: string, kind: 'ollama' | 'openai', key: string | undefined, prefix: string): Promise<ModelItem[]> {
    const b = base.replace(/\/$/, '');
    const ck = kind + '|' + b + '|' + (key ? 'k' : 'n');
    const now = Date.now();
    const hit = this.discoverCache.get(ck);
    if (hit && now - hit.at < 600_000) return hit.models;
    let items: ModelItem[] = [];
    try {
      const headers: Record<string, string> = {
        // 浏览器 UA：OpenCode Zen 等网关用 Cloudflare 拦截非浏览器请求（无 UA 直接 403 error 1010）
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
      };
      if (key) headers.Authorization = 'Bearer ' + key;
      const url = kind === 'ollama' ? b + '/api/tags' : b + '/models';
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 5000);
      const r = await fetch(url, { headers, signal: ctrl.signal });
      clearTimeout(t);
      if (!r.ok) throw new Error('bad');
      const j = await r.json();
      if (kind === 'ollama') {
        items = (j.models || []).map((mm: any) => ({ id: prefix + mm.name, label: mm.name })).filter((x: any) => x.label);
      } else {
        const arr = Array.isArray(j.data) ? j.data : Array.isArray(j.models) ? j.models : [];
        items = arr.map((mm: any) => ({ id: prefix + (mm.id || mm.name), label: mm.id || mm.name })).filter((x: any) => x.label);
      }
      this.discoverCache.set(ck, { at: now, models: items });
    } catch {
      // 失败不缓存空结果：下次请求立即重试（避免一次 403/超时导致 60 秒内模型"消失"）
      this.discoverCache.delete(ck);
    }
    return items;
  }

  /**
   * 返回模型树：根 = [本地发现, 云端发现]，其下按 Provider 分组（provider 由配置动态聚合，不硬编码）。
   * 本地 provider：顶层 ollama + customModels 中 type=ollama/local；云端 provider：顶层 cloud + customModels 中 type=cloud。
   * 同一 base URL 视为同一 provider，自动去重合并。
   */
  async getModels(): Promise<ModelGroup[]> {
    const localProvs = new Map<string, { id: string; label: string; base: string; kind: 'ollama' | 'openai'; prefix: string }>();
    const cloudProvs = new Map<string, { id: string; label: string; base: string; key: string; prefix: string }>();

    // ── 收集本地 provider（顶层 ollama + 自定义 ollama/local 条目）──
    if (this.cfg.ollama?.base) {
      const base = this.cfg.ollama.base.replace(/\/$/, '');
      localProvs.set('ollama:' + base, { id: 'ollama:' + base, label: 'Ollama', base, kind: 'ollama', prefix: 'ollama:' });
    }
    for (const c of this.cfg.customModels) {
      if (!c.base) continue;
      const base = c.base.replace(/\/$/, '');
      if (c.type === 'ollama' || c.type === 'local') {
        const kind = c.type === 'ollama' ? 'ollama' : 'openai';
        const pkey = kind + ':' + base;
        if (!localProvs.has(pkey)) {
          localProvs.set(pkey, { id: pkey, label: this._hostOf(base) || c.label || c.model, base, kind, prefix: 'custom:' + c.id + '::' });
        }
      }
    }
    // ── 收集云端 provider（顶层 cloud + 自定义 cloud 条目，key 有效才纳入）──
    for (const c of this.cfg.customModels) {
      if (c.type === 'cloud' && c.base && c.key && c.key !== '***') {
        const base = c.base.replace(/\/$/, '');
        const pkey = 'cloud:' + base;
        if (!cloudProvs.has(pkey)) {
          cloudProvs.set(pkey, { id: pkey, label: this._hostOf(base) || c.label || c.model, base, key: c.key, prefix: 'custom:' + c.id + '::' });
        }
      }
    }
    if (this.cfg.cloud?.base && this.cfg.cloud.key && this.cfg.cloud.key !== '***') {
      const base = this.cfg.cloud.base.replace(/\/$/, '');
      const pkey = 'cloud:' + base;
      if (!cloudProvs.has(pkey)) {
        cloudProvs.set(pkey, { id: pkey, label: this._hostOf(base) || 'Cloud', base, key: this.cfg.cloud.key, prefix: 'cloud:' });
      }
    }

    const groups: ModelGroup[] = [];

    // ── 本地发现：按 provider 分组 ──
    const localProviders: ProviderGroup[] = [];
    for (const p of localProvs.values()) {
      const discovered = await this._discoverModels(p.base, p.kind, undefined, p.prefix);
      const models = [...discovered];
      // 补充该 provider 下已保存的自定义模型（label 去重，避免与发现结果重复）
      for (const c of this.cfg.customModels) {
        if ((c.base || '').replace(/\/$/, '') === p.base && !models.some(x => x.label === (c.label || c.model))) {
          models.push({ id: c.id, label: c.label || c.model });
        }
      }
      if (models.length) localProviders.push({ id: p.id, label: p.label, models });
    }
    if (localProviders.length) groups.push({ id: 'local', label: '本地发现', providers: localProviders });

    // ── 云端发现：按 provider 分组 ──
    const cloudProviders: ProviderGroup[] = [];
    for (const p of cloudProvs.values()) {
      const discovered = await this._discoverModels(p.base, 'openai', p.key, p.prefix);
      const models = [...discovered];
      for (const c of this.cfg.customModels) {
        if ((c.base || '').replace(/\/$/, '') === p.base && !models.some(x => x.label === (c.label || c.model))) {
          models.push({ id: c.id, label: c.label || c.model });
        }
      }
      if (models.length) cloudProviders.push({ id: p.id, label: p.label, models });
    }
    if (cloudProviders.length) groups.push({ id: 'cloud', label: '云端发现', providers: cloudProviders });

    return groups;
  }

  private specFor(id?: string): { spec: ProviderSpec; temperature: number } | null {
    const cfg = this.cfg;
    const temp = cfg.temperature ?? 0.7;
    if (!id) {
      // provider='custom'：统一走自定义模型列表，默认取第一个（含自动迁移的 ollama/cloud 默认）
      if (cfg.provider === 'custom') {
        const first = cfg.customModels[0];
        if (first) return this.specFromCustom(first, temp);
        return { spec: { type: 'ollama', base: cfg.ollama.base, model: cfg.ollama.model, embed: cfg.ollama.embed, temperature: temp }, temperature: temp };
      }
      // 兼容旧配置：'cloud' 走顶层 cloud，否则走顶层 ollama
      if (cfg.provider === 'cloud' && cfg.cloud.key) {
        return { spec: { type: 'cloud', base: cfg.cloud.base, key: cfg.cloud.key, model: cfg.cloud.model, temperature: temp }, temperature: temp };
      }
      return { spec: { type: 'ollama', base: cfg.ollama.base, model: cfg.ollama.model, embed: cfg.ollama.embed, temperature: temp }, temperature: temp };
    }
    // 云端自动发现的模型：custom:<customId>::<name>（用来源条目的 base/key）
    if (id.startsWith('custom:') && id.includes('::')) {
      const sep = id.indexOf('::');
      const cid = id.slice('custom:'.length, sep);
      const name = id.slice(sep + 2);
      const c = cfg.customModels.find(x => x.id === cid);
      if (c) return { spec: { type: c.type === 'local' ? 'cloud' : c.type, base: c.base || cfg.cloud.base, model: name, key: c.key || cfg.cloud.key, embed: c.type === 'ollama' ? (c.embed || cfg.ollama.embed) : undefined, temperature: temp }, temperature: temp };
    }
    if (id.startsWith('ollama:')) {
      const name = id.slice('ollama:'.length);
      return { spec: { type: 'ollama', base: cfg.ollama.base, model: name, embed: cfg.ollama.embed, temperature: temp }, temperature: temp };
    }
    if (id.startsWith('cloud:')) {
      const name = id.slice('cloud:'.length);
      return { spec: { type: 'cloud', base: cfg.cloud.base, key: cfg.cloud.key, model: name, temperature: temp }, temperature: temp };
    }
    const custom = cfg.customModels.find(c => c.id === id);
    if (custom) return this.specFromCustom(custom, temp);
    return null;
  }

  /** 由单个自定义模型条目解析 ProviderSpec（type 决定协议：ollama→Ollama / cloud|local→OpenAI 兼容） */
  private specFromCustom(custom: CustomModel, temp: number): { spec: ProviderSpec; temperature: number } {
    const cfg = this.cfg;
    const isLocal = custom.type === 'local';
    const isCloud = custom.type === 'cloud';
    return {
      spec: {
        type: isLocal ? 'cloud' : custom.type,
        base: custom.base || (custom.type === 'ollama' ? cfg.ollama.base : cfg.cloud.base),
        model: custom.model,
        key: isCloud ? (custom.key || cfg.cloud.key) : (custom.key || ''),
        embed: custom.type === 'ollama' ? (custom.embed || cfg.ollama.embed) : undefined,
        temperature: temp,
      },
      temperature: temp,
    };
  }

  // 按模型 id 解析出 Provider 实例（带缓存）
  async resolveProvider(modelId?: string): Promise<{ provider: Provider; temperature: number; spec: ProviderSpec }> {
    const resolved = this.specFor(modelId || this.cfg.activeModelId);
    if (!resolved) {
      // 未知 id，回退默认
      const def = this.specFor(undefined)!;
      return { ...def, provider: createProvider(def.spec) };
    }
    const cacheKey = JSON.stringify(resolved.spec);
    let p = this.providerCache.get(cacheKey);
    if (!p) {
      p = createProvider(resolved.spec);
      this.providerCache.set(cacheKey, p);
    }
    return { provider: p, temperature: resolved.temperature, spec: resolved.spec };
  }
}
