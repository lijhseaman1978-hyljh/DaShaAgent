// 共享类型定义

export type Role = 'system' | 'user' | 'assistant' | 'tool';

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, any>;
}

export interface ChatMessage {
  role: Role;
  content?: string | null;
  tool_calls?: ToolCall[];
  name?: string; // tool role 时的工具名
  tool_call_id?: string; // tool role 时对应的调用 id（云端补偿）
  /** 模型停止原因：'stop' | 'length'（输出截断）| 'tool_calls' | 其他 */
  finish_reason?: string;
  /**
   * 多模态图片输入：纯 base64 字符串数组（不含 data: 前缀）。
   * 仅在 user 消息上有意义 —— OpenAI 的 tool 消息不接受图片内容块，
   * 所以 fs_read 读到图片时由 agentLoop 转成一条独立 user 消息注入。
   * Ollama 走原生 images 字段，云端走 content parts(image_url)。
   */
  images?: string[];
  /** 与 images 同序的 MIME 类型；缺省按 image/png 处理。 */
  imageMimes?: string[];
}

// 工具定义（JSON Schema 子集）
export interface ToolParameter {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  description?: string;
  enum?: string[];
  items?: ToolParameter;
  properties?: Record<string, ToolParameter>;
  required?: string[];
}

export interface ToolDef {
  name: string;
  description: string;
  parameters: ToolParameter; // 形如 { type:'object', properties:{...}, required:[...] }
}

// 工具执行上下文
export interface ToolContext {
  sessionId: string;
  emit: (activity: ActivityEvent) => void; // 向客户端推送活动
  provider?: any;
}

export interface ActivityEvent {
  type: 'tool_start' | 'tool_end' | 'tool_error' | 'thought' | 'info';
  tool?: string;
  message: string;
  data?: any;
}

// 回调
export interface RunCallbacks {
  onToken?: (text: string) => void;
  onThought?: (text: string) => void;
  onActivity?: (ev: ActivityEvent) => void;
  signal?: AbortSignal;
}

// Provider 接口
export interface ChatOptions {
  messages: ChatMessage[];
  tools?: ToolDef[];
  stream?: boolean;
  onToken?: (t: string) => void;
  onThought?: (t: string) => void;
  signal?: AbortSignal;
  temperature?: number;
}

export interface Provider {
  readonly name: string;
  isAvailable(): Promise<boolean>;
  chat(opts: ChatOptions): Promise<ChatMessage>;
  embed?(text: string): Promise<number[]>;
}

// 技能清单（manifest.json）—市场技能安装时写入 skills/installed/<slug>/manifest.json，
// 记录版本/作者/权限/校验和，供 loader 标记信任级、市场路由做安全校验。
export interface SkillManifest {
  name: string;
  version: string;
  author?: string;
  description?: string;
  tags?: string[];
  category?: string;
  /** 声明的能力/权限（沙箱判定依据；安装时与危险脚本扫描结果交叉校验） */
  permissions?: { network?: boolean; fileWrite?: boolean; shell?: boolean };
  /** 信任级：'trusted' 直接运行；'sandboxed'（默认）在受限沙箱运行 */
  trust?: 'trusted' | 'sandboxed';
  sha256?: string; // 包完整性校验
  homepage?: string;
  repository?: string;
}

// 技能定义
export interface Skill {
  name: string;
  description: string;
  trigger?: string;
  body: string; // SKILL.md 正文
  dir: string;
  tags?: string[]; // 从 frontmatter 的 tags / metadata.dasha.tags 解析
  category?: string; // 粗分类（用于系统提示中的分组索引）
  /** 来源：内置技能 或 市场安装的技能（默认 undefined 视为 builtin） */
  source?: 'builtin' | 'marketplace';
  /** 信任级：内置为 trusted；市场技能默认 sandboxed（沙箱运行） */
  trust?: 'trusted' | 'sandboxed';
  /** 市场技能清单（manifest.json 内容）：版本/作者/权限/校验等 */
  manifest?: SkillManifest;
}

// 会话
export interface StoredMessage extends ChatMessage {
  ts: number;
  hidden?: boolean; // 内部消息（如 tool/系统提示）不在 UI 直接展示
}

export interface Session {
  id: string;
  title?: string;
  messages: StoredMessage[];
  createdAt: number;
  updatedAt: number;
}

// 调度任务结果
export interface JobResult {
  name: string;
  ranAt: number;
  ok: boolean;
  outputPath?: string;
  error?: string;
}
