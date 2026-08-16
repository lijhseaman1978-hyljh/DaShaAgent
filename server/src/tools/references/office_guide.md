# 办公文档工具速查

## 各工具对比

| 任务 | 首选工具 | 备选 | 禁止做法 |
|------|----------|------|----------|
| 创建 Word | create_docx 或 skill_docx | - | fs_write、run_code+python-docx |
| 创建 Excel | create_xlsx 或 skill_xlsx | - | fs_write |
| 创建 PPT | create_pptx 或 skill_pptx | - | fs_write |
| 创建 PDF | create_pdf 或 skill_pdf | - | fs_write |
| 读 Word 内容 | fs_read | - | skill_docx |
| 读 Excel 内容 | fs_read | - | skill_xlsx |
| 读 PDF 内容 | fs_read | - | skill_pdf |
| 写文本文件 | fs_write | - | - |

## 核心原则

1. **生成 = 专用工具**：create_docx / create_xlsx / create_pptx / create_pdf
2. **读取 = fs_read**：内置多格式解析，一步到位
3. **永远不用 fs_write 写二进制格式**：.docx/.xlsx/.pdf/.pptx 是 ZIP 压缩包
4. **技能文件（skill_*）= 生成用途**：不是读文件用的

## 常见陷阱

1. 调用 skill_xlsx 来"读 Excel 内容"——错误。skill_xlsx 是生成工具，读内容用 fs_read
2. 用 run_code + openpyxl 来生成 Excel——绕远路。直接用 create_xlsx
3. 用 fs_write 写 base64 编码的 .docx——会产生损坏文件
