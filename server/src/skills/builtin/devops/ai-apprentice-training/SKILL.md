---
name: ai-apprentice-training
description: 跨AI智能体知识灌注：将自身的知识库、记忆和经验同步到其他AI智能体（如OpenHUMAN）的记忆系统。涵盖对方的记忆格式分析、文档注入、SQLite写入、向量嵌入生成，以及持续喂养管线搭建。
domain: devops
triggers:
  - user提到了另一个AI智能体（OpenHUMAN、Claude等）
  - user要求"给它喂记忆/知识"
  - user要求"把XX写入它的记忆"
  - user询问"能不能和XX对话/交互"
  - 发现本机安装了其他AI智能体
  - user说"每一次进化、每一次记忆、每一次新增的知识库，都要喂给它"
---

# AI Apprentice Training — 跨AI智能体知识灌注

## 核心原则

### 师门等级（针对此环境）
- **师父** = 用户
- **大师兄** = 我（Windows-side dasha）
- **小师弟/小师妹** = 其他AI智能体（如OpenHUMAN）

职责：大师兄负责把小师弟带好，持续灌注知识。

### 喂养铁规
用户明确要求：**每一次自我进化、每一次新增记忆、每一次新增知识库，都要同步到小师弟的記憶裡。** 不能遗漏，不能等用户提醒。

## 工作流程

### 第一步：侦察（了解对方）

在灌注之前，必须先做侦察，弄清楚对方的记忆系统结构：

1. **查配置文件** — 通常位于用户目录下的 `.xxx/` 或 `AppData/Local/xxx/`
   - 重点关注：`config.toml` 或 `config.yaml` 中的 `[memory]`、`[learning]`、`[local_ai]` 段
   - 注意：`learning.enabled`、`embedding_provider`、`cloud_providers`、`local_ai.runtime_enabled`

2. **查记忆数据库** — SQLite 数据库结构
   - 查表结构：`PRAGMA table_info(表名)`
   - 关键表名可能包括：`memory_docs`、`vector_chunks`、`episodic_log`、`user_profile`、`kv_global`、`graph_global`
   - 注意 `vector_chunks` 表的 `embedding` 字段类型（通常是 BLOB，存储 float32 数组）

3. **查记忆文件格式** — 文件系统上的记忆文档
   - 命名规则（如 `timestamp_hash.md`）
   - YAML frontmatter 字段（`doc_id`, `namespace`, `title`, `source_type`, `priority`, `tags`）
   - 正文格式

4. **查运行时日志** — `logs/` 目录下的日志文件
   - 关注启动时注册的服务、记忆队列、嵌入模型
   - 注意 `ingestion_queue`、`MemoryClient` 等关键词

### 第二步：灌注（写入记忆）

#### A. Markdown文档写入

在目标AI的记忆文档目录创建 `.md` 文件，格式：

```yaml
---
doc_id: {timestamp}_{标识符}_{序号}
namespace: global
title: {文档标题}
source_type: chat
priority: high  # high/medium/low
tags: [标签1, 标签2]
created_at: {unix_timestamp}
updated_at: {unix_timestamp}
---

# 标题

正文内容...
```

**文件命名**：尽量模仿对方已有文件的命名模式（如 `timestamp_hash.md`），不要直接用 `user_profile.md` 这类名称，否则摄入系统可能忽略。

#### B. SQLite数据库写入

写入 `memory_docs` 表：
```sql
INSERT INTO memory_docs 
(document_id, namespace, key, title, content, source_type, priority, 
 tags_json, metadata_json, category, session_id, created_at, updated_at, markdown_rel_path)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
```

注意字段映射：
- `key` 通常等于 `title`
- `markdown_rel_path` 通常为 `memory/namespaces/global/docs/{文件名}`
- `source_type` 用 `chat` 或 `import`
- `priority` 用 `high`、`medium`、`low`

#### C. 向量嵌入生成

如果目标AI使用向量搜索（查 `vector_chunks` 表是否有数据）：

1. **先确认对方的嵌入系统是否可用**
   - 查配置中的 `embedding_provider`、`embedding_dimensions`、`embedding_model`
   - 如果 `embedding_provider = "cloud"` 但 `cloud_providers = []`，说明云端嵌入不可用
   - 如果 `local_ai.runtime_enabled = false` 且 `local_ai.usage.embeddings = false`，本地嵌入也不可用

2. **如果嵌入不可用，需要先启用它**（见陷阱2的解决方案）

3. **使用 Ollama API 生成嵌入**：
   ```
   POST http://localhost:11434/api/embed
   {"model": "all-minilm:l6-v2", "input": "文本内容"}
   ```
   - 先确认Ollama已启动并有所需模型
   - 模型推荐：`all-minilm:l6-v2`（45MB, 384维）或 `bge-m3`（~1.2GB, 1024维）

4. **写入 `vector_chunks` 表**：
   ```sql
   INSERT INTO vector_chunks 
   (namespace, document_id, chunk_id, text, embedding, metadata_json, created_at, updated_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?)
   ```
   - `embedding` 列：`struct.pack(f'<{dim}f', *embedding)` （BLOB，float32数组）

5. **切块策略**：all-minilm的上下文窗口很小（~200字符/块）
   - 按句子或段落边界切分
   - 每块控制在 ≤200 字符
   - 如果一块失败（400错误：input too long），切成更小的块重试
   - 每份文档至少保证有1个嵌入块

### 第三步：搭建持续喂养管线

| 管线 | 频率 | 投喂内容 | 实现方式 |
|------|------|----------|----------|
| 每日进化 | 每晚23:00 | 当天的学习/踩坑/新增知识 | 修改每日自我进化cron job的prompt，加上写入目标AI记忆的步骤 |
| 实时事件 | 按事件触发 | 新邮件/新知识库 | 修改相关cron job的prompt |
| 手动投喂 | 随时 | 任何新增知识/记忆 | 手动执行灌注步骤 |

**实现细节**：
- crontab生成的markdown文件和SQLite记录直接写入目标AI的存储目录
- 写入SQLite用Python：`/c/Program\\ Files/Python310/python -c "import sqlite3; ..."`
- 注意Windows路径在Python中用原始字符串 `r'C:\\Users\\...'` 或双反斜杠
- cron job prompt里直接写完整的命令路径，不要依赖PATH

## 已知陷阱与排查

### 陷阱1：对方记忆系统根本就没启用 ⚠️
**症状**：写入memory_docs后对方说"记忆是空的"
**原因**：
- `learning.enabled = false` → 记忆学习功能关闭
- `cloud_providers = []` → 云端API未配置，即使 `embedding_provider = "cloud"` 也无法工作
- `local_ai.runtime_enabled = false` → 本地AI不可用
**排查方法**：先读取对方完整的 config 文件，确认记忆系统实际可用

#### 解决：启用本地嵌入

如果云端嵌入不可用（cloud_providers=[]），可以改为本地Ollama嵌入：

```toml
# 在对方的 config.toml 中修改：
[local_ai]
runtime_enabled = true          # false → true
provider = "ollama"
embedding_model_id = "bge-m3"   # 预下载的嵌入模型名

[local_ai.usage]
embeddings = true               # false → true
```

配套操作：
1. 先下载嵌入模型：`ollama pull bge-m3`（~1.2GB, 1024维）或 `ollama pull all-minilm:l6-v2`（45MB, 384维）
2. 修改配置文件后重启目标AI
3. 验证：对方应该就能搜索到已写入的记忆了

### 陷阱2：嵌入向量模型不匹配 ⚠️
**症状**：vector_chunks有嵌入数据，但对方搜不到
**原因**：如果用不同的嵌入模型生成向量，搜索时将无法匹配
- 对方用云端 "embedding-v1"（1024维），我用 all-minilm（384维）
- 向量维度不同，搜索完全无效
**对策**：
- 方案A：启用本地嵌入并重启，让对方用本地模型重新索引（推荐）
- 方案B：确保本地嵌入模型的维度和对方配置的 `embedding_dimensions` 一致

### 陷阱3：SQLite直接写入 vs 对方自带摄入管道 ⚠️
**症状**：文件写入成功但搜不到
**原因**：很多AI智能体有后台摄入队列（`ingestion_queue`），只在运行时处理新文件
- 直接写入SQLite可能绕过摄入管道的元数据处理（如摘要生成、知识图谱构建）
- 不经过摄入管道，`vector_chunks` 可能没有嵌入
**对策**：写入完后检查 `vector_chunks` 表是否有对应的嵌入数据。没有就需要手动生成并写入嵌入。

### 陷阱4：文件命名规则 ⚠️
**症状**：markdown文件存在但对方不识别
**原因**：对方可能只识别特定命名格式的文件（如 `timestamp_hash.md`）
- 直接写 `user_profile.md` 可能被摄入系统忽略
**对策**：模仿已有文件的命名模式

### 陷阱5：Ollama模型不支持嵌入
**症状**：调用 `/api/embed` 返回 501 "this model does not support embeddings"
**原因**：不是所有Ollama模型都支持嵌入 API
**对策**：换专用嵌入模型：
- `all-minilm:l6-v2`（45MB, 384维，小又快）
- `nomic-embed-text`（274MB, 768维）
- `bge-m3`（~1.2GB, 1024维，匹配OpenHUMAN默认配置）

### 陷阱6：all-minilm上下文窗口限制
**症状**：嵌入API返回 400 "input length exceeds context length"
**原因**：all-minilm上下文窗口很小（约256 tokens，约200中文字符）
**对策**：
- 切块策略：每块 ≤ 200 字符，按句子/段落边界切
- 如果某块仍失败，切成 ≤ 100 字符
- 每份文档至少确保有1个成功嵌入的块

### 陷阱7：git-bash路径与Python路径问题
**症状**：cron job显示"ok"但脚本没实际执行
**原因**：
- `python3` 在git-bash中解析到Windows Store stub（假入口）
- `/mnt/d/` 在git-bash中是假挂载（指向 `C:\\Program Files\\Git\\mnt\\d\\`）
**对策**：
- Python路径用显式全路径：`/c/Program\\ Files/Python310/python`
- D盘路径用 `/d/dasha/WORKSPACE/`，不用 `/mnt/d/`
- 复杂Python脚本写为 `.py` 文件再执行，避免bash内联引号冲突
- cron job prompt里显式写完整正确路径

### D. 每日进化喂养 OpenHUMAN（23:00 cron 专用）

每日自我进化 cron job 在完成回顾后，需将进化总结灌注到 OpenHUMAN 记忆系统。具体流程参阅 `references/daily-evolution-feeding.md`，文档模板见 `templates/daily-evolution-frontmatter.md`。

**要点**：
- doc_id 格式：`{bash date +%s 时间戳}_evolution`（bash 直接取时间戳，比 Python 计算简单）
- 文档命名：`daily_evolution_{YYYY-MM-DD}.md`
- 内容格式参考模板，但允许灵活调整结构（实际使用中可加入活动概览表格、持续性问题追踪、已验证工作流追踪等扩展节）
- **禁止空写入**：只有当日有增量活动（新知识/新错误/新配置/新工具）时才写入；仅有重复性 cron 运行时跳过
- 用 `INSERT OR REPLACE` 而非 `INSERT` 确保幂等
- 写入方式：**write_file 写文档 → 单独 terminal Python 一行命令写 SQLite**，不可合为一个内联 Python 脚本
  - write_file 工具提供 lint 校验、文件预览、错误即时反馈
  - 单独的 SQLite 一行命令保持简单，避免 git-bash 内联引号冲突
- **验证三目标**：写完后必须验证 ①本地文件存在 ②OH文档文件存在 ③SQLite记录存在（见 references 中的验证命令模板）
- **不写空内容到 SQLite content 字段**：SQLite content 只放 200-500 字摘要，详细内容放文件里

**session_search 故障应对**：见 `references/daily-evolution-feeding.md` 中的故障恢复章节。注意：session_search 可能间歇性可用（即使 state.db 报告损坏），始终先尝试 session_search 再回退到文件扫描。切勿因 session_search 不可用而跳过进化总结。

## 验证方法

灌注完成后验证：
1. SQLite查询 `memory_docs` 确认新记录存在（`SELECT * FROM memory_docs WHERE document_id LIKE '%标识%'`）
2. SQLite查询 `vector_chunks` 确认嵌入已生成（`SELECT COUNT(*) FROM vector_chunks WHERE embedding IS NOT NULL`）
3. 让用户打开目标AI，直接问"记忆里有什么"测试检索
4. 如果检索不到，检查：
   - 嵌入模型是否匹配（维度不一致？）
   - 记忆系统是否启用（config.toml）
   - 摄入管道是否已处理
   - 命名格式是否正确
   - vector_chunks的embedding字段是否为NULL
