// config/config.ts
// V3 Phase 1 - Step 2 五、Config Manager
// 全局唯一的结构化配置访问点。Runtime / Brain / Memory / Sandbox 都从这里取配置，
// 不再各自去读 process.env。

import { ConfigLoader } from './loader';
import { SystemConfig, LLMConfig, MemoryConfig, SandboxConfig, AgentConfig } from './schema';

export class ConfigManager {
  private config: SystemConfig;

  constructor() {
    this.config = new ConfigLoader().load();
  }

  get(): SystemConfig {
    return this.config;
  }

  getAgent(): AgentConfig {
    return this.config.agent;
  }

  getLLM(): LLMConfig {
    return this.config.llm;
  }

  getMemory(): MemoryConfig {
    return this.config.memory;
  }

  getSandbox(): SandboxConfig {
    return this.config.sandbox;
  }

  /** 环境变量变更后重新装载（测试与热更新用） */
  reload(): SystemConfig {
    this.config = new ConfigLoader().load();
    return this.config;
  }
}

export const config = new ConfigManager();
