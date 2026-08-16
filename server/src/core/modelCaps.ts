// 模型能力探测层。
//
// 背景：WorkBuddy 内核的 Read 工具在遇到图片时，第一件事不是 OCR，而是
// 先问「当前模型支不支持图片」——支持就把图片 base64 直接喂给模型（多模态直读，
// 保真度远高于 OCR）；不支持就明确报错，而不是默默返回一堆乱码让 agent 空转。
//
// harness 原先完全没有"模型能力"这个概念，导致所有格式只能走同一条降级路径。
// 这里补上这一层：Ollama 走 /api/show 真实探测（最准），云端/未知走名字表兜底。

export interface ModelCaps {
  /** 是否支持图片输入（多模态） */
  supportsImages: boolean;
  /** 是否支持原生 function calling */
  supportsTools: boolean;
  /** 探测来源，便于排查 */
  source: 'ollama-api' | 'name-table' | 'default';
  model: string;
}

// ── 视觉模型名特征（覆盖主流开源 + 闭源）────────────────────────────────
const VISION_PATTERNS: RegExp[] = [
  /\bllava\b/i, /bakllava/i, /moondream/i, /minicpm[-_.]?v/i,
  /qwen[\d.]*[-_]?vl/i, /llama[-_.]?3\.?2[-_]?vision/i, /mllama/i,
  /pixtral/i, /internvl/i, /cogvlm/i, /glm[-_.]?4v/i, /yi[-_.]?vl/i,
  /deepseek[-_.]?vl/i, /granite[\d.]*vision/i, /phi[-_.]?[34][-_.]?vision/i,
  /gemma[-_.]?3/i,                       // gemma3 起支持图像
  /gpt[-_.]?4o/i, /gpt[-_.]?4[-_.]?turbo/i, /gpt[-_.]?4[-_.]?vision/i,
  /gpt[-_.]?4\.1/i, /gpt[-_.]?5/i, /\bo[134]\b/i,
  /claude[-_.]?[345]/i, /claude[-_.]?(sonnet|opus|haiku)/i,
  /gemini/i, /step[-_.]?1v/i, /ernie[-_.]?4/i, /grok[-_.]?[2-9]/i,
];

// 明确"纯文本"的模型（即使名字里含数字版本也不要误判为多模态）
const TEXT_ONLY_PATTERNS: RegExp[] = [
  /embed/i, /rerank/i, /nomic/i, /bge[-_.]/i,
];

// 无原生 tool calling 的常见本地模型
const NO_TOOL_PATTERNS: RegExp[] = [
  /^gemma[-_.]?2/i, /^phi[-_.]?2/i, /tinyllama/i, /embed/i,
];

function byName(model: string): ModelCaps {
  const m = model || '';
  const textOnly = TEXT_ONLY_PATTERNS.some((r) => r.test(m));
  return {
    supportsImages: !textOnly && VISION_PATTERNS.some((r) => r.test(m)),
    supportsTools: !NO_TOOL_PATTERNS.some((r) => r.test(m)),
    source: 'name-table',
    model: m,
  };
}

// ── Ollama 真实能力探测：/api/show 的 model_info / families 会显式列出
//    clip / mllama / vision 等投影层，比猜名字准得多 ───────────────────
const ollamaCache = new Map<string, { at: number; caps: ModelCaps }>();
const TTL = 5 * 60_000;

async function probeOllama(base: string, model: string): Promise<ModelCaps> {
  const key = base + '|' + model;
  const hit = ollamaCache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.caps;

  const fallback = byName(model);
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 3000);
    const r = await fetch(base.replace(/\/$/, '') + '/api/show', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: model }),
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!r.ok) throw new Error('show ' + r.status);
    const j: any = await r.json();

    const families: string[] = j?.details?.families || [];
    const famStr = families.join(',').toLowerCase();
    const infoKeys = Object.keys(j?.model_info || {}).join(',').toLowerCase();
    const caps: string[] = (j?.capabilities || []).map((x: any) => String(x).toLowerCase());

    const hasVision =
      caps.includes('vision') ||
      /clip|mllama|vision|siglip|projector/.test(famStr) ||
      /vision|clip|mm_proj/.test(infoKeys);

    const hasTools = caps.includes('tools') ||
      /tool|function/i.test(String(j?.template || '')) ||
      fallback.supportsTools;

    const out: ModelCaps = {
      supportsImages: hasVision || fallback.supportsImages,
      supportsTools: hasTools,
      source: 'ollama-api',
      model,
    };
    ollamaCache.set(key, { at: Date.now(), caps: out });
    return out;
  } catch {
    ollamaCache.set(key, { at: Date.now(), caps: fallback });
    return fallback;
  }
}

// ── 当前活跃模型上下文 ────────────────────────────────────────────────
// 工具执行时需要知道"这一轮用的是哪个模型"。ToolContext 里塞 provider 不够，
// 因为 provider 的 model 字段是 private 且切换模型时 ctx 拿到的可能是旧实例。
// 用一个显式的、由 agentLoop 在每轮 run 开始时设置的轻量上下文，最直接可靠。
let active: { type: string; model: string; base?: string } = {
  type: 'ollama',
  model: '',
};

export function setActiveModel(info: { type?: string; model?: string; base?: string }) {
  active = {
    type: info.type || active.type,
    model: info.model || '',
    base: info.base,
  };
}

export function getActiveModel() {
  return { ...active };
}

/** 解析当前活跃模型的能力。无法确定时返回保守默认（不支持图片，支持工具）。 */
export async function currentModelCaps(): Promise<ModelCaps> {
  const { type, model, base } = active;
  if (!model) {
    return { supportsImages: false, supportsTools: true, source: 'default', model: '' };
  }
  if (type === 'ollama' && base) return probeOllama(base, model);
  return byName(model);
}

/** 供工具层调用的便捷判断。探测失败一律按"不支持"处理，避免把 base64 塞给纯文本模型。 */
export async function modelSupportsImages(): Promise<boolean> {
  try {
    return (await currentModelCaps()).supportsImages;
  } catch {
    return false;
  }
}
