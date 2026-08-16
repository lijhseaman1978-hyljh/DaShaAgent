# fs_read 参考手册

## 何时用 / 何时不用

| 场景 | 用 fs_read |
|------|-----------|
| 读任意文件内容（.txt/.md/.json/.csv/.py/.js/.ts等） | ✅ |
| 读 Excel 文件（.xlsx/.xls/.xlsm） | ✅ 内置 openpyxl 解析 |
| 读 PDF 文件（.pdf） | ✅ 内置 pypdf + pdfplumber 兜底 |
| 读 Word 文件（.docx/.docm） | ✅ 内置 python-docx 解析（段落+表格） |
| 读 PPT 文件（.pptx/.ppsx） | ✅ 内置 python-pptx 解析 |
| 生成/新建文档 | ❌ 用 create_docx/create_xlsx 等 |
| 搜索内容 | ❌ 用 grep_search 或 search |
| 列出目录 | ❌ 用 fs_list |

## 使用模式

```
fs_read({ file_path: "path/to/file.xlsx" })
```

**路径规则**：
- 绝对路径：`data/xxx.txt`（相对于工作区根目录）
- 相对路径：从工作区根目录起
- 不要猜测路径——先用 fs_list 确认文件存在

## 常见错误

1. **路径不存在**：先用 fs_list 列目录，确认文件存在后再读
2. **权限问题**：某些系统目录（C:/Windows/等）可能无读取权限
3. **编码问题**：文本文件如乱码，可能是 GBK 编码，需转码

## 避坑指南

- fs_read 读大文件时会自动截断以防止 token 爆炸
- 二进制文件（.exe/.zip等）会返回不可读内容
- 不要为"读文档内容"去调用 skill_pdf/skill_docx 技能——那些是生成工具
