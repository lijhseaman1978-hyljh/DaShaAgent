// 图片旁路总线。
//
// 问题：fs_read 读到图片后，base64 动辄几百 KB。如果把它塞进工具返回值，
// 会被 JSON.stringify 进 tool 观察文本，再被 MAX_OBSERVATION_CHARS 拦腰截断，
// 得到一段无效的半截 base64 —— 既污染上下文又毫无用处。
//
// 而且 OpenAI 协议下 tool 角色的消息**不接受**图片内容块，图片只能挂在 user 消息上。
//
// 解法（对齐 WorkBuddy 内核做法）：工具侧把图片投递到本总线，
// 返回值里只留一句人类可读的摘要；agentLoop 在工具执行后 drain 总线，
// 把图片转成一条独立的 user 消息注入对话，模型下一轮就"看得见"这张图。

export interface PendingImage {
  b64: string;
  mime: string;
  path: string;
  note?: string;
}

const bus = new Map<string, PendingImage[]>();

export function pushImage(sessionId: string, img: PendingImage) {
  const list = bus.get(sessionId) || [];
  list.push(img);
  bus.set(sessionId, list);
}

/** 取出并清空该会话的待注入图片。 */
export function drainImages(sessionId: string): PendingImage[] {
  const list = bus.get(sessionId) || [];
  bus.delete(sessionId);
  return list;
}

export function clearImages(sessionId: string) {
  bus.delete(sessionId);
}
