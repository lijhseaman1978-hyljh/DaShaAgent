# OpenHUMAN v0.54.0 记忆系统参考

> 本文件记录 OpenHUMAN 的记忆系统结构和灌注方法。
> 安装路径：D:\SOFT\OpenHuman\OpenHuman.exe
> 用户数据：C:\Users\your-user\.openhuman\users\{userId}\
> 用户ID: 6a0c807b16d0d3328365550c

## 目录结构

```
C:\Users\your-user\.openhuman\
├── logs\
│   ├── openhuman.YYYY-MM-DD.log     # 运行日志
├── cache\
│   └── fake_camera\                 # 虚拟摄像头
└── users\
    └── {userId}\                    # 用户ID
        ├── config.toml              # 配置文件
        ├── cef\                     # Chromium缓存
        └── workspace\
            ├── memory\
            │   ├── memory.db        # SQLite数据库 (memory_docs, vector_chunks等表)
            │   └── namespaces\
            │       └── global\
            │           └── docs\    # 记忆文档(markdown)
            ├── sessions\            # 会话记录
            └── session_raw\         # 原始会话JSONL
```

## 配置文件关键项 (config.toml)

```toml
schema_version = 2
default_model = "chat-v1"            # TinyHumans AI 云端模型
cloud_providers = []                 # 云端API密钥（为空时云端功能不可用）

[learning]
enabled = false                      # 学习系统（默认关闭，需手动开启）

[memory]
backend = "sqlite"
auto_save = true
embedding_provider = "cloud"         # 嵌入使用云端（需要cloud_providers配置）
embedding_model = "embedding-v1"     # TinyHumans嵌入模型
embedding_dimensions = 1024          # 嵌入维度
min_relevance_score = 0.4

[memory_tree]                        # 知识图谱记忆树
llm_extractor_endpoint = "http://localhost:11434"
llm_extractor_model = "gemma3:4b"
llm_summariser_endpoint = "http://localhost:11434"
llm_summariser_model = "gemma3:4b"
llm_backend = "cloud"                # LLM后端用云端
cloud_llm_model = "summarization-v1"

[local_ai]
runtime_enabled = false              # 本地AI（默认关闭）
provider = "ollama"
embedding_model_id = "bge-m3"

[local_ai.usage]
embeddings = false                   # 本地嵌入（默认关闭）
```

### 启用本地嵌入的修改

当云端不可用时，修改以下两处即可启用本地Ollama嵌入：

```toml
[local_ai]
runtime_enabled = true               # false → true

[local_ai.usage]
embeddings = true                    # false → true
```

先下载嵌入模型：
- `ollama pull bge-m3`（~1.2GB, 1024维，匹配默认1024维配置）
- `ollama pull all-minilm:l6-v2`（45MB, 384维，小模型但不匹配维数）

## SQLite 数据库结构 (memory.db)

### memory_docs 表
| 字段 | 类型 | 说明 |
|------|------|------|
| document_id | TEXT | 文档ID (格式: `timestamp_hash`) |
| namespace | TEXT | 命名空间 (通常: `global`) |
| key | TEXT | 键 (通常等于title) |
| title | TEXT | 文档标题 |
| content | TEXT | 文档正文 |
| source_type | TEXT | 来源类型 (`chat`, `import`) |
| priority | TEXT | 优先级 (`high`, `medium`, `low`) |
| tags_json | TEXT | JSON格式标签 |
| metadata_json | TEXT | JSON格式元数据 |
| category | TEXT | 分类 |
| session_id | TEXT | 会话ID |
| created_at | REAL | 创建时间 (Unix timestamp) |
| updated_at | REAL | 更新时间 |
| markdown_rel_path | TEXT | Markdown文件相对路径 |

### vector_chunks 表
| 字段 | 类型 | 说明 |
|------|------|------|
| namespace | TEXT | 命名空间 |
| document_id | TEXT | 文档ID |
| chunk_id | TEXT | 块ID (格式: `doc_id:序号`) |
| text | TEXT | 块文本内容 |
| embedding | BLOB | 向量嵌入 (struct.pack float32数组) |
| metadata_json | TEXT | 元数据JSON |
| created_at | REAL | 创建时间 |
| updated_at | REAL | 更新时间 |

### 其他表
- `episodic_log`: 对话事件日志（含 `role`, `content`, `lesson`）
- `conversation_segments`: 对话段落摘要
- `graph_global`/`graph_namespace`: 知识图谱三元组
- `kv_global`/`kv_namespace`: 键值存储
- `user_profile`: 用户档案
- `event_log`/`event_embeddings`: 事件日志

## 记忆文档格式 (markdown)

```markdown
---
doc_id: 1779204517_d852144d
namespace: global
title: assistant_resp
source_type: chat
priority: medium
tags: []
created_at: 1779204517.6943002
updated_at: 1779262953.7149186
---

# 标题

正文...
```

文件命名：`{timestamp}_{hash}.md`

## 灌注方法总结

### 1. Markdown文件写入
直接写入 `...\memory\namespaces\global\docs\` 目录

### 2. SQLite记录写入
```sql
INSERT INTO memory_docs (...) VALUES (...)
```

### 3. 向量嵌入生成
- 需要匹配的嵌入模型
- 本地可用 `all-minilm:l6-v2`（384维，45MB）或 `bge-m3`（1024维，~1.2GB）
- 写入 `vector_chunks` 表，embedding列为 `struct.pack('<384f', *values)`
- all-minilm上下文窗口小：每块≤200字符

### 4. 注意事项
- **记忆系统可能未启用**（learning.enabled=false + cloud_providers=[]）
- **无需先启动OpenHUMAN**，文件写入和SQLite操作独立于进程
- **长文本需切块**：all-minilm每块≤200字符，bge-m3可以更长
- **嵌入模型必须匹配**对方搜索时的模型，否则向量空间不同
- **启用本地嵌入**需修改config.toml的两处：`runtime_enabled=true` + `embeddings=true`
