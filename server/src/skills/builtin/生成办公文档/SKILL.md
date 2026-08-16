---
name: 生成办公文档
description: 生成 Word / Excel / PPT / PDF 文档。Word 用 python-docx，Excel 用 openpyxl（禁止重建结构），PDF 用 reportlab。
trigger: Word|Excel|PPT|PDF|文档|报告
---

# 生成办公文档

1. Word: python-docx add_heading 层级 + add_table，中文字体设 w:eastAsia
2. Excel: 复制原文件 → load_workbook → 改单元格 → save（禁止重建结构）
3. PPT: python-pptx 逐张幻灯片
4. PDF: reportlab + UnicodeCIDFont(STSong-Light)
5. 扫描件 PDF → Tesseract OCR（显式设置 tesseract_cmd）