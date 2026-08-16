---

name: windows-automation

description: Unified toolkit for Windows automation from dasha Agent (git-bash) — desktop GUI control with pyautogui/mss, local application data investigation, and background process watchdog with scheduled task auto-recovery. All three share the same environment constraints.

domain: devops

triggers:

  - user asks to control/manipulate the Windows desktop

  - user asks to read/extract data from a local Windows app

  - user asks to keep a service/process alive with auto-restart

  - user asks about WeChat/Weixin local chat data

  - user asks to launch a Windows GUI app (Electron/Node) from git-bash

---



# Windows Automation Toolkit



Unified collection of Windows-native automation techniques usable from the git-bash (MSYS2) environment. Organised into three domains: Desktop GUI Control, Application Data Access, and Process Watchdog.



---



## Shared Environment & Tooling



All three sections share these Windows environment constraints:



### Python



```bash

# The canonical Python on this system

/c/Program\ Files/Python310/python.exe

```



### MSYS2/git-bash Path Quirks



| Problem | Fix |

|---------|-----|

| `/d/dasha/...` → real D: drive | Use `/d/` in git-bash |

| `/mnt/d/dasha/...` → `C:\Program Files\Git\mnt\d\...` ❌ | Never use `/mnt/d/` in git-bash |

| git-bash converts `/create` → `C:\Git\create` | Prefix with `MSYS2_ARG_CONV_EXCL=*` |

| git-bash converts `/d/` paths in Python args | Prefix with `MSYS2_NO_PATHCONV=1` |

| UNC path issues with cmd.exe | `cd /c/` before calling powershell.exe |



### Process Discovery (from git-bash)



```bash

# Quick process check

cd /c/ && cmd.exe /c "tasklist /FI \"IMAGENAME eq ProcessName.exe\" /FO CSV /NH"



# Full command line (uses CIM)

cd /c/ && powershell.exe -ExecutionPolicy Bypass -Command "

Get-CimInstance Win32_Process -Filter \"Name like 'ProcessName%'\" | Select-Object ProcessId, CommandLine

"



# Kill a process by PID

/c/Windows/System32/taskkill.exe /F /PID <PID>



# Port check

cd /c/ && cmd.exe /c "netstat -ano | findstr :PORT"

```



### PowerShell Script Execution Pattern



Always write `.ps1` to `D:\dasha\WORKSPACE\` and execute with:



```bash

cd /c/ && powershell.exe -ExecutionPolicy Bypass -File "D:\dasha\WORKSPACE\script.ps1"

```



Never use inline `-Command` with complex pipelines — git-bash quoting breaks on `$_`, `$_.Property`, and nested quotes.



If the user asks for both a "停止" (stop) and "启动" (start) script, provide them as TWO SEPARATE `.ps1` files — the user prefers separate scripts for manual lifecycle control over a combined toggle script.



### 🚨 WSL/Windows Boundary — CRITICAL



You are the **Windows-side dasha Agent (Windows-side dasha)**. A completely separate dasha Agent instance lives in WSL. Mixing them corrupts data and misattributes service states.



**NEVER:**

- Run diagnostics on WSL processes from git-bash (`ps aux`, `systemctl`, `journalctl`, `wsl.exe`)

- Check WSL-side gateways, cron schedulers, or state databases

- Assume WSL and Windows share the same config, sessions, or processes



**ALWAYS:**

- Use Windows-native process checks: PowerShell scripts → `D:\dasha\WORKSPACE\`, executed via `powershell.exe -ExecutionPolicy Bypass -File`

- Use `tasklist`, `Get-Process`, `Get-NetTCPConnection` for process/port discovery

- Check Windows-side cron via `C:\Users\<user>\AppData\Local\dasha\cron\jobs.json`



**Real-world consequence (2026-06-16):** The agent ran `wsl.exe ps aux | grep cron` to check the cron scheduler — this found WSL's system crond, not dasha's gateway-integrated scheduler. The user corrected: "你怎么跑到WSL侧了，WSL侧和你有什么关系，你是在WINDOWS側". The correct check was a PowerShell script inspecting Windows dasha processes and reading `jobs.json` directly.



### Why Two dasha Instances?

- **Windows side (you):** `$dasha_HOME` = `C:\Users\your-user\AppData\Local\dasha\`

- **WSL side:** `~/.dasha/` = `/home/your-usereaman1978/.dasha/`

- Gateway: Windows runs Gateway via Scheduled Task (`dasha_Gateway.cmd`); WSL runs via systemd service

- Cron scheduler: Windows's runs inside the Windows Gateway process; WSL has its own separate scheduler

- D: drive is the only shared filesystem — both sides can read/write `D:\dasha\WORKSPACE\`



---



## Section 1: Desktop GUI Control



Control the Windows desktop: screenshots, mouse, keyboard, window management. Uses `pyautogui` + `mss` running under Windows Python.



**Script**: `D:\dasha\WORKSPACE\computer_use.py`

**Python**: `/c/Program Files/Python310/python.exe`

**Packages**: `pyautogui mss` (install with `pip install pyautogui mss --user`)



### Calling Convention



```bash

MSYS2_NO_PATHCONV=1 /c/Program\ Files/Python310/python.exe /d/dasha/WORKSPACE/computer_use.py <command> [args]

```



### Available Commands



| Command | Args | Description |

|---------|------|-------------|

| `capture --vision` | — | Screenshot as base64 JSON (for vision model) |

| `capture -o file.png` | path | Save screenshot to file |

| `click x y [button]` | x y left/right/middle | Click at coordinates |

| `doubleclick x y` | x y | Double click |

| `rightclick x y` | x y | Right click |

| `move x y` | x y | Move mouse to coordinates |

| `type "text"` | text to type | Type text (supports \n, \t) |

| `key keyname` | enter, escape, tab, etc. | Press a single key |

| `hotkey k1 k2 ...` | ctrl c, alt tab, etc. | Key combination |

| `scroll clicks` | +up / -down | Scroll |

| `drag x1 y1 x2 y2` | from→to | Drag |

| `position` | — | Get mouse position |

| `screen_size` | — | Get screen dimensions |

| `windows` | — | List open windows |

| `focus "title"` | partial title | Bring window to front |

| `wait seconds` | 2.0 | Wait N seconds |



### Key Names (pyautogui)



`enter`, `escape`, `tab`, `backspace`, `delete`, `space`, `home`, `end`, `pageup`, `pagedown`, `up`, `down`, `left`, `right`, `f1`-`f24`, `ctrl`, `alt`, `shift`, `win`, `caps_lock`, `num_lock`, `scroll_lock`, `insert`, `printscreen`, `pause`



### Technical Details



- **Screenshots**: `mss.MSS()` captures primary monitor (monitors[1]) — much faster than pyautogui.screenshot()

- **Mouse/Keyboard**: pyautogui with FAILSAFE=True (mouse to top-left corner = abort)

- **Window listing**: Embedded C# via PowerShell (Add-Type) enumerates Win32 windows

- **Window focus**: SetForegroundWindow via C#



### Workflow Pattern



1. **Capture**: `capture --vision` → get base64 screenshot

2. **Analyze**: Model sees screenshot, identifies UI elements + coordinates

3. **Act**: `click x y`, `type "text"`, `key enter`

4. **Verify**: Another `capture` to confirm result



### Pitfalls



- **Model MUST support vision** — Without vision capability you can't interpret screenshots

- **pyautogui.FAILSAFE** — moving mouse to (0,0) aborts the script

- **Screenshots are large** — 1920x1080 PNG ~200-250KB, base64 ~213K chars

- **mss only captures primary monitor**

- **Window focus may fail** on elevated/admin/UWP processes

- **No accessibility tree** — purely vision-based, no element-by-role/label finding



---



## Section 1b: Launching Windows GUI Apps from git-bash



When launching a Windows desktop GUI application from git-bash, the standard `start.exe` command may fail due to MSYS2 path translation mangling the Windows path. Here is the full troubleshooting chain:



### Pattern: Electron Desktop App Launch



**Step 1 — Check if the app is running:**

```bash

cmd.exe /c "tasklist /FI \"IMAGENAME eq dasha.exe\" /FO CSV /NH"

```



**Step 2 — Try to kill any existing process:**

```bash

cmd.exe /c "taskkill /F /FI \"IMAGENAME eq dasha.exe\"" 2>&1

```



**Step 3 — Attempt `start.exe`:**

```bash

MSYS2_NO_PATHCONV=1 /c/Windows/System32/start.exe "AppTitle" "C:\path\to\app.exe"

```

*If this fails with "No such file or directory" or similar MSYS2 translation errors, proceed to Step 4.*



**Step 4 — Use PowerShell Start-Process (most reliable):**

```bash

powershell.exe -ExecutionPolicy Bypass -Command "Start-Process 'C:\path\to\app.exe'"

```



**Step 5 — Verify the process actually started:**

```bash

# Wait a moment then check

sleep 3; cmd.exe /c "tasklist /NH /FO CSV" 2>&1 | grep -i "dasha\|electron\|node"

```



### Known Issue: Electron disk_cache Permission Error (0x5)



Electron-based apps (including the dasha desktop app) may crash immediately on launch with:

```

ERROR:net\disk_cache\cache_util_win.cc:25] Unable to move the cache: 拒绝访问。 (0x5)

ERROR:net\disk_cache\disk_cache.cc:236] Unable to create cache

ERROR:gpu\ipc\host\gpu_disk_cache.cc:724] Gpu Cache Creation failed: -2

```



**Root cause:** The Electron browser cache directory is locked or has restrictive permissions.

**Fix:** Delete or rename the cache directory before relaunching:

```

rmdir /s /q "%LOCALAPPDATA%\dasha\dasha-agent\Cache" 2>nul

rmdir /s /q "%LOCALAPPDATA%\dasha\dasha-agent\GPUCache" 2>nul

```

Then relaunch with `Start-Process` as shown above.



### Reference

See `references/windows-gui-app-launch.md` for the complete diagnostic flowchart.



---



## Section 2: Application Data Access



Investigate what data a local Windows desktop application stores and whether it can be read from git-bash + WSL.



### Investigation Pattern



#### Phase 1: Find the Application



```bash

# Is the app running?

cd /c/ && cmd.exe /c "tasklist /FI \"IMAGENAME eq AppName.exe\" /FO CSV /NH"



# Find install location

find /c/ -maxdepth 4 -name "AppName.exe" 2>/dev/null

find /d/ -maxdepth 4 -name "AppName.exe" 2>/dev/null

```



#### Phase 2: Find Data Directories



| Scope | git-bash Path |

|-------|---------------|

| User Roaming | `/c/Users/<user>/AppData/Roaming/Publisher/App/` |

| User Local | `/c/Users/<user>/AppData/Local/Publisher/App/` |

| Documents | `/c/Users/<user>/Documents/AppName/` |

| Documents (Weixin) | `/c/Users/<user>/Documents/xwechat_files/` |

| ProgramData | `/c/ProgramData/Publisher/App/` |



Also scan `Documents/` broadly:

```bash

ls "/c/Users/$USER/Documents/" | grep -iE "wechat|xwechat|qq|tencent|appname"

```



#### Phase 3: Scan for Storage Files



```bash

# SQLite databases

find "/c/Users/$USER/AppData/..." -name "*.db" 2>/dev/null | head -30



# LevelDB stores (CURRENT + MANIFEST files)

find "/c/Users/$USER/AppData/..." -name "CURRENT" -o -name "MANIFEST*" 2>/dev/null | head -20



# MMKV stores (Tencent)

find "/c/Users/$USER/AppData/..." -name "*.mmkv" 2>/dev/null | head -20



# Other data files

find "/c/Users/$USER/AppData/..." \( -name "*.dat" -o -name "*.store" -o -name "*.idx" \) 2>/dev/null | head -20



# Message/conversation directories

find "/c/Users/$USER/AppData/..." \( -name "msg" -o -name "message" -o -name "chat" -o -name "conversation" \) 2>/dev/null | head -20

```



#### Phase 4: Analyze Storage Format



| Format | Method |

|--------|--------|

| Unencrypted SQLite | Direct read with Python sqlite3 |

| Encrypted SQLite (key in memory) | Need process memory dump (Cheat Engine, pymem) |

| LevelDB | Python plyvel or leveldb package |

| MMKV | Tencent custom key-value — different format |

| Custom encrypted format | Requires reverse engineering |

| Memory-only keys | App must be running and authenticated |



#### Phase 5: Report Findings



- What the app is (name, version, install path)

- Where data is stored

- Storage format (encrypted? what type?)

- Whether we can access it and how

- What tools/techniques would be needed



### WeChat/Weixin Data Access — Quick Reference



Two fundamentally different versions:



**Old WeChat (v3.x)** — MicroMsg.db (SQLite + AES-256-CBC)

- Install: `C:\Program Files (x86)\Tencent\WeChat\`

- Data: `Documents\WeChat Files\<wxid>\Msg\MicroMsg.db`

- Key: 64-byte SQLite key in WeChat.exe process memory (well-documented)

- Extraction: Cheat Engine / pymem to find key → `PRAGMA key = '...'` → query MSG table

- Verdict: Feasible, well-established technique



**New Weixin (v4.x Radium)** — Custom LevelDB/RocksDB stores

- Install: `C:\Program Files\Tencent\Weixin\`

- Data: `%APPDATA%\Tencent\xwechat\` (NOT Documents)

- Storage: Custom Radium framework LevelDB stores, no MicroMsg.db

- Encryption: Custom Radium encryption, NOT standard AES-CBC

- Extraction: Not well-documented — requires reverse engineering

- Verdict: Possible but significant research needed



#### Downloaded Files (Weixin v4.x)



```filesystem

C:\Users\<user>\Documents\xwechat_files\

  +-- <username>_<md5_prefix>\

       +-- msg\

       |   +-- file\         # downloaded documents, original names, by month

       |   +-- video\        # videos, by month

       |   +-- attach\       # attachments in MD5-hash folders (no filename clues)

       +-- db_storage\

       +-- business\

       +-- cache\

       +-- config\

```



Quick check:

```bash

ls "/c/Users/$USER/Documents/xwechat_files/"

du -sh "/c/Users/$USER/Documents/xwechat_files/"*/

ls "/c/Users/$USER/Documents/xwechat_files/<account>/msg/file/YYYY-MM/"

```



#### Distinguish Old vs New



```bash

ls "/c/Program Files (x86)/Tencent/WeChat/WeChat.exe" 2>/dev/null && echo "OLD"

ls "/c/Program Files/Tencent/Weixin/Weixin.exe" 2>/dev/null && echo "NEW"

ls "/c/Users/$USER/Documents/WeChat Files/" 2>/dev/null && echo "HAS OLD DATA"

```



### Feasibility Assessment



| Condition | Feasibility |

|-----------|-------------|

| Unencrypted SQLite/LevelDB | High — can read directly |

| Encrypted SQLite (key in memory) | Medium — Cheat Engine/pymem |

| Encrypted custom format | Low — reverse engineering |

| App running with active session | Required for memory-based extraction |

| App not running | Can only read files, miss in-memory keys |



### Pitfalls



- **Weixin v4.x is NOT old WeChat** — don't assume MicroMsg.db extraction works

- **App must be running** for memory-based extraction

- **New app versions change storage format** — WeChat has changed format 3+ times

- **Cannot manipulate process memory from WSL/git-bash alone** — need native Windows tools

- **Encryption keys change per session** — need freshly authenticated app

- **Two accounts on same PC** = separate data directories and keys



---



## Section 3: Process Watchdog & Auto-Recovery



Set up crash-proof auto-recovery for Windows background processes using Task Scheduler + periodic health checks.



### Architecture



Two cooperating scheduled tasks:



1. **AutoStart** (`ONLOGON` trigger, 30s delay) — starts the process once at login

2. **Watchdog** (`MINUTE` trigger, every 3 min) — checks port/process, restarts if dead



The watchdog script does NOT stay resident — it runs briefly (< 3 seconds) and exits. The scheduler re-invokes it every 3 minutes.



### Key Technique: Detached Process Launch



Batch files and `Start-Process` kill child processes when the parent exits. **Use .NET Process.Start:**



```powershell

$psi = New-Object System.Diagnostics.ProcessStartInfo

$psi.FileName = "cmd.exe"

$psi.Arguments = '/c ""C:\path\to\service.cmd" start"'

$psi.UseShellExecute = $false

$psi.CreateNoWindow = $true

$psi.EnvironmentVariables["KEY"] = "value"

$p = [System.Diagnostics.Process]::Start($psi)

```



This creates a fully independent process that survives the PowerShell exit.



### Port-Based Health Check



```powershell

$listening = netstat -ano 2>$null | Select-String ":PORT "

if ($listening) {

    exit 0  # already running

}

# else: start the process

```



### Forcing Port Free (Kill Stuck Processes)



When a port shows "already in use" but normal `taskkill /F /IM python.exe` doesn't clear it (often due to orphaned daemon processes, services, or child/parent PID mismatches), use PowerShell's `Get-NetTCPConnection` to find and kill the exact owning process:



```powershell

# From PowerShell — most reliable method

$conn = Get-NetTCPConnection -LocalPort 8667 -ErrorAction SilentlyContinue

if ($conn) {

    Stop-Process -Id $conn.OwningProcess -Force

    Start-Sleep -Seconds 2

}

```



**Pitfalls:**

- **`$pid` is read-only in PowerShell** — use `$processId` or access via `$conn.OwningProcess` directly.

- **`netstat -ano | findstr :PORT` from git-bash often returns nothing** — the pipe between cmd.exe and findstr breaks in the MSYS2 translation layer. Use PowerShell Get-NetTCPConnection instead, or write a .ps1 file and execute with `powershell.exe -File`.

- **tasklist from git-bash shows "Microsoft Windows..." header only** — same MSYS2 pipe issue. The actual data is present but not displayed. Use PowerShell `Get-Process` instead.

- **Kill one, another takes over** — some setups auto-restart. Loop kill all Python processes then verify port is free before starting fresh.

- **start /B /MIN from git-bash creates orphan processes** — these survive the bash session but aren't manageable by normal `jobs` / `kill` commands. Use `Get-NetTCPConnection` to find them.



### Batch File Template With Auto-Clean



```batch

@echo off

chcp 65001 >nul

title Service Name



:: Auto-clean port before starting

netstat -ano | find "127.0.0.1:PORT" > "%TEMP%\port_check.txt"

for /f "tokens=5" %%a in (%TEMP%\port_check.txt) do (

    taskkill /F /PID %%a >nul 2>&1

    timeout /t 2 /nobreak >nul

)

del "%TEMP%\port_check.txt" 2>nul



:: Start the service

start "Service" "C:\Path\binary.exe" "arg1" "arg2"

timeout /t 10 /nobreak >nul

```



### Creating the Scheduled Task



Prevent git-bash from expanding `/TN`, `/TR` etc.:



```bash

MSYS2_ARG_CONV_EXCL=* cmd.exe /c schtasks /create \

  /TN MyWatchdog \

  /TR "cmd.exe /c powershell.exe -ExecutionPolicy Bypass -File D:\path\watchdog.ps1" \

  /SC MINUTE /MO 3 /IT /F

```



### Battery & Timeout Settings (via COM)



schtasks CLI doesn't expose these. Use PowerShell COM:



```powershell

$service = New-Object -ComObject "Schedule.Service"

$service.Connect()

$folder = $service.GetFolder("\")

$task = $folder.GetTask("TaskName")

$def = $task.Definition

$def.Settings.DisallowStartIfOnBatteries = $false

$def.Settings.StopIfGoingOnBatteries = $false

$def.Settings.ExecutionTimeLimit = "PT0S"   # no time limit

$folder.RegisterTaskDefinition("TaskName", $def, 4, $null, $null, $null)

```



### Watchdog PowerShell Script Template



```powershell

# watchdog.ps1 — checks port, restarts if down

$log = "$env:USERPROFILE\.service\watchdog.log"



$listening = netstat -ano 2>$null | Select-String ":PORT "

if ($listening) { exit 0 }



$ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"

"[$ts] watchdog: not running, starting..." | Out-File $log -Append



$psi = New-Object System.Diagnostics.ProcessStartInfo

$psi.FileName = "cmd.exe"

$psi.Arguments = '/c ""C:\path\to\service.cmd" start"'

$psi.UseShellExecute = $false

$psi.CreateNoWindow = $true

$p = [System.Diagnostics.Process]::Start($psi)

"[$ts] watchdog: started PID $($p.Id)" | Out-File $log -Append

```



### Pitfalls



- **MSYS2 path expansion**: Always use `MSYS2_ARG_CONV_EXCL=*` before schtasks

- **Batch file CALL kills children**: Must use .NET Process.Start, not `Start-Process`

- **Batch files: CRLF + encoding, two separate killers**: (1) `write_file` writes LF endings — cmd.exe needs CRLF, otherwise garbled `'orlevel' is not recognized` errors. Always embed `\r\n` per line and verify with `file script.bat` → "CRLF line terminators". (2) Chinese chars in `echo`/`REM` break cmd.exe when saved UTF-8 without BOM. See `references/batch-file-encoding.md`.

- **`start /B /MIN` from git-bash silently fails** — processes launched this way from bash die immediately (no error). The same `.bat` works when the user double-clicks it from Windows Explorer.

- **schtasks XML encoding**: If `/XML` declares `UTF-16` but file is UTF-8, import fails silently

- **Start-Process -Wait**: Hangs forever on daemon processes



---



## Section 4: Local Web GUI Builder



Build a local web-based GUI for PowerShell/system operations using Python stdlib + HTML/CSS/JS. Zero external dependencies — only Python and a browser needed.



### Architecture



```

start.bat ──→ Python backend (http.server, port 8666)

                   │

              ┌────┴────┐

              │         │

        GET /        POST /api/exec

      static/        runs PowerShell

    index.html       returns JSON

    style.css

    app.js

```



### When To Use



- User wants a GUI to run PowerShell scripts/commands

- User wants a visual tool for system management

- User wants something more polished than a cmd window but simpler than Electron



### Standard File Layout



```

ps-gui/

├── start.bat          ← Double-click to open browser

├── backend.py         ← Python HTTP server

└── static/

    ├── index.html     ← Frontend HTML

    ├── style.css      ← Green-themed UI

    └── app.js         ← Frontend logic

```



### Key Patterns



| Need | Pattern |

|------|---------|

| Execute PS command | `POST /api/exec {command: "..."}` → backend runs `subprocess.run(["powershell.exe", ...])` |

| Admin elevation | `admin: true` flag → backend wraps in `Start-Process -Verb RunAs` |

| Quick commands | JS map of `{name: "PS command string"}` → `setCmd()` fills the input |

| History | In-memory `history[]` array + localStorage persistence |

| System info | Series of short PS calls populated into info cards |

| Multiple views | Sidebar nav with show/hide sections |



### Reference



See `references/ps-gui-builder.md` for complete code templates and patterns.



---



## Section 5: WampServer / Apache + MariaDB Service Management



Start and manage WampServer services (Apache HTTPD + MariaDB/MySQL) on Windows from git-bash.



### When To Use



- User asks to open/start their local WampServer or personal website

- User reports "Apache not running" or "site not loading"

- You need to start/restart the local PHP/MySQL development stack



### Detect Current State



```bash

# Check if Apache is running

cd /c/ && cmd.exe /c "tasklist /FI \"IMAGENAME eq httpd.exe\" /FO CSV /NH"



# Check if MariaDB/MySQL is running

cd /c/ && cmd.exe /c "tasklist /FI \"IMAGENAME eq mysqld.exe\" /FO CSV /NH"



# Check by port

cd /c/ && cmd.exe /c "netstat -ano | findstr :80"

cd /c/ && cmd.exe /c "netstat -ano | findstr :3306"

```



### Verify WampServer Installation



```bash

# Find Apache binary

ls <WAMP_ROOT>/bin/apache/apache*/bin/httpd.exe



# Find MariaDB/MySQL binary and version

ls <WAMP_ROOT>/bin/mariadb/*/bin/mysqld.exe

# Result gives you the INSTALLED version (e.g. mariadb11.5.2), NOT a guess

```



### Start Services



#### Write a PowerShell script (do NOT try direct cmd.exe — it won't keep services alive)



```powershell

# start_wampserver.ps1

Write-Host "Starting Apache..."

Start-Process -FilePath "<WAMP_ROOT>\bin\apache\apache2.4.62.1\bin\httpd.exe" -ArgumentList "-k start" -WindowStyle Hidden



Write-Host "Starting MariaDB..."

# ⚠️ Get the ACTUAL version from ls <WAMP_ROOT>/bin/mariadb/ — may differ from examples

Start-Process -FilePath "<WAMP_ROOT>\bin\mariadb\mariadb11.5.2\bin\mysqld.exe" -ArgumentList "--defaults-file=<WAMP_ROOT>\bin\mariadb\mariadb11.5.2\my.ini" -WindowStyle Hidden



Start-Sleep -Seconds 3



# Verify

$apache = Get-Process httpd -ErrorAction SilentlyContinue

$mysql = Get-Process mysqld -ErrorAction SilentlyContinue

if ($apache) { Write-Host "✅ Apache running (PID: $($apache.Id))" }

else { Write-Host "❌ Apache not running" }

if ($mysql)  { Write-Host "✅ MariaDB running (PID: $($mysql.Id))" }

else { Write-Host "❌ MariaDB not running" }

```



Execute from git-bash:



```bash

powershell.exe -ExecutionPolicy Bypass -File "D:\dasha\WORKSPACE\start_wampserver.ps1"

```



### Access the Website



Once running, the user can open in their Windows browser:

- `http://localhost/your-site/`

- `https://192.168.10.72/your-site/` (HTTPS + WebRTC capable)



### Verify from git-bash



Cannot access `http://localhost/` from git-bash/WSL — WSL's localhost is its own, not Windows'. Use the Windows IP or check processes.



### Pitfalls



- **`wampmanager.exe` starts the tray icon only** — it does NOT start Apache or MariaDB. You must start the service binaries directly.

- **MariaDB version changes between WampServer reinstalls** — ALWAYS check the actual directory: `ls <WAMP_ROOT>/bin/mariadb/` . The old version path (e.g. 11.3.2) may be stale after an update.

- **`my.ini` path is version-specific** — use `<WAMP_ROOT>\bin\mariadb\mariadb<VERSION>\my.ini`

- **Start-Process -WindowStyle Hidden** is required — without it PowerShell hangs on the process.

- **Multiple httpd.exe processes is normal** — Apache spawns worker processes, 2-3 PIDs is expected.

- **Cannot use net start/stop** — WampServer's Apache and MariaDB may not be installed as Windows services; they run as regular processes.



---



## Section 6: SQLite Database Recovery



Recover data from a corrupted SQLite database when `PRAGMA integrity_check` returns `malformed`.



### When To Use

- A dasha internal database (`state.db`, `sessions.db`) reports `database disk image is malformed`

- Any SQLite `.db` file that fails to open or query normally



### Recovery Strategy



1. **Find the right file** — dasha stores sessions in `C:\Users\<user>\AppData\Local\dasha\state.db` (NOT `~/.dasha/state.db` — that's a different file)



2. **Try read-only URI mode first** — This bypasses WAL locks and some corruption:

   ```python

   uri = f"file:{db_path}?mode=ro"

   con = sqlite3.connect(uri, uri=True)

   ```



3. **Identify which columns are corrupted** — `SELECT *` may fail while individual columns succeed:

   ```python

   columns = ['id', 'session_id', 'role', 'content']  # etc.

   good_cols = []

   for col in columns:

       try:

           con.execute(f'SELECT {col} FROM table LIMIT 1')

           good_cols.append(col)

       except:

           print(f'Column {col} is corrupted')

   ```



4. **Read good data row by row** — skip rows that fail:

   ```python

   rows = []

   for row_id, in con.execute('SELECT id FROM table'):

       try:

           r = con.execute(f'SELECT {",".join(good_cols)} FROM table WHERE id=?', (row_id,))

           rows.append(r.fetchone())

       except:

           pass  # skip corrupted row

   ```



5. **Rebuild the database** — create a fresh DB with the same schema, insert recovered data, rebuild FTS indexes:

   ```python

   new_con = sqlite3.connect(fixed_path)

   new_con.execute('''CREATE TABLE ...''')  # original schema

   for r in rows:

       new_con.execute('INSERT INTO ...', r)

   # Rebuild FTS indexes

   new_con.execute('INSERT INTO messages_fts(messages_fts) VALUES(\"rebuild\")')

   ```



6. **Replace the original** — stop the process using it, copy the fixed file over.



### Pitfalls



- **Don't fix `~/.dasha/state.db`** — it's a different file from `C:\Users\<user>\AppData\Local\dasha\state.db`. Check which one the tool actually uses.

- **WAL files persist** — after replacing the DB, delete the old `state.db-wal` and `state.db-shm` files, or the old WAL will replay corrupted data into the new DB.

- **dasha process holds a cached connection** — even after replacing the file, the running dasha process may still see the old corruption via its in-memory WAL cache. Restart the process.

- **Replacing corrupted columns** — use `NULL` or default values for columns that can't be read.

- **FTS virtual tables need rebuild** — just creating the table isn't enough; call `INSERT INTO fts_table(fts_table) VALUES('rebuild')`.



---



## Section 7: Service Lifecycle — Manual Start/Stop Scripts



When the user needs *manual* control over a service (not watchdog/auto-restart), provide **two separate PowerShell scripts** — one for stop, one for start. The user explicitly prefers separate scripts over a combined toggle or single script with both functions.



### When To Use This Pattern



- User asks for "停止" and "启动" scripts separately

- User wants to manually start/stop a background service (dasha-web-ui, gateway, etc.)

- User has disabled auto-recovery/watchdog and wants manual control



### Pattern: Port-Based Lifecycle Scripts



Both scripts use `netstat -ano | Select-String ":PORT "` to detect whether the service is running, then act accordingly.



#### Stop Script Template



```powershell

$port = 8648

$proc = netstat -ano | Select-String ":$port "

if (-not $proc) { Write-Host "服务没有在运行" -ForegroundColor Yellow; exit 0 }

foreach ($line in $proc) {

    $pid = $line -replace '.*\s+(\d+)\s*$','$1'

    if ($pid) { taskkill /F /PID $pid 2>$null; Write-Host "已停止 PID: $pid" -ForegroundColor Green }

}

Start-Sleep -Seconds 1

$still = netstat -ano | Select-String ":$port "

if ($still) { Write-Host "残留进程，强杀主进程..." -ForegroundColor Red; taskkill /F /IM node.exe }

else { Write-Host "服务已停止" -ForegroundColor Green }

```



Key design choices:

- `foreach` loop handles multiple PIDs (multiple connections on the same port)

- After kill, waits 1s and re-checks for orphan processes

- Falls back to `taskkill /F /IM processName.exe` if port still occupied

- Says "没有在运行" and exits 0 if nothing was bound — idempotent



#### Start Script Template



```powershell

$port = 8648

if (netstat -ano | Select-String ":$port ") {

    Write-Host "端口 $port 已被占用" -ForegroundColor Yellow

    exit 1

}

Write-Host "正在启动服务..." -ForegroundColor Cyan

$env:KEY_ENV_VAR = "C:\path\to\required\config"

Start-Process -WindowStyle Hidden -FilePath "node.exe" -ArgumentList "C:\path\to\server\index.js"

$ready = $false

for ($i = 1; $i -le 15; $i++) {

    Start-Sleep -Seconds 1

    if (netstat -ano | Select-String ":$port ") { $ready = true; break }

    Write-Host "  等待中... ${i}s" -ForegroundColor Gray

}

if ($ready) { Write-Host "`n服务已启动！http://localhost:$port" -ForegroundColor Green }

else { Write-Host "`n启动超时" -ForegroundColor Red }

```



Key design choices:

- Checks port availability first — exits 1 with message if already running

- Sets required env vars in the script scope before launching

- Uses `Start-Process -WindowStyle Hidden` for the daemon

- Polls port every 1s for up to 15s with progress feedback

- Reports URL on success



### Pitfalls



- **Don't use .NET Process.Start for manual scripts** — that pattern is for watchdog (detached from parent). Manual scripts should use `Start-Process` so the user can see it's running.

- **Port detection from git-bash** — execute via `powershell.exe -File .ps1`, not inline PowerShell. Inline pipes break in MSYS2.

- **env vars set in PowerShell script scope** — they only survive for the launch, not for the daemon's full lifetime. The daemon process reads them at spawn time.

- **If both scripts exist in the same directory**, name consistently: `<service>-stop.ps1` and `<service>-start.ps1`.



---



## Section 8: References Summary



| Section | Reference |

|---------|-----------|

| Computer-use commands | `references/computer-use-commands.md` |

| WampServer startup | `references/wampserver-startup.md` |

| Windows GUI app launch | `references/windows-gui-app-launch.md` |

| Batch file encoding | `references/batch-file-encoding.md` |

| PS GUI builder | `references/ps-gui-builder.md` |

| dasha Web UI watchdog | `references/dasha-web-ui-watchdog-setup.md` |