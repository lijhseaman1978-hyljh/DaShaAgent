# 编写技能（Authoring Skills）· 教程

DaSha Agent 的「技能（Skill）」是一个**给 LLM 读的说明书 + 可选执行入口**的目录包。
loader（`server/src/skills/loader.ts`）会**递归扫描** `server/src/skills/builtin/` 下所有含 `SKILL.md` 的目录，解析其 frontmatter 后自动注册到技能索引，**无需改动任何调用方代码**。

---

## 一、最小结构

```
server/src/skills/builtin/
└── my-skill/
    ├── SKILL.md          # 必需：技能清单（loader 只认这个文件名）
    ├── references/       # 可选：长文档、表格、样例（被 SKILL.md 引用）
    └── scripts/          # 可选：辅助脚本
```

> 约定：一旦某目录含 `SKILL.md`，loader 即视其为「技能叶子」，**不会继续下钻**其 `references/`、`scripts/` 子目录——所以你可以把长内容拆出去而不污染索引。

---

## 二、SKILL.md 格式

`SKILL.md` 由 YAML frontmatter + Markdown 正文组成。frontmatter 字段：

| 字段 | 必填 | 说明 |
|------|------|------|
| `name` | ✅ | 技能唯一 slug（小写中划线，如 `computer-use`） |
| `description` | ✅ | 一句话能力描述，参与 BM25 匹配；支持多行 `\|` |
| `trigger` | ⬜ | 触发词 / 场景提示（增强召回） |
| `tags` | ⬜ | 标签数组，用于分类与筛选 |
| `version` | ⬜ | 语义化版本号 |
| `platforms` | ⬜ | 适用平台数组：`[macos, windows, linux]` |
| `metadata.dasha.tags/category/related_skills` | ⬜ | 引擎元数据（分类、关联技能） |

> **分类取值约定**：`category` 必须是以下 8 个标准分类之一，否则会被归入「其他」且无法在技能市场按分类筛选：
> `文档/写作` · `图像/视频` · `代码/开发` · `研究/数据` · `效率/自动化` · `系统/文件` · `社交/通讯` · `其他`

**示例**（取自内置 `computer-use/SKILL.md` 的精简版）：

```markdown
---
name: computer-use
description: |
  Drive the user's desktop in the background — clicking, typing,
  scrolling, dragging — without stealing the cursor.
version: 2.0.0
platforms: [macos, windows, linux]
metadata:
  dasha:
    tags: [computer-use, desktop, automation]
    category: 系统/文件
    related_skills: [browser]
---

# Computer Use

（正文：给模型看的完整操作说明、参数表、示例、安全规则……）
```

---

## 三、真实范例对照

- **分类 + 子技能**：`github/` 是分组目录（含 `DESCRIPTION.md` 作为分组说明），其下 `github-auth/`、`github-code-review/`、`github-issues/` 等每个都自带 `SKILL.md`，被 loader 递归发现为独立技能；每个子技能的 `category` 仍须取上文 8 个标准分类之一。
- **单文件技能**：`computer-use/SKILL.md` 是一个完整的叶子技能。
- **中文技能**：`发送邮件/SKILL.md`、`生成办公文档/SKILL.md` 同样遵循上述格式，slug 可为中文目录名。

> 注意：部分旧技能以 `DESCRIPTION.md`（仅含 `description` frontmatter）或 `*.skill.ts`（遗留 TS 可执行形态）存在。loader **只扫描 `SKILL.md`**；`*.skill.ts` 等非目录文件会被跳过。新技能请统一使用 `SKILL.md`。

---

## 四、正文怎么写（给模型看）

正文不是给人读的文档，而是**加载进系统提示、被模型当作操作手册**的。建议结构：

1. **一句话定位** + 何时使用（trigger）。
2. **核心工作流**（Step 1 / 2 / 3，带可执行命令 / 参数）。
3. **参数 / 动作表**（表格化，便于模型精确调用）。
4. **失败模式与排查**（表格：症状 → 原因 → remedy）。
5. **安全硬规则**（绝不……；遇到 X 先停下来问用户）。
6. **何时不用本技能**（边界，避免误用）。

参考内置 `computer-use/SKILL.md`（约 260 行）是高质量范本；`github/`、`research/` 下的子技能也遵循同一规范。

---

## 五、让模型「想到」你的技能

技能能否被调用，取决于 **BM25 匹配 + 中文别名展开**。提升召回的做法：
- `description` 覆盖用户可能的**口语化表述**（中英文都写）。
- 善用 `trigger` 与 `tags`。
- 中文场景已在 loader 的 `ALIASES` 表中预置大量映射（图片 / 搜索 / 视频 …），尽量复用既有词汇（如「配图」「海报」「检索」）。

---

## 六、测试你的技能

```bash
npm run typecheck      # 确保引擎编译通过（技能不编译，但索引注册路径会变）
npm test               # 端到端测试
# 手动验证：启动后在前端「技能列表 / 技能市场」查看是否出现；
# 用描述性自然语言提问，观察模型是否 use_skill 命中你的技能。
```

---

## 七、发布到技能市场（可选）

内置技能随仓库分发。若想让社区安装你的技能：
- 在仓库 `server/src/skills/builtin/` 提交 PR（见 `CONTRIBUTING.md`）；或
- 通过 Marketplace 注册中心发布（registry 支持本地 `install` / `publish` / `list`，远程 GitHub registry 见 `server/src/skills/registry.ts`）。

---

保持技能「单一职责、说明充分、边界清晰」，是让它真正可用的关键。
