# Launching Windows GUI Apps from git-bash — Diagnostic Flowchart

## Decision Tree

```
start.exe fails?
  ├── No → Success! App launched.
  └── Yes → "No such file or directory" / path translation error
       │
       ├─ Was it MSYS2 mangling /flags? → MSYS2_ARG_CONV_EXCL=* start.exe
       └─ Was it mangling the path? → Use PowerShell Start-Process
              │
              ├─ Start-Process succeeds? → Verify with tasklist
              │      └─ App still crashes? → Check disk_cache (below)
              └─ Start-Process fails? → Check app executable exists
                     │
                     └─ File exists but won't launch?
                          └─ Run directly: C:\path\to\app.exe --version
                             to see error output (Electron errors show in console)
```

## Electron disk_cache Error (0x5)

**Symptoms:** App launches then immediately closes (no visible error, no process in tasklist).

**Diagnosis:** Run the app directly (not via start/Start-Process) to see error output:
```
C:\Users\<user>\AppData\Local\dasha\dasha-agent\apps\desktop\release\win-unpacked\dasha.exe --version
```

If you see `ERROR:net\disk_cache\cache_util_win.cc:25] Unable to move the cache: 拒绝访问。 (0x5)`, the cache directory is locked.

**Fix:**
```
rmdir /s /q "%LOCALAPPDATA%\dasha\dasha-agent\Cache"
rmdir /s /q "%LOCALAPPDATA%\dasha\dasha-agent\GPUCache"
```
Then relaunch.

**Why this happens on Windows:** The cache directory may have been left in a locked state from a previous crash, or another process (antivirus, OneDrive, etc.) may be holding a lock on the cache folder.

## git-bash quoting gotcha

Electron paths with `\\` (backslashes) and spaces often cause MSYS2 to misinterpret arguments. The reliable approach:
- **Always use PowerShell `Start-Process`** for Electron apps
- **Never use `start.exe`** from git-bash for paths containing spaces
- **Always use single quotes** in the PowerShell command to avoid git-bash interpreting `$` or backticks
