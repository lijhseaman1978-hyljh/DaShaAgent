import type { ToolDef } from '../core/types';

// ─────────────────────────────────────────────────────────────────────────────
// 阶段6：Schema 参数校验与安全校验层
// 在 registry.execute 调用具体 fn 之前，根据 ToolDef.parameters（JSON Schema 子集）
// 对模型产出的结构化参数做校验，返回【结构化、可纠正】的错误，让模型能在一次重试内
// 自行修正参数，而不是以空参数崩溃后无限重试。
// 对应闭环：LLM 生成符合 Schema 的结构化数据 → Harness 安全/参数校验 → entrypoint 执行。
// ─────────────────────────────────────────────────────────────────────────────

export interface ValidationResult {
  ok: boolean;
  error?: string;
  schemaSummary?: string;
}

const TYPE_CHECK: Record<string, (v: any) => boolean> = {
  string: (v) => typeof v === 'string',
  number: (v) => typeof v === 'number' && !Number.isNaN(v),
  boolean: (v) => typeof v === 'boolean',
  object: (v) => typeof v === 'object' && v !== null && !Array.isArray(v),
  array: (v) => Array.isArray(v),
};

// 把 parameters 压成一行可读摘要，方便模型对齐参数（返回给模型看）
export function schemaSummary(def: ToolDef): string {
  const p = def.parameters;
  if (!p || p.type !== 'object' || !p.properties) return '(无参数)';
  const props = p.properties;
  const req = new Set(p.required || []);
  return Object.keys(props)
    .map((k) => {
      const pp = props[k];
      const tp = pp?.type || 'any';
      const flag = req.has(k) ? '必填' : '可选';
      return `${k}:${tp}(${flag})`;
    })
    .join(', ');
}

// 校验入口：args 为模型产出的结构化参数（应为 object）
export function validateArgs(def: ToolDef, args: any): ValidationResult {
  const sum = schemaSummary(def);
  if (!def.parameters || def.parameters.type !== 'object') return { ok: true, schemaSummary: sum };

  // 1) 参数必须是对象（不允许数组 / 原始类型）
  if (args === null || typeof args !== 'object' || Array.isArray(args)) {
    return {
      ok: false,
      error: `工具「${def.name}」的参数必须是 JSON 对象（键值对），当前收到类型：${args === null ? 'null' : Array.isArray(args) ? 'array' : typeof args}。`,
      schemaSummary: sum,
    };
  }

  // 2) 必填项校验（仅判 undefined / null；空字符串视为已提供，交给工具自身决定是否报错）
  const required = def.parameters.required || [];
  const missing: string[] = [];
  for (const r of required) {
    if (args[r] === undefined || args[r] === null) missing.push(r);
  }
  if (missing.length) {
    return {
      ok: false,
      error: `工具「${def.name}」缺少必填参数：${missing.join('、')}。`,
      schemaSummary: sum,
    };
  }

  // 3) 类型校验（仅校验已声明且已提供的字段；未声明的额外字段容忍，不报错）
  const props = def.parameters.properties || {};
  const typeErrors: string[] = [];
  for (const k of Object.keys(args)) {
    const pp = props[k];
    if (!pp || !pp.type) continue;
    const checker = TYPE_CHECK[pp.type];
    if (checker && !checker(args[k])) {
      const gotType = Array.isArray(args[k]) ? 'array' : typeof args[k];
      typeErrors.push(`${k} 应为 ${pp.type}，收到 ${gotType}`);
    }
    if (pp.enum && Array.isArray(pp.enum) && !pp.enum.includes(args[k])) {
      typeErrors.push(`${k} 取值必须是 [${pp.enum.join(' / ')}] 之一，收到 ${JSON.stringify(args[k])}`);
    }
  }
  if (typeErrors.length) {
    return {
      ok: false,
      error: `工具「${def.name}」参数类型错误：${typeErrors.join('；')}。`,
      schemaSummary: sum,
    };
  }

  return { ok: true, schemaSummary: sum };
}
