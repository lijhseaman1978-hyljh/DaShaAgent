# Batch File Encoding on Chinese Windows

## The Problem (two distinct failure modes)

Writing a `.bat` file with Chinese characters using `write_file` (UTF-8 without BOM) causes cmd.exe to misinterpret multi-byte UTF-8 characters as single-byte ANSI characters. cmd.exe on Chinese Windows defaults to CP936 (GBK) encoding.

```
'��动' is not recognized as an internal or external command,
operable program or batch file.
```

## ⚠️ CRLF Line Endings — the OTHER .bat killer (2026-07-29)

**Symptom:** A freshly written `.bat` fails immediately with garbled line-by-line errors:
```
'5001' 不是内部或外部命令，也不是可运行的程序
或批处理文件。
'D:\dasha\WORKSPACE' 不是内部或外部命令...
'orlevel' 不是内部或外部命令...
'ho' 不是内部或外部命令...
```

**Root cause:** `write_file` writes **LF (Unix) line endings**. cmd.exe requires **CRLF**. With LF endings, cmd.exe merges/truncates lines mid-token, so `errorlevel` becomes `orlevel`, `echo` becomes `ho`, etc.

**Diagnosis:**
```bash
file script.bat
# ❌ "ASCII text" (LF)  → broken
# ✅ "DOS batch file ... with CRLF line terminators" → good
```

**Fix — write .bat content with explicit `\r\n`:** embed `\r\n` at the end of every line in the string passed to `write_file`:
```python
bat = "@echo off\r\nchcp 65001 >nul\r\ncd /d D:\\dasha\\WORKSPACE\r\npause\r\n"
write_file("D:/dasha/WORKSPACE/script.bat", bat)
```
After writing, verify: `file script.bat` must report "CRLF line terminators". This applies to **every .bat delivered to the user** — one-click tools, importers, launchers.

## The Encoding Fix

### Option A: Use `chcp 65001` (UTF-8 mode)

```batch
@echo off
chcp 65001 >nul
title My Script
echo Chinese text now works ✓
```

This switches the console to UTF-8 code page. Works on Windows 10+ but commands before the `chcp` line still parse in the default encoding.

### Option B: Avoid Chinese characters entirely in .bat files (recommended)

```batch
@echo off
echo This script uses only ASCII text.
echo Press any key to exit.
pause >nul
```

The start/stop scripts should use English text only. The user doesn't need to read them — they just double-click to run. Chinese text in console output is a nice-to-have, not a requirement.

### Option C: Save with UTF-8 BOM

If you must have Chinese text, the file must start with UTF-8 BOM (`\xEF\xBB\xBF`). However, the `write_file` tool does not add BOM, so this requires a post-write step to prepend the BOM bytes.

## Pitfalls

- `write_file` saves as UTF-8 **without BOM** — this is correct for most use cases but breaks cmd.exe
- `REM` comments with Chinese chars can also trigger parse errors
- `echo.` (empty line) before `chcp 65001` doesn't help — cmd.exe reads the whole file before executing anything
- Git-bash (`bash.exe`) has no encoding issues with UTF-8 — the problem is specific to cmd.exe
- The `start /B /MIN` command from git-bash does NOT work correctly — processes launched this way silently die. Use `terminal(background=true)` in the agent tool, or let the user double-click the .bat from Explorer, which works correctly.
