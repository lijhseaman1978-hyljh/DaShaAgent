# create_docx 参考手册

## 何时用 / 何时不用

| 场景 | 用 create_docx |
|------|---------------|
| 从零创建 Word 文档 | ✅ |
| 按模板生成报告/简历/合同 | ✅ |
| 把 Markdown 转成 .docx | ✅ |
| 读已有 Word 文档的内容 | ❌ 用 fs_read |
| 编辑已有 Word 文档 | ❌ 用 skill_docx |
| 用 fs_write 写 .docx | ❌ 会生成损坏文件 |

## 使用模式

```
create_docx({ template: "report", data: {...} })
```

或

```
create_docx({ content: "markdown content...", output: "output.docx" })
```

## 常见错误

1. **用 fs_write 写 .docx**：绝对不行——.docx 是 ZIP 压缩的 XML 格式，fs_write 产生损坏文件
2. **用 run_code + python-docx**：可以但 create_docx 更简单直接
3. **输出路径不存在**：确保目录已创建

## 避坑指南

- create_docx 生成的文档默认输出到工作区
- 需要指定完整输出路径时使用绝对路径
- 大文档（>50 页）生成可能需要更多时间
