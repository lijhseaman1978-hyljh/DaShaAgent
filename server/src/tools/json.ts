// 健壮的工具参数解析：兼容任意模型（含流式截断、尾部逗号等），
// 任何解析失败都不会静默返回 {} 导致工具以空参数运行后报错、模型重试陷入循环。
// 彻底失败时会返回带 _argParseError 标记的普通对象，交由 agentLoop 向模型清晰回报。
export function parseArgs(raw: any): any {
  if (raw == null) return {};
  if (typeof raw !== 'string') return raw; // 已是对象（provider 已解析好）
  const s = raw.trim();
  if (!s) return {};

  const direct = tryParse(s);
  if (direct !== TRY_FAIL) return direct;

  // 步骤 1：去掉尾部逗号（常见非严格 JSON）
  const r1 = tryParse(s.replace(/,(\s*[}\]])/g, '$1'));
  if (r1 !== TRY_FAIL) return r1;

  // 步骤 2：尝试补齐被截断的 JSON（流式输出常见的缺失闭括号 / 未闭合字符串）
  const fixed = closeTruncated(s);
  const r2 = tryParse(fixed);
  if (r2 !== TRY_FAIL) return r2;

  // 步骤 3：彻底失败——保留原文让上层向模型回报，而非静默 {}
  return { _argParseError: '工具参数不是合法 JSON', _raw: s.slice(0, 600) };
}

const TRY_FAIL = Symbol('try_fail');
function tryParse(s: string): any {
  try {
    const v = JSON.parse(s);
    return v;
  } catch {
    return TRY_FAIL;
  }
}

// 尝试闭合被截断的 JSON：统计未匹配的 {} [] 与未结束的字符串，在末尾补齐。
function closeTruncated(s: string): string {
  let depthBrace = 0;
  let depthBrack = 0;
  let inStr = false;
  let esc = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (esc) {
      esc = false;
      continue;
    }
    if (ch === '\\') {
      esc = true;
      continue;
    }
    if (ch === '"') {
      inStr = !inStr;
      continue;
    }
    if (inStr) continue;
    if (ch === '{') depthBrace++;
    else if (ch === '}') depthBrace--;
    else if (ch === '[') depthBrack++;
    else if (ch === ']') depthBrack--;
  }
  let out = s;
  if (inStr) out += '"'; // 闭合未结束的字符串
  while (depthBrack > 0) {
    out += ']';
    depthBrack--;
  }
  while (depthBrace > 0) {
    out += '}';
    depthBrace--;
  }
  return out;
}
