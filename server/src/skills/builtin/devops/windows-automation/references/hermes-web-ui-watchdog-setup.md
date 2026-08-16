# dasha Web UI Watchdog Setup (2026-05-24)

## Files

### Watchdog PowerShell Script — `D:\dasha\WORKSPACE\dasha-web-ui-watchdog.ps1`

```powershell
# dasha-web-ui watchdog - detects crash and auto-restarts
$log = "$env:USERPROFILE\.dasha-web-ui\watchdog.log"
$env:dasha_AGENT_ROOT = "C:\Users\your-user\AppData\Local\dasha\dasha-agent"

# check if port 8648 is already in use
$listening = netstat -ano 2>$null | Select-String ":8648 "
if ($listening) {
    exit 0
}

# not running - start it using .NET Process (fully detached)
$ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
"[$ts] watchdog: dasha-web-ui not running, starting..." | Out-File $log -Append

$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = "cmd.exe"
$psi.Arguments = '/c ""C:\Users\your-user\AppData\Roaming\npm\dasha-web-ui.cmd" start"'
$psi.UseShellExecute = $false
$psi.CreateNoWindow = $true
$psi.EnvironmentVariables["dasha_AGENT_ROOT"] = "C:\Users\your-user\AppData\Local\dasha\dasha-agent"
$p = [System.Diagnostics.Process]::Start($psi)
"[$ts] watchdog: start command sent" | Out-File $log -Append
$p.WaitForExit(5000)
"[$ts] watchdog: cmd.exe exited with code $($p.ExitCode)" | Out-File $log -Append
```

### Batch Wrapper — `D:\dasha\WORKSPACE\dasha-web-ui-start.bat`

```batch
@echo off
SET dasha_AGENT_ROOT=C:\Users\your-user\AppData\Local\dasha\dasha-agent
ECHO dasha_AGENT_ROOT=%dasha_AGENT_ROOT%
CALL C:\Users\your-user\AppData\Roaming\npm\dasha-web-ui.cmd start
```

## Scheduled Tasks

| Task | Trigger | Action |
|------|---------|--------|
| dashaWebUI-AutoStart | At logon + 30s delay | `D:\dasha\WORKSPACE\dasha-web-ui-start.bat` |
| dashaWebUI-Watchdog | Every 3 min, indefinite | `cmd.exe /c powershell.exe -ExecutionPolicy Bypass -File D:\dasha\WORKSPACE\dasha-web-ui-watchdog.ps1` |

### Create Commands

```bash
# Logon task
MSYS2_ARG_CONV_EXCL=* cmd.exe /c schtasks /create /TN dashaWebUI-AutoStart /TR "D:\dasha\WORKSPACE\dasha-web-ui-start.bat" /SC ONLOGON /DELAY 0000:30 /IT /F

# Watchdog task
MSYS2_ARG_CONV_EXCL=* cmd.exe /c schtasks /create /TN dashaWebUI-Watchdog /TR "cmd.exe /c powershell.exe -ExecutionPolicy Bypass -File D:\dasha\WORKSPACE\dasha-web-ui-watchdog.ps1" /SC MINUTE /MO 3 /IT /F

# Fix battery + timeout settings (run via PowerShell script or inline via COM)
powershell.exe -ExecutionPolicy Bypass -Command ...
```

## Access

- URL: http://localhost:8648/#/?token=6330f2f5484c8cc6b1efa242af5853267bc4ba7916257ecd80826880ee8394a6
- Status: `dasha-web-ui status` (from git-bash) or check PID file at `C:\Users\your-user\.dasha-web-ui\server.pid`
- Watchdog log: `C:\Users\your-user\.dasha-web-ui\watchdog.log`

---

## Manual Management Scripts (2026-06-04)

When the user wants **manual** start/stop (not watchdog/auto-restart), provide **two separate scripts**. These live alongside the watchdog scripts at `D:\dasha\WORKSPACE\`.

### Stop Script — `D:\dasha\WORKSPACE\dasha-web-ui-stop.ps1`

```powershell
$port = 8648
$proc = netstat -ano | Select-String ":$port "
if (-not $proc) { Write-Host "dasha-web-ui 没有在运行" -ForegroundColor Yellow; exit 0 }
foreach ($line in $proc) {
    $pid = $line -replace '.*\s+(\d+)\s*$','$1'
    if ($pid) { taskkill /F /PID $pid 2>$null; Write-Host "已停止 PID: $pid" -ForegroundColor Green }
}
Start-Sleep -Seconds 1
$still = netstat -ano | Select-String ":$port "
if ($still) { Write-Host "残留进程，强杀 node.exe..." -ForegroundColor Red; taskkill /F /IM node.exe }
else { Write-Host "dasha-web-ui 已停止" -ForegroundColor Green }
```

### Start Script — `D:\dasha\WORKSPACE\dasha-web-ui-start.ps1`

```powershell
$port = 8648
if (netstat -ano | Select-String ":$port ") {
    Write-Host "端口 $port 已被占用" -ForegroundColor Yellow
    exit 1
}
Write-Host "正在启动 dasha-web-ui..." -ForegroundColor Cyan
$env:dasha_AGENT_ROOT = "C:\Users\your-user\AppData\Local\dasha\dasha-agent"
Start-Process -WindowStyle Hidden -FilePath "node.exe" -ArgumentList "C:\Users\your-user\AppData\Roaming\npm\node_modules\dasha-web-ui\dist\server\index.js"
$ready = $false
for ($i = 1; $i -le 15; $i++) {
    Start-Sleep -Seconds 1
    if (netstat -ano | Select-String ":$port ") { $ready = $true; break }
    Write-Host "  等待中... ${i}s" -ForegroundColor Gray
}
if ($ready) { Write-Host "`ndasha-web-ui 已启动！http://localhost:$port" -ForegroundColor Green }
else { Write-Host "`n启动超时，检查日志" -ForegroundColor Red }
```

### Execution from git-bash

```bash
# Stop
powershell.exe -ExecutionPolicy Bypass -File "D:\dasha\WORKSPACE\dasha-web-ui-stop.ps1"

# Start
powershell.exe -ExecutionPolicy Bypass -File "D:\dasha\WORKSPACE\dasha-web-ui-start.ps1"
```

### Differences from Watchdog Script

| Aspect | Watchdog (`-watchdog.ps1`) | Manual (`-stop.ps1` / `-start.ps1`) |
|--------|---------------------------|--------------------------------------|
| Purpose | 3-min auto-restart | User-initiated control |
| Process launch | .NET Process.Start (fully detached) | Start-Process -WindowStyle Hidden |
| Port check on start | No (exits 0 if running) | Yes (exits 1 with error msg) |
| Wait/verify loop | No (exits immediately) | Yes (15s poll loop with progress) |
| Kill method | None (only start) | taskkill /F /PID → fallback to /IM |
| Multiple PID handling | Single netstat check | foreach loop over all matches |
