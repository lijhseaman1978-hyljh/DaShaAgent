# WampServer Service Startup



Working PowerShell scripts for starting Apache + MariaDB on this machine (YOUR_SITE, RTX 5060).



## WampServer Installation Paths (Windows 10)



| Component | Path |

|-----------|------|

| Apache | `<WAMP_ROOT>\bin\apache\apache2.4.62.1\` |

| MariaDB | `<WAMP_ROOT>\bin\mariadb\mariadb11.5.2\` |

| PHP | `<WAMP_ROOT>\bin\php\php8.2.26\` |

| MySQL (alt) | `<WAMP_ROOT>\bin\mysql\mysql8.4.0\` (not used — MariaDB is active) |

| my.ini | `<WAMP_ROOT>\bin\mariadb\mariadb11.5.2\my.ini` |

| PHP error log | `<WAMP_ROOT>\logs\php_error.log` |



> **⚠️ IMPORTANT**: MariaDB VERSION can change after reinstall. Always verify with `ls <WAMP_ROOT>/bin/mariadb/` before starting.



## Full Startup Script



Saved as `D:\dasha\WORKSPACE\start_wampserver.ps1`:



```powershell

# Start WampServer Apache + MariaDB

Write-Host "Starting WampServer Apache..." -NoNewline

Start-Process -FilePath "<WAMP_ROOT>\bin\apache\apache2.4.62.1\bin\httpd.exe" `

    -ArgumentList "-k start" -WindowStyle Hidden

Write-Host " OK"



Write-Host "Starting WampServer MariaDB..." -NoNewline

Start-Process -FilePath "<WAMP_ROOT>\bin\mariadb\mariadb11.5.2\bin\mysqld.exe" `

    -ArgumentList "--defaults-file=<WAMP_ROOT>\bin\mariadb\mariadb11.5.2\my.ini" `

    -WindowStyle Hidden

Write-Host " OK"



Start-Sleep -Seconds 3



# Verify

$apache = Get-Process httpd -ErrorAction SilentlyContinue

$mysql = Get-Process mysqld -ErrorAction SilentlyContinue



if ($apache) {

    Write-Host "✅ Apache running (PID: $($apache.Id))"

} else {

    Write-Host "❌ Apache not running"

}

if ($mysql) {

    Write-Host "✅ MariaDB running (PID: $($mysql.Id))"

} else {

    Write-Host "❌ MariaDB not running"

}

```



## MariaDB-Only Startup



If Apache is already running:



```powershell

Write-Host "Starting WampServer MariaDB..." -NoNewline

Start-Process -FilePath "<WAMP_ROOT>\bin\mariadb\mariadb11.5.2\bin\mysqld.exe" `

    -ArgumentList "--defaults-file=<WAMP_ROOT>\bin\mariadb\mariadb11.5.2\my.ini" `

    -WindowStyle Hidden

Write-Host " OK"



Start-Sleep -Seconds 3

$apache = Get-Process httpd -ErrorAction SilentlyContinue

$mysql = Get-Process mysqld -ErrorAction SilentlyContinue

if ($apache) { Write-Host "✅ Apache running (PID: $($apache.Id))" }

else { Write-Host "❌ Apache not running" }

if ($mysql)  { Write-Host "✅ MariaDB running (PID: $($mysql.Id))" }

else { Write-Host "❌ MariaDB not running" }

```



## Execution from git-bash



```bash

powershell.exe -ExecutionPolicy Bypass -File "D:\dasha\WORKSPACE\start_wampserver.ps1"

```



## Process Detection from git-bash



```bash

cd /c/ && cmd.exe /c "tasklist /FI \"IMAGENAME eq httpd.exe\" /FO CSV /NH"

cd /c/ && cmd.exe /c "tasklist /FI \"IMAGENAME eq mysqld.exe\" /FO CSV /NH"

```



## Website Access



Once running, user opens in Windows browser:

- **http://localhost/your-site/** (HTTP)

- **https://192.168.10.72/your-site/** (HTTPS, for WebRTC/voice chat)



## Key Lessons



1. **`wampmanager.exe` starts only the tray icon** — does NOT start Apache or MariaDB

2. **Apache: `httpd.exe -k start`** — produces 2-3 worker processes, that's normal

3. **MariaDB version must match actual install** — check the bin directory before hardcoding paths

4. **`Start-Process -WindowStyle Hidden` required** — without it the shell hangs

5. **Cannot `cd /c/` from git-bash sometimes** — use full path in -File argument instead

