# 每日进化喂养 OpenHUMAN 配方



> 用于 23:00 cron Job 的自我进化 → OpenHUMAN 灌注流程。

> 每次运行时会创建本地总结 + OpenHUMAN 文档 + SQLite 记录。



## 约束规则



### 🚫 禁止空写入

**只在有新内容时才写入 OpenHUMAN**。如果今日无新知识/无踩坑/无新增知识库，则跳过整个写入流程，输出 `[SILENT]` 以抑制交付。



### 💬 SILENT 规则（cron 任务专属）

当没有新内容需要报告时，只能输出 `[SILENT]` 且不附加任何其他文本或内容。`[SILENT]` 和实际内容不能共存。



## 流程概要



```

回顾今日会话 → 判断有新内容？ → 生成进化总结(本地) → 写入OpenHUMAN文档目录 → 写入SQLite → 保存本地存档 → 验证三目标

```



## 关键路径



### OpenHUMAN 文档目录

```

C:\Users\your-user\.openhuman\users\6a0c807b16d0d3328365550c\workspace\memory\namespaces\global\docs\

```



### SQLite 数据库

```

C:\Users\your-user\.openhuman\users\6a0c807b16d0d3328365550c\workspace\memory\memory.db

```



### Python 路径

```

/c/Program\ Files/Python310/python

```



## 文档命名规则



OpenHUMAN 文档：`daily_evolution_{YYYY-MM-DD}.md`

本地存档：`每日进化总结_{YYYY-MM-DD}.md`



## doc_id 格式



对于每日进化文档，使用 `{timestamp}_evolution`。



### 推荐：bash 取时间戳（简单可靠）

在 git-bash 中直接用 `date +%s` 获取当前 Unix 时间戳。

```

timestamp=$(date +%s)

```

将得到的整数直接用作 `doc_id` 前缀。



### 备用：Python 计算（如需 UTC+8 23:00 整点）

```python

from datetime import datetime, timezone, timedelta

dt = datetime(YEAR, MONTH, DAY, 23, 0, 0, tzinfo=timezone(timedelta(hours=8)))

timestamp = int(dt.timestamp())

```



## 内容结构



实际使用中，OpenHUMAN 每日进化文档按以下结构组织（见 `templates/daily-evolution-frontmatter.md` 模板）：



- **今日活动概览** — 表格：时间 | 任务 | 状态 | 产出

- **今日收获** — 新知识、新技能、新配置，按工作流分组（每个子标题附带路径/数据）

- **踩坑记录** — 错误和修复方法；无则写"今日无新增错误。"

- **持续性问题** — 长期未修复的问题追踪表（问题名 | 持续时间 | 影响）

- **已验证的稳定工作流** — 每日流水线可靠性追踪（工作流名 | 运行天数 | 可靠性）



使用此结构而非旧版五段式。注意：模板是起点，允许根据当天情况灵活增删节。例如某天有重大新安装工具时，可在"今日收获"前单列一节；当日全是例行运行无新内容时，直接输出 `[SILENT]`。



## 写入铁规



### 🚫 禁止空写入

只在有新内容时才写入 OpenHUMAN。如果今日无新知识/无踩坑/无新增知识库，则跳过整个写入流程。



判断标准：session_search 结果或文件系统分析显示当日无任何增量活动（仅有计划内的重复执行，无新工具/新知识/新配置/新错误）→ 跳过。

有增量活动（新错误、新知识文件、新工具安装、用户纠正、新配置变更、新工作流）→ 必须写入。



### 📄 内容优先

- 本地总结（`每日进化总结_*.md`）可以写详细（5000+ 字节）

- OpenHUMAN 文档（`daily_evolution_*.md`）写精练摘要（1500-2000 字节），足够检索用即可

- SQLite content 字段写 200-500 字摘要，不宜太长



## 📌 推荐操作方式：三步骤分离



**不要**用一个内联 Python 脚本同时写文件和 SQLite。分三步执行：



### 第一步：写 OpenHUMAN 文档

使用 `write_file` 工具写入文档文件（不是 terminal Python）。好处：

- write_file 提供 lint 校验和文件预览

- 可以确认 frontmatter 格式正确

- 发现错误可直接在编辑器中修正



### 第二步：写 SQLite（单独 terminal 命令）

用单独的 Python 一行命令插入 SQLite：

```bash

"/c/Program Files/Python310/python" -c "import sqlite3; conn=sqlite3.connect(r'C:\Users\your-user\...\memory.db'); c=conn.cursor(); c.execute(\"INSERT OR REPLACE INTO memory_docs (...) VALUES (?)\", values); conn.commit(); conn.close()"

```



注意：

- 用全路径 Python：`/c/Program\ Files/Python310/python`（bash 中空格需转义或引号包裹）

- Python 内 Windows 路径用原始字符串 `r'C:\Users\...'`

- SQL INSERT 用 `INSERT OR REPLACE` 确保幂等

- 复杂值的引号处理：Python 字符串内嵌 SQL 语句时，外层用双引号包裹 Python 代码，SQL 内层字符串用单引号（或 escape）



### 第三步：验证

写入完成后验证三个目标：

1. 本地进化总结文件存在且非空

2. OpenHUMAN 文档文件存在且非空  

3. SQLite 中能查询到新记录（`SELECT document_id, title, priority FROM memory_docs WHERE document_id LIKE '%evolution%'`）



## ✅ 验证方法



写入完成后必须验证三个目标：



### 1. 本地进化总结

```bash

ls -la /d/dasha/WORKSPACE/每日进化总结_{DATE}.md

# 确认文件存在且字节数>0

```



### 2. OpenHUMAN 文档文件

```bash

ls -la "/c/Users/your-user/.openhuman/users/6a0c807b16d0d3328365550c/workspace/memory/namespaces/global/docs/daily_evolution_{DATE}.md"

```



### 3. SQLite 记录

```bash

"/c/Program Files/Python310/python" -c "import sqlite3; conn=sqlite3.connect(r'C:\Users\your-user\.openhuman\users\6a0c807b16d0d3328365550c\workspace\memory\memory.db'); c=conn.cursor(); c.execute(\"SELECT document_id, title, priority FROM memory_docs WHERE document_id='{TIMESTAMP}_evolution'\"); print(c.fetchone()); conn.close()"

```



成功的 SQLite 验证输出示例：

```

('1780067335_evolution', 'daily_evolution_20260529', 'high')

```



## 🟢 session_search 可用性说明



`session_search` 可能 **间歇性可用**。即使 state.db 报告 "database disk image is malformed"，它仍可能返回部分结果。**始终先尝试 session_search** — 如果返回结果，可直接使用；如果失败，再走文件扫描回退路径。



session_search 的工作模式：它搜索的可能是备份 JSONL 文件或已缓存的会话摘要，而非直接读取损坏的 state.db。因此即使底层 DB 损坏，搜索结果仍可能有效。



**操作顺序**：

1. 先调用 session_search（默认模式）

2. 如果返回结果 → 直接使用（验证日期是否对应今日）

3. 如果返回 "malformed" 错误 → 走文件扫描回退



## 故障恢复：session_search 失败时（文件扫描回退）



当 session_search 因数据库损坏返回 `database disk image is malformed`，且结果为空或缺失今日数据时，通过以下替代方法重构今日活动：



### 方法一：文件 mtime 重建（最可靠）



```bash

# 查看今日新建/修改的文件

find /d/dasha/WORKSPACE -maxdepth 1 -mtime -1 -type f | head -20



# 查看今日创建的子目录

ls -la /d/dasha/WORKSPACE/ | grep "$(date +'%m月 %d')"



# 查看 workspace 根目录下今日创建的脚本和文档

ls -la /d/dasha/WORKSPACE/ | grep -E "$(date +'%b.*%d'|sed 's/^/5月/'|sed 's/$/ 24/')"

```



### 方法二：检查关键状态文件



```bash

# msatmail_state.json — last_check 字段显示最近活动时间

cat /c/Users/your-user/.dasha/msatmail_state.json



# cron jobs.json — 显示注册的cron任务

cat /c/Users/your-user/.dasha/cron/jobs.json

```



### 方法三：检查cron输出目录



cron输出位于 `/c/Users/your-user/.dasha/cron/output/{jobId}/`。如目录中有多日输出但今日无输出，说明cron任务可能已停止运行。



### 方法四：检查知识库新增



```bash

# knowledge/ 目录下的新增子目录对应新增知识库

ls -la /c/Users/your-user/.dasha/knowledge/ | grep "$(date +'%b %d')"

```



### 方法五：读取今日生成的脚本了解工作内容



今日的工作脚本（如 `generate_daily_reports.py`, `send_email.py`, `extract_*.py`）通常包含完整的日志注释或打印语句，可以直接读取了解执行过程。



### 恢复后校验清单



- [ ] 今日 workspace 目录（如 `2026-05-24/`）是否存在

- [ ] 今日 msatmail_state 是否更新

- [ ] knowledge/ 下是否有今日新增的子目录

- [ ] 是否有今日生成的 .docx/.md 输出文件

- [ ] cron job 是否有今日输出

- [ ] 整理出时间线（多个时间段的多个活动）

