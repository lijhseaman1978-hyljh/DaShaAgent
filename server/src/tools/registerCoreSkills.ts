// tools/registerCoreSkills.ts

// 注册核心实战技能到 DaShaAgent 技能系统（对标 offline-office 等通用技能）。
// 这里只放「通用、可复用」的技能示例，不绑定任何个人/私有业务。
// 用法：import './registerCoreSkills' 或 npx tsx server/src/tools/registerCoreSkills.ts

import { addSkill, getSkills, clearSkillCache } from '../skills/loader';

const CORE_SKILLS = [
  {
    name: '发送邮件',
    description: '通过 SMTP 发送邮件，支持附件。配置见 .env（AH_SMTP_*）。From 头必须是纯邮箱地址。',
    trigger: '发邮件|邮件|email|发送到邮箱',
    body: `# 发送邮件

1. 用 send_email 工具（to / subject / body / attachment）
2. SMTP 配置来自环境变量 AH_SMTP_HOST / AH_SMTP_PORT / AH_SMTP_USER / AH_SMTP_PASS
3. From 头必须纯邮箱，不能用 "Name <email>" 格式（否则 550）
4. 大附件超时：用独立小脚本发送`,
  },
  {
    name: '生成办公文档',
    description: '生成 Word / Excel / PPT / PDF 文档。Word 用 python-docx，Excel 用 openpyxl（禁止重建结构），PDF 用 reportlab。',
    trigger: 'Word|Excel|PPT|PDF|文档|报告',
    body: `# 生成办公文档

1. Word: python-docx add_heading 层级 + add_table，中文字体设 w:eastAsia
2. Excel: 复制原文件 → load_workbook → 改单元格 → save（禁止重建结构）
3. PPT: python-pptx 逐张幻灯片
4. PDF: reportlab + UnicodeCIDFont(STSong-Light)
5. 扫描件 PDF → Tesseract OCR（显式设置 tesseract_cmd）`,
  },
];

export function registerCoreSkills(): number {
  let count = 0;
  // 幂等注册：已存在的同名技能直接跳过，绝不覆盖用户后续编辑。
  const existing = new Set(getSkills().map((s) => s.name));

  for (const s of CORE_SKILLS) {
    if (existing.has(s.name)) {
      console.log(`[registerCoreSkills] 跳过（已存在）: ${s.name}`);
      continue;
    }
    try {
      addSkill(s);
      count++;
    } catch (e: any) {
      console.error('[registerCoreSkills] 失败:', s.name, e?.message || e);
    }
  }

  clearSkillCache();
  console.log(`[registerCoreSkills] 本次新注册 ${count} 个（已存在 ${CORE_SKILLS.length - count} 个跳过），共 ${getSkills().length} 个技能`);
  return count;
}

// 直接运行时注册
if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}`) {
  registerCoreSkills();
  const all = getSkills();
  console.log('当前技能总数:', all.length);
  all.slice(-10).forEach((s: any) => console.log('  -', s.name ?? s));
}
