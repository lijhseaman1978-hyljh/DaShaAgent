// security/threatDetector.ts
// 计划书 Phase 3 - Step 1 §十三：危险行为检测。
//
// 计划书给的是字面量 includes 匹配（4 条）。字面量匹配漏洞很大（`rm  -rf /`、`rm -fr /` 都能绕过），
// 因此在保留计划书 blocked 清单的同时，追加正则规则集。清单本身对外可见、可扩展。
//
// 2026-08-14 修复（误报根治）：
//   1) blocked 清单移除 'format'、'mkfs' 两个单词级字面量——旧版子串匹配会误伤正常代码
//      （openpyxl 样式 API 名、openxmlformats.org 等 URL、代码注释说明），而真实磁盘格式化
//      已由下方正则（\bmkfs、\bformat\s+[a-z]:）精确覆盖，移除后防护能力不降级。
//   2) explain() 对 blocked 中单词类条目改用词边界匹配，彻底杜绝子串误伤。

export class ThreatDetector {
  /** 计划书 §十三 原始清单（保留，可被外部读取/追加；均为含空格的整命令串） */
  blocked = ['rm -rf /', ':(){:|:&};:'];

  /** 变形绕过防护 */
  private patterns: Array<{ re: RegExp; label: string }> = [
    { re: /\brm\s+(-[a-z]*\s+)*-[a-z]*[rf][a-z]*\s+\//i, label: 'recursive delete on root' },
    { re: /\brm\s+(-[a-z]*\s+)*-[a-z]*[rf]/i, label: 'recursive/forced delete' },
    { re: /\bdel\s+\/[sq]/i, label: 'recursive Windows delete' },
    { re: /\brmdir\s+\/s/i, label: 'recursive directory removal' },
    { re: /Remove-Item[^|]*-Recurse/i, label: 'PowerShell recursive removal' },
    { re: /\bmkfs(\.|\s|$)/i, label: 'filesystem format' },
    { re: /\bformat\s+[a-z]:/i, label: 'disk format' },
    { re: /:\s*\(\s*\)\s*\{.*\}\s*;\s*:/, label: 'fork bomb' },
    { re: /\b(curl|wget)\b[^|]*\|\s*(ba)?sh/i, label: 'remote script piped to shell' },
    { re: /\bdd\s+if=.*of=\/dev\//i, label: 'raw disk write' },
    { re: /\b(shutdown|reboot|halt|poweroff)\b/i, label: 'system power control' },
    { re: /\bchmod\s+-R\s+777\s+\//, label: 'world-writable root' },
    { re: /\b:\s*>\s*\/dev\/sd[a-z]/i, label: 'raw disk wipe' },
  ];

  /** 计划书 §十三 接口：命中危险返回 true。 */
  detect(command: string): boolean {
    return this.explain(command) !== null;
  }

  /** 命令规范化：合并多余空格，防止空格绕过（B9 修复）。
   *  "rm  -rf  /" → "rm -rf /" */
  private normalize(cmd: string): string {
    return cmd.replace(/\s+/g, ' ').trim();
  }

  /** 单词类黑名单转词边界正则（防子串误伤，如 'format' 不再匹配 format 开头的 API 名/URL） */
  private wordPattern(term: string): RegExp {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp('\\b' + escaped + '\\b');
  }

  /** 工程化补充：返回命中原因，便于 Monitor 记录与 Reflection 存教训。 */
  explain(command: string): string | null {
    const raw = String(command ?? '');
    const cmd = this.normalize(raw);
    for (const b of this.blocked) {
      // 含空格的整命令串（rm -rf /、fork bomb）→ 子串匹配；单词类 → 词边界匹配
      if (/\s/.test(b)) {
        if (cmd.includes(b)) return `blacklist: ${b}`;
      } else if (this.wordPattern(b).test(cmd)) {
        return `blacklist: ${b}`;
      }
    }
    for (const p of this.patterns) if (p.re.test(cmd)) return p.label;
    return null;
  }
}

export const threatDetector = new ThreatDetector();
