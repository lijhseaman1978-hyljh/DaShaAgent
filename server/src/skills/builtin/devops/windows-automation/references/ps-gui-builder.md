# PowerShell GUI Builder — HTML + Python Backend

Pattern for building a local web-based GUI for PowerShell/system operations, usable from any modern browser. Zero additional dependencies (uses Python stdlib).

## Architecture

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

## Standard File Layout

```
ps-gui/
├── start.bat        ← Double-click to launch (opens browser automatically)
├── backend.py       ← Python HTTP server (stdlib only)
└── static/
    ├── index.html   ← Frontend HTML
    ├── style.css    ← Green-themed UI
    └── app.js       ← Frontend logic (fetch API + DOM)
```

## Backend (backend.py)

### Key Structure

```python
import http.server, json, subprocess, urllib.parse, os

class PSHandler(http.server.BaseHTTPRequestHandler):

    def do_GET(self):
        # / → serve index.html
        # /static/* → serve static files
        # /api/health → {"status":"ok"}

    def do_POST(self):
        # /api/exec → run PowerShell command
        body: {"command":"...", "admin":false}
        returns: {"success":true, "stdout":"...", "stderr":"...", "exit_code":0}

    def run_powershell(self, cmd, admin=False):
        if admin:
            ps_code = f'Start-Process powershell -Verb RunAs ...'
        else:
            ps_code = cmd
        p = subprocess.run(
            ["powershell.exe", "-NoProfile", "-Command", ps_code],
            capture_output=True, text=True, timeout=60
        )
```

### Important Setup Details

- Use `socketserver.ThreadingTCPServer` for concurrent requests (parallel health checks, system info loading)
- Set `server.allow_reuse_address = True` for quick restarts
- CORS headers on all responses (`Access-Control-Allow-Origin: *`)
- File serving: map extensions to Content-Type manually (`.html`, `.css`, `.js`)
- OS-agnostic paths: use `os.path.join(os.path.dirname(__file__), "static", filename)` for the static dir

### Launch script

```batch
@echo off
start "" "http://127.0.0.1:8666"
"C:\Program Files\Python310\python.exe" "D:\dasha\WORKSPACE\ps-gui\backend.py"
pause
```

Port 8666 is the standard choice — unlikely to conflict with common services.

## Frontend Patterns

### View Switching (Multi-Page SPA)

Sidebar with nav items, each linked to a `<section>` view:

```html
<aside id="sidebar">
  <a class="nav-item" data-view="console" onclick="switchView('console')">⌨ 命令终端</a>
  <a class="nav-item" data-view="launcher" onclick="switchView('launcher')">🚀 快速启动</a>
  ...
</aside>
<main>
  <section id="view-console" class="view active">...</section>
  <section id="view-launcher" class="view">...</section>
  ...
</main>
```

```javascript
function switchView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('view-' + name).classList.add('active');
  document.querySelector(`.nav-item[data-view="${name}"]`).classList.add('active');
}
```

### Pattern 1: Categorized Quick Commands (Collapsible)

Define commands as a JS object with category groups, each command having a label and PS command string. Render as collapsible sections below the input box:

```javascript
const QUICK_CMDS = {
  "dasha 命令": [
    { label: "版本", cmd: "dasha --version" },
    { label: "配置查看", cmd: "Get-Content $env:USERPROFILE\\.dasha\\config.yaml | Select-Object -First 30" },
  ],
  "Web UI 命令": [
    { label: "状态", cmd: "dasha-web-ui status" },
    { label: "启动", cmd: "dasha-web-ui start" },
  ],
  "进程管理": [
    { label: "CPU Top 15", cmd: "Get-Process | Sort-Object CPU -Descending | Select -First 15 ..." },
  ],
  ...  // up to 10+ categories
};
```

Rendering: each category becomes a collapsible section with toggle. Clicking a command fills the input AND auto-executes:

```javascript
function runQuickCmd(cmd) {
  document.getElementById('cmdInput').value = cmd;
  executeCmd();  // auto-run
}
```

Each command button shows label + truncated command string for preview.

### Pattern 2: Launcher / Service Status Panel

Poll backend to check if services are running (via port detection), show green/gray indicator:

```javascript
async function loadLauncherStatus() {
  const services = [
    { id: 'webui', label: 'dasha Web UI (8648)',
      check: 'netstat -ano | Select-String ":8648.*LISTENING"' },
    { id: 'gateway', label: 'dasha Gateway',
      check: 'Get-Process node ... | Where-Object CommandLine -match gateway' },
    { id: 'ollama', label: 'Ollama (11434)',
      check: 'netstat -ano | Select-String "11434.*LISTENING"' },
  ];
  for (const svc of services) {
    const res = await fetch('/api/exec', {method:'POST', body: JSON.stringify({command: svc.check})});
    const data = await res.json();
    const running = data.success && data.stdout?.length > 0;
    renderCard(svc, running);  // green dot + Start/Stop buttons
  }
}
```

Each card shows: status dot (green/gray), service name, and Start/Stop buttons that call `runQuickCmd()`.

### Pattern 3: Script Library with Categories

A grid of script cards, organized by category collapsibles. Define categories + keys:

```javascript
const SCRIPT_CATEGORIES = {
  "dasha 命令": ['dasha-version','dasha-config','dasha-skills'],
  "Ollama": ['ollama-list','ollama-ps','ollama-pull-qwen'],
  "磁盘分析": ['disk-usage','d-drive-big','big-files'],
  ...
};

const SCRIPT_MAP = {
  'dasha-version': 'dasha --version',
  'ollama-list': 'ollama list',
  'disk-usage': 'Get-PSDrive -PSProvider FileSystem | Format-Table ...',
  ...
};
```

Each card shows an emoji icon (mapped by key prefix), name, and truncated command preview.

### Pattern 4: System Info Grid

Run a series of short PowerShell commands in serial, each populating a card:

```javascript
const cmds = [
  { label: '操作系统', cmd: '(Get-WmiObject Win32_OperatingSystem).Caption' },
  { label: 'CPU', cmd: '(Get-WmiObject Win32_Processor).Name' },
  { label: '内存', cmd: '[math]::Round((Get-WmiObject Win32_ComputerSystem).TotalPhysicalMemory/1GB, 2)' },
  { label: '显卡', cmd: "(Get-WmiObject Win32_VideoController).Name -join '; '" },
  { label: '开机时长', cmd: "(Get-Date) - (Get-CimInstance Win32_OperatingSystem).LastBootUpTime | ..." },
  ...
];
```

### Pattern 5: Command History

Maintain `history[]` in JS. Render as clickable list items that refill the input. Store in localStorage for persistence across page refreshes. Support ↑/↓ arrow key navigation through `cmdHistory[]`.

## Power Tip: Service Status Detection Commands

| What to Check | PowerShell Command |
|---|---|
| Port listening | `netstat -ano \| Select-String ":PORT.*LISTENING"` |
| Process running | `Get-Process -Name procname -ErrorAction SilentlyContinue` |
| Process with command line | `Get-CimInstance Win32_Process -Filter "Name like 'proc%'" \| Select ProcessId,CommandLine` |
| Service status | `Get-Service servicename \| Format-List Name,Status,StartType` |
| GPU utilization | `nvidia-smi --query-gpu=name,temperature.gpu,utilization.gpu,memory.used,memory.total --format=csv` |

## One-Click Actions (Big Buttons)

Use large, prominent buttons for common admin operations:

```html
<button onclick="runQuickCmd('dasha-web-ui restart')">🔄 重启 Web UI</button>
<button onclick="runQuickCmd('dasha gateway restart')">🔄 重启网关</button>
<button onclick="runQuickCmd('ollama stop')">⏹ 停止 Ollama</button>
<button onclick="runQuickCmd('nvidia-smi')">🎮 GPU 状态</button>
```

## Design System

- **Theme**: Green/earthy (match user's visual preference): `#f0f8e8` page, `#f5fbf0` cards, `#689f38` accent
- **Font**: System stack with monospace fallback for command output
- **Terminal output**: Dark background (`#1a1e1a`), green-ish text (`#d4e8cc`)
- **Animations**: Subtle hover effects, collapsible toggle rotation, status dot pulse
- **Scrollbar**: Thin, themed (`width:6px`)

## Port Choice

Standard: **8666** for the Python backend. Not a common service port, safe from conflicts.

## Pitfalls

1. **Multiple server instances** — Killing from git-bash can leave orphaned processes. Always `netstat -ano | findstr :PORT` to verify clean state before restarting.
2. **git-bash curl can't reach 127.0.0.1:PORT** — Use PowerShell `Invoke-WebRequest` for local testing from the same box.
3. **PowerShell quoting** — Backslash-escape `$env:VAR` in PS strings passed via the API.
4. **Timeout on long commands** — Default 60s in backend; increase for large outputs.
5. **Admin elevation** — `Start-Process -Verb RunAs` triggers UAC, which requires user interaction and exits immediately (won't return output to the non-elevated caller).
