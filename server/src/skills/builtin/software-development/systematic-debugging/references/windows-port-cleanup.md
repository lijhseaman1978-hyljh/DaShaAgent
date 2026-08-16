# Windows Port Conflict Resolution

When a port is "in use" but `taskkill /F /IM python.exe` doesn't clear it, or `netstat` shows no process but the port is still occupied.

## Preferred: PowerShell Get-NetTCPConnection

```powershell
$conn = Get-NetTCPConnection -LocalPort 8667 -ErrorAction SilentlyContinue
if ($conn) {
    $processId = $conn.OwningProcess
    Write-Host "Port 8667 is in use by PID $processId"
    $proc = Get-Process -Id $processId -ErrorAction SilentlyContinue
    if ($proc) {
        Write-Host "Process: $($proc.ProcessName) (PID $processId)"
    }
    Stop-Process -Id $processId -Force
    Start-Sleep -Seconds 2
}
```

**Important:** Use variable name `$processId` or `$owningPid`, NOT `$pid` — `$pid` is a PowerShell automatic variable (current process ID) and is read-only.

## Fallback: Kill All Python Processes

```cmd
taskkill /F /IM python.exe
```

This works when port info is unavailable but you know the process type.

## Why Ports Get Stuck (Common Windows Issues)

1. **Orphaned child processes** — When a terminal/background process manager dies, child Python processes may survive without a parent. They continue holding the port.
2. **Different user sessions** — A process started by `your-user` (Windows user) won't show in `tasklist` run from `your-user` (WSL user). Use PowerShell's `Get-Process` which crosses session boundaries.
3. **Windows service wrapping** — Some tools register themselves as Windows services that auto-restart when killed via `taskkill /F /IM`.

## Reliable Cleanup Script

Save this as `kill_port_XXXX.ps1`:

```powershell
$port = 8667
$connection = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue
if ($connection) {
    $processId = $connection.OwningProcess
    Write-Host "Port $port in use by PID $processId"
    Stop-Process -Id $processId -Force
    Start-Sleep -Seconds 2
    $check = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue
    if (-not $check) {
        Write-Host "Port $port is now free"
    } else {
        Write-Host "Still in use by new PID $($check.OwningProcess)"
    }
} else {
    Write-Host "Port $port is already free"
}
```

Run with:
```bash
MSYS2_NO_PATHCONV=1 powershell.exe -ExecutionPolicy Bypass -File "D:\path\to\script.ps1"
```

## For start.bat files: Auto-clean before starting

```
netstat -ano | find "127.0.0.1:8667" > "%TEMP%\port_check.txt"
for /f "tokens=5" %%a in (%TEMP%\port_check.txt) do (
    echo Found PID %%a on port, killing...
    taskkill /F /PID %%a >nul 2>&1
    timeout /t 2 /nobreak >nul
)
```
