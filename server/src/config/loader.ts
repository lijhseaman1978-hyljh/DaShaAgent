// config/loader.ts
// V3 Phase 1 - Step 2 四、Config Loader
// 把「环境变量 + V1/V2 遗留 CONFIG」归一成结构化 SystemConfig。
// 设计原则（棕地合并）：
//   1. 计划书给出的默认值全部保留，作为 env 缺省时的兜底；
//   2. 但不凭空捏造运行现状 —— LLM 段会桥接既有 CONFIG.PROVIDER，
//      让启动横幅打印的是「系统真实在用的模型」，而不是写死的 openai/gpt-5。

import { SystemConfig, LLMConfig } from './schema';
import { env } from './env';
import { CONFIG } from './system';

/** 把 V1 的 AH_PROVIDER（ollama|cloud|mock）映射到 V3 的 LLMConfig */
function bridgeLegacyLLM(): LLMConfig {
  switch (CONFIG.PROVIDER) {
    case 'cloud':
      return { provider: 'openai', model: CONFIG.CLOUD_MODEL };
    case 'mock':
      return { provider: 'local', model: 'mock' };
    case 'agnes':
      return { provider: 'agnes', model: 'deepseek-v4-flash' }; // 2026-08-13: 默认模型改 deepseek-v4-flash
    case 'ollama':
    default:
      return { provider: 'local', model: CONFIG.OLLAMA_MODEL };
  }
}

function resolveLLM(): LLMConfig {
  const bridged = bridgeLegacyLLM();

  // 显式 env 覆盖优先（Step 3 的 LLM Router 会消费同一组变量）
  // Phase 2 - Step 1 §二：DEFAULT_LLM 是计划书使用的名字，作为 LLM_PROVIDER 的别名接受
  const raw = (env.get('LLM_PROVIDER') || env.get('DEFAULT_LLM'))?.trim().toLowerCase();
  const allowed: LLMConfig['provider'][] = ['openai', 'claude', 'gemini', 'local', 'agnes'];
  const provider = allowed.includes(raw as LLMConfig['provider'])
    ? (raw as LLMConfig['provider'])
    : bridged.provider;

  const model = env.str('LLM_MODEL', provider === bridged.provider ? bridged.model : '');

  return { provider, model };
}

function resolveMode(): 'assistant' | 'autonomous' {
  const raw = env.str('AGENT_MODE', 'autonomous').trim().toLowerCase();
  return raw === 'assistant' ? 'assistant' : 'autonomous';
}

function resolveMemoryType(): 'local' | 'vector' {
  const raw = env.str('MEMORY_TYPE', 'local').trim().toLowerCase();
  return raw === 'vector' ? 'vector' : 'local';
}

export class ConfigLoader {
  load(): SystemConfig {
    return {
      agent: {
        name: env.str('AGENT_NAME', 'DaShaAgent'),
        version: '3.0.0',
        mode: resolveMode(),
      },

      llm: resolveLLM(),

      memory: {
        enabled: env.bool('MEMORY_ENABLED', true),
        type: resolveMemoryType(),
      },

      sandbox: {
        enabled: env.bool('SANDBOX_ENABLED', true),
        allowShell: env.bool('SANDBOX_ALLOW_SHELL', false),
        allowNetwork: env.bool('SANDBOX_ALLOW_NETWORK', false),
      },
    };
  }
}
