// config/schema.ts
// V3 Phase 1 - Step 2 三、配置结构定义
// Agent OS 的结构化配置契约：agent / llm / memory / sandbox（含权限）。

export interface AgentConfig {
  name: string;
  version: string;
  mode: 'assistant' | 'autonomous';
}

export interface LLMConfig {
  provider: 'openai' | 'claude' | 'gemini' | 'local' | 'agnes';
  model: string;
}

export interface MemoryConfig {
  enabled: boolean;
  type: 'local' | 'vector';
}

export interface SandboxConfig {
  enabled: boolean;
  allowShell: boolean;
  allowNetwork: boolean;
}

export interface SystemConfig {
  agent: AgentConfig;
  llm: LLMConfig;
  memory: MemoryConfig;
  sandbox: SandboxConfig;
}
