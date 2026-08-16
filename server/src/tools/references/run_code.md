# run_code 参考手册

## 何时用 / 何时不用

| 场景 | 用 run_code |
|------|------------|
| 执行 Python 脚本 | ✅ |
| 执行 Node.js 脚本 | ✅ |
| 执行 Bash/CMD 命令 | ✅ |
| 处理复杂数据转换 | ✅ |
| 生成 Office 文档 | ❌ 用 create_docx/create_xlsx 等 |
| 读文件内容 | ❌ 用 fs_read |
| 系统级操作 | ⚠️ 先确认再执行 |

## 使用模式

```
run_code({ code: "python代码", language: "python" })
```

或

```
run_code({ script_path: "D:/path/to/script.py", language: "python" })
```

## 常见错误

1. **中文引号/路径**：Windows 路径含中文时注意编码
2. **超时**：长时间运行的任务可能被中止
3. **没有输出**：确认 print/console.log 写到了 stdout

## 避坑指南

- 自造工具闭环：fs_write 写脚本 → run_code 执行
- Python 脚本用 `# -*- coding: utf-8 -*-` 声明
- Node 脚本用 ESM 模式（`"type": "module"`）
- 不要用 run_code 创建二进制文件（.docx/.xlsx等）——这类必须用专用工具
- 不要在 run_code 直接操作文件再用 fs_read 读取——直接调用 create_* 工具更简单
