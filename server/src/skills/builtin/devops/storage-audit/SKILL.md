---

name: storage-audit

description: "Systematic disk usage analysis: survey drive contents, categorize by purpose/status, identify duplicates/leftovers, estimate reclaimable space, and produce organized cleanup recommendations. User-driven — nothing is deleted without explicit confirmation."

version: 1.0.0

author: dasha

license: MIT

platforms: [windows, linux, macos]

metadata:

  dasha:

    tags:

      - disk-usage

      - cleanup

      - storage-analysis

      - software-inventory

    category: devops

---



# Storage Audit



Systematic approach to understanding what's on a drive, what's usable vs obsolete, and what can be safely removed.



## When to Use



- User says "我的D盘好乱" / "帮我看看D盘有什么" / "D盘空间不够了"

- User asks what software/tools they have installed

- User wants to clean up old projects, duplicates, or unused installations

- User asks "这个文件夹有用吗" / "这个可以删掉吗"



## Core Workflow



### Step 1: Survey the Drive Root



```bash

# Linux/macOS

ls -la /

du -sh /*/ 2>/dev/null | sort -rh



# Windows (git-bash / MSYS)

ls -la /d/

```



Identify system folders first:

- `$RECYCLE.BIN` — Windows Recycle Bin (system-managed). **Can be accessed if user needs files from it** — see "Accessing Windows Protected System Folders" below.

- `System Volume Information` — VSS/restore points (system-managed). **Can be accessed** — see dedicated section below.

- `Config.Msi` / `MSOCache` — MSI install caches (can be deleted, requires elevation)

- `WindowsApps` — Store apps (system-managed)

- `Program Files` / `Program Files (x86)` / `ProgramData` — only audit if user asks



### Step 2: Size the Major Directories



**Preferred method — PowerShell script (Windows, git-bash):**

`du` is slow on large Windows dirs (Users, Windows, AppData) and times out frequently. Use PowerShell via a temp .ps1 file:



```bash

# Write the sizing script

write_file(

    path="/c/Temp/get_size.ps1",

    content='''$path = "C:\\TargetDir"

$size = (Get-ChildItem $path -Recurse -ErrorAction SilentlyContinue -Force | Measure-Object -Property Length -Sum).Sum

$gb = [math]::Round($size / 1GB, 2)

Write-Output "$path : $gb GB"

'''

)



# Execute it

cd /c/Temp && powershell.exe -ExecutionPolicy Bypass -File "C:/Temp/get_size.ps1"

```



For drilling into AppData (the biggest user space), write a script that enumerates subfolders and sorts by size:



```powershell

$items = Get-ChildItem "C:\Users\USERNAME\AppData\Local" -Force | Where-Object { $_.PSIsContainer }

$results = @()

foreach ($item in $items) {

    $size = (Get-ChildItem $item.FullName -Recurse -ErrorAction SilentlyContinue -Force | Measure-Object -Property Length -Sum).Sum

    $results += [PSCustomObject]@{Name=$item.Name; SizeGB=[math]::Round($size/1GB,2)}

}

$results | Sort-Object SizeGB -Descending | Format-Table -AutoSize

```



**Coping when PowerShell Measure-Object hits "Length not found":**

Some directories have zero-length items (symlinks, .hardlink, junction points). If the error fires, add `-Force` or use `Where-Object { $_.Length -gt 0 }` filtering.



**Fallback — `du -sh` (faster for small directories):**

Use `du` only for small/medium dirs (<5 GB, <500 files). Batch 3-5 at a time per terminal call:



```bash

cd /d/ && timeout 30 du -sh SmallDir1 SmallDir2 SmallDir3 2>&1

```



- Skip deeply nested dirs (node_modules, .venv, blobs) — they inflate scan time

- For very large dirs, use `du -sh --exclude=node_modules --exclude=.venv --exclude=blobs`

- **Hard timeout coping strategy:** When `du -sh` on a single directory times out (common on model-heavy dirs with thousands of files like `llama/`, `stable-diffusion-webui/`), use `ls` to inspect contents and estimate from file count + typical file sizes. A dir with 50 .safetensors files averaging 4GB each is ~200GB. A dir with many small installers is probably <1GB.

- **Note:** git-bash's `du` does NOT support `--timeout=N` flag — that's a GNU coreutils flag. Use `timeout N du -sh` instead.



### Step 3: Classify Each Directory



For each non-system directory, determine:



| Category | Examples | Storage Impact |

|----------|----------|----------------|

| **Active software** | QQ, WeChat, Office, VPN, browser | Keep |

| **AI/ML tools** | ComfyUI, Stable Diffusion, Fooocus, Ollama | Usually large; check for duplicates |

| **Work files** | docs, reports, spreadsheets, scripts | Keep |

| **Old projects** | code experiments, backup copies, unfinished prototypes | Can archive/delete |

| **Installers/packages** | .exe, .zip, .msi — especially "All-in-One" runtimes | Delete after use |

| **Empty shells** | directories with only a placeholder file or 0 bytes | Delete |

| **Source code** | git repos, unbuilt projects | Distinguish compiled (has dist/) from source (needs build) |

| **Cache** | .pnpm-store, DeliveryOptimization, pip cache | Delete |



### Step 3b: Recent-Change Investigation (for "suddenly lost space" scenarios)



When the user reports a sudden space loss on C: drive (e.g., "少了60GB"), the culprit is almost always one of:



1. **pagefile.sys grew** (most common on 32GB RAM machines) — Windows auto-manages this file. It can balloon to 46+ GB. Check with `ls -lh /c/pagefile.sys`. If modified in last 24-48h → probable cause. Fix: set fixed size (e.g., 16384 MB min/max) via System Properties → Advanced → Performance → Virtual Memory, or via PowerShell.

2. **Docker container/images** — `docker_data.vhdx` (at `C:\Users\USER\AppData\Local\Docker\wsl\disk\`) stores all images and containers. Check size with `ls -lh /c/Users/USER/AppData/Local/Docker/wsl/disk/docker_data.vhdx`. To see what's inside, check if Docker Desktop is running: `docker system df` or `docker images` from git-bash (works if Docker CLI is in PATH).

3. **WSL ext4.vhdx auto-extension** — Ubuntu WSL distro's virtual disk grows as files are added. Check at `C:\Users\USER\AppData\Local\Packages\*Ubuntu*\LocalState\ext4.vhdx`.

4. **Windows Update cache or rollback data** — `$WinREAgent`, `$WINDOWS.~BT`, `C:\Windows\SoftwareDistribution\Download`. Usually small but worth checking.

5. **Memory dump** — `C:\memory.dmp` or `C:\Windows\memory.dmp` (can be full 32GB RAM dump). Check with `ls`.



**Detection technique from git-bash (no recursive C: scan — too slow):**

Write a targeted PowerShell script to disk and run it:



```bash

write_file(

    path="D:/dasha/WORKSPACE/check_recent.ps1",

    content='''$cutoff = (Get-Date).AddHours(-72)

Get-ChildItem C:\ -Recurse -File -ErrorAction SilentlyContinue |

    Where-Object { $_.LastWriteTime -ge $cutoff -and $_.Length -gt 200MB } |

    Sort-Object Length -Descending |

    ForEach-Object { "{0,8:F2} GB  {1}  ({2})" -f ($_.Length/1GB), $_.FullName, $_.LastWriteTime } |

    Select-Object -First 20

''')

powershell.exe -ExecutionPolicy Bypass -File "D:/dasha/WORKSPACE/check_recent.ps1"

```



Then check individual known suspects for size:



```bash

ls -lh /c/pagefile.sys /c/hiberfil.sys /c/swapfile.sys

ls -lh /c/Users/USER/AppData/Local/Docker/wsl/disk/docker_data.vhdx

ls /c/Windows/memory.dmp 2>/dev/null && ls -lh /c/Windows/memory.dmp

```



### Step 4: Check for Duplicates & Redundancies



Common duplication patterns on this user's machine:

- Multiple AI image gen tools (ComfyUI + Fooocus + SD WebUI) with overlapping models

- Multiple versions of the same tool (old portable + new desktop) — always check version numbers

- Multiple copies of the same model file in different tool directories

- Source code download + npm global install of the same project

- Iterative backup files: `file - 副本 (2).py`, `file - 副本 (3).py`, etc.



Check version files when comparing duplicates:

```bash

# ComfyUI

grep __version__ */ComfyUI/comfyui_version.py 2>/dev/null

grep __version__ resources/ComfyUI/comfyui_version.py 2>/dev/null



# OpenClaw / Node packages

cat package.json | jq .version

cat openclaw.mjs | head -5

```



### Step 5: Check If Source Code Is Actually Buildable



```bash

# Node.js project: check for dist/ or build output

test -d dist && echo "COMPILED" || echo "SOURCE_ONLY"



# Python project: check for .venv and main entry point

test -f pyproject.toml || test -f setup.py || test -f requirements.txt



# Verify runnability

node openclaw.mjs 2>&1 | head -5

```



**Key heuristic:** If `dist/` or a compiled binary is missing, the project needs a build step. Source-only downloads from GitHub (e.g., `/archive/main.zip`) are not runnable without `pnpm build` or equivalent.



### Step 5b: Windows Deletion Techniques (from git-bash)



When the user says "把这个删掉", use these Windows-specific deletion methods:



**Normal directories (no permission issues):**

```bash

# git-bash native — works for most user-created dirs

rm -rf /d/SomeDir/



# Via cmd.exe (use if rm fails)

cd /c && cmd.exe //c "rd /s /q D:\SomeDir"

```



**System-protected directories (Config.Msi, MSOCache, $RECYCLE.BIN):**

- These require **UAC elevation** (Run as Administrator) even if the user is in the Administrators group

- `takeown` + `icacls` from a non-elevated shell will fail with "Access is denied"

- `schtasks /create /ru SYSTEM` also requires elevation — won't work from git-bash

- **Best approach:** tell the user to manually open cmd.exe as Administrator and run `rd /s /q D:\DirName`

- **Alternative:** suggest Windows Disk Cleanup (`cleanmgr`) which handles MSOCache, DeliveryOptimization, and temporary files through a GUI



**Checking deletion success from git-bash:**

```bash

ls -d /d/DirName/ 2>&1

# "No such file or directory" = deleted successfully

# "Permission denied" = still exists, needs elevation

```



**Handling MSYS2 path translation issues:**

```bash

# Use //c (double slash) for cmd.exe flags to prevent MSYS2 converting /c to C:\

cmd.exe //c "command"

# Or set MSYS2_NO_PATHCONV for specific commands

MSYS2_NO_PATHCONV=1 cmd.exe /c "command"

```



**Complex multi-command Windows operations (e.g., checking user identity + permissions):**

Write a `.bat` file to disk, then execute it:

```bash

cd /d/dasha/WORKSPACE && cmd.exe //c clean_drive.bat

```

This avoids quoting nightmares with pipes, `&&` chains, and redirects in git-bash.



## Step 5c: Accessing Windows Protected System Folders



When the user wants files from `$RECYCLE.BIN` or `System Volume Information` — these are Windows system-protected folders that even Administrators cannot read from a normal command prompt. The solution: **auto-elevating PowerShell scripts** with `takeown` + `icacls`.



### Technique Overview



1. **Write a .ps1 file** to D:\dasha\WORKSPACE\ (never write to /tmp/ from git-bash)

2. **Auto-elevate** with `Start-Process -Verb RunAs` at the top of the script

3. **Take ownership** of individual SID subfolders (never `/R` on the root $RECYCLE.BIN!)

4. **Grant full control** with `icacls`

5. **List/copy/move files** as needed



### Auto-Elevation Pattern (boilerplate)



```powershell

# Paste this at the top of every admin-needed script

$currentUser = [Security.Principal.WindowsIdentity]::GetCurrent()

$principal   = New-Object Security.Principal.WindowsPrincipal($currentUser)

if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {

    Write-Host "Not running as admin. Restarting with admin privileges..."

    $scriptPath = $MyInvocation.MyCommand.Path

    Start-Process powershell.exe -Verb RunAs -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$scriptPath`""

    exit

}

```



When the script runs, Windows shows a UAC dialog. The user clicks "Yes" and a new elevated PowerShell window opens with the script continuing.



### Executing from git-bash



```bash

# Write the .ps1 file first (never rely on inline -Command — escaping breaks)

write_file(path="D:/dasha/WORKSPACE/script.ps1", content='...')



# Run it — must cd /c/ first to avoid UNC path issues

cd /c/ && powershell.exe -ExecutionPolicy Bypass -File "D:\dasha\WORKSPACE\script.ps1"

```



### Pattern 1: List/Recycle Bin Contents



```powershell

$rootPath = "E:\`$RECYCLE.BIN"

# Get all SID subfolders (each user login has one)

$subFolders = Get-ChildItem -Path $rootPath -Directory -Force -ErrorAction SilentlyContinue



foreach ($folder in $subFolders) {

    $folderPath = $folder.FullName

    Write-Host "Processing: $($folder.Name)"

    # Take ownership — use /F (single folder), NOT /R (recursive) on root $RECYCLE.BIN

    takeown /F $folderPath /R /D Y 2>&1 | Out-Null

    icacls $folderPath /grant "${env:USERNAME}:F" /T /Q 2>&1 | Out-Null



    # Now list files

    $files = Get-ChildItem -Path $folderPath -Force -ErrorAction SilentlyContinue

    $files | ForEach-Object { Write-Host "  $($_.Name) ($($_.Length) bytes)" }

}

```



### Pattern 2: Move Video Files from Recycle Bin



Full working template saved locally. Use this for moving all video files from `$RECYCLE.BIN` to a destination folder. Features:

- Auto-elevation

- Iterates all SID subfolders

- `takeown /R` on each subfolder (NOT `/R` on the $RECYCLE.BIN root itself)

- Filename conflict handling (appends _1, _2, etc.)

- `pause` at end to prevent flash-close



```powershell

# Pseudo-template — see reference file for full version

$rootPath  = "E:\`$RECYCLE.BIN"

$destDir   = "E:\E VIDEO"

$videoExts = @("*.mp4","*.mov","*.avi","*.mkv","*.wmv","*.flv","*.webm","*.mts","*.m2ts","*.ts")



# Auto-elevate...

foreach ($folder in (Get-ChildItem $rootPath -Directory -Force)) {

    takeown /F $folder.FullName /R /D Y 2>&1 | Out-Null

    icacls $folder.FullName /grant "${env:USERNAME}:F" /T /Q 2>&1 | Out-Null

    foreach ($ext in $videoExts) {

        Get-ChildItem $folder.FullName -Filter $ext -File -Force -Recurse | ForEach-Object {

            # Move-Item with conflict renaming

        }

    }

}

```



### Pattern 3: Clear Recycle Bin Contents (Delete All Files)



Same takeown + icacls pattern, then `Remove-Item -Force` instead of Move-Item. Do NOT attempt `/R` on the $RECYCLE.BIN root folder itself — it hangs the script. Only process individual SID subfolders.



### Pattern 4: Access System Volume Information



Same technique applies for `E:\System Volume Information`. The folder contains shadow copy data and restored file versions. Files copied/moved out may retain restricted NTFS permissions — run `takeown + icacls` on the **individual file** at the destination if it's still unreadable.



### Pitfalls



**1. Never `takeown /R` on $RECYCLE.BIN root folder.** It hangs indefinitely. Always loop over individual SID subfolders and run `takeown /F <subfolder>` (with `/R` for recursive inside the subfolder, which is fine since they're small).



**2. git-bash's UNC path issue.** The terminal may inherit a `\\?\C:\...` UNC path. When cmd.exe runs from this path, it produces empty output or cryptic failures. **Fix:** `cd /c/` first before calling `powershell.exe -File`.



**3. Script path with spaces.** `"D:\dasha\WORKSPACE\script.ps1"` works on cmd.exe because D:\ has no space. But if the path had spaces, use short names or double-quoting.



**4. $RECYCLE.BIN is NOT unique.** Every drive (C:, D:, E:, etc.) has its own $RECYCLE.BIN. The SID subfolder names correspond to user security identifiers — they differ per user account.



**5. Files from System Volume Information may have residual permissions.** Even after copying to a normal directory, they may refuse to open. Run `takeown /F filepath && icacls filepath /grant USERNAME:F` on the destination file as a second pass.



**6. Always add `pause` at the end of the script.** Without it, the elevated PowerShell window closes on error or completion, and the user can't see what happened. For the user's visibility: add a Start-Process explorer.exe to open the destination folder automatically.



### Embedded User Preference (important)



This user (Captain 示例用户) has used this workflow repeatedly. When they say "你再用个自动提权的脚本", they expect:

- The script auto-elevates (UAC popup shows, they click Yes)

- It clearly reports what it's doing at each step

- It handles file conflicts gracefully (_1/_2 suffix)

- It opens the destination folder at the end

- It pauses so they can read results before closing



The user's preferred script style is: verbose output per step (Write-Host with === markers), explicit "Done" summary at end, explorer.exe to open destination. This was confirmed positive when user said "这个脚本很好" about move_e_videos.ps1.



The working script is saved at `skill_view(name='storage-audit', file_path='scripts/move_recycle_videos.ps1')` — copy it to the user's Desktop for repeated use: `cp /d/dasha/WORKSPACE/../skills/devops/storage-audit/scripts/move_recycle_videos.ps1 /c/Users/your-user/Desktop/`.



## Reference Files (Protected Folders)



- `references/protected-folder-access-ps1.md` — full PowerShell script templates for accessing $RECYCLE.BIN and System Volume Information (auto-elevate, takeown, icacls, move/delete patterns)

- `scripts/move_recycle_videos.ps1` — reusable script for moving all videos from any drive's $RECYCLE.BIN. Supports `-SourceDrive D -DestDir "D:\Some Folder"` params.



### Step 6: Compile the Report



Structure the report as a table with columns:

- Folder path and size

- What it is (describe contents)

- Status: **保留** / **可删** / **视需要** / **整理**

- Rationale (one-line explanation)



Always end with a summary of **total reclaimable space**.



## Formatting Rules (from user preference)



- Present as a clear table with categories grouped

- Bold the recommendation for each item

- End with a total reclaimable estimate

- Use Chinese for categories (保留/可删/视需要/整理)

- Use GB/MB for sizes

- **Never delete anything without user confirmation** — the user must explicitly say "删掉" first

- If the user says "先不要删任何东西" (don't delete anything yet), just give the report



## C: Drive Specifics



C: drive analysis is different from D: (data) drive — more system dirs, user profile is the real target.



### Key Directories to Survey



| Directory | Typical Size | Notes |

|-----------|-------------|-------|

| C:\Windows | 30-50 GB | OS, don't touch |

| C:\Users\your-user\AppData\Local | 30-80 GB | Biggest target (Docker, wsl, Google, npm-cache) |

| C:\Users\your-user\AppData\Roaming | 10-25 GB | Python/Tencent/WorkBuddy data |

| C:\Program Files | 15-25 GB | Only audit if user asks |

| C:\Program Files (x86) | 10-15 GB | Only audit if user asks |

| C:\ProgramData | 10-20 GB | NVIDIA drivers (can be huge), Package Cache |

| <WAMP_ROOT> | 2-3 GB | WampServer |

| C:\Temp | 0.5-3 GB | Temporary files — can clean |



### System Files on C: Root



These appear as files (not directories) in C:\ root listing:



- **hiberfil.sys** (8-20 GB) — hibernation file. Can be disabled: `powercfg /h off`

- **pagefile.sys** (typically 16-32 GB, can grow to 64+ GB) — virtual memory. **Watch for dynamic expansion when AI models load.** This user's pagefile grew from ~50 GB to 63.9 GB when Fooocus loaded a 6.7 GB SDXL model, consuming 10+ GB of C: space temporarily. Not a real leak — rebooting shrinks it back. Can be limited: `wmic computersystem where name=\"%computername%\" set AutomaticManagedPagefile=False` then set fixed InitialSize/MaximumSize (32768 for 32GB systems). Can be resized but not safely disabled on 32GB systems

- **swapfile.sys** (16 MB) — Windows swap, leave it

- **$WinREAgent** (0.5-2 GB) — Windows update rollback data. Safe to delete if system is stable

- **$WINDOWS.~BT** / **$Windows.~WS** — Windows update temp. Usually small or empty. Safe to delete



### Windows Username Discovery



**IMPORTANT:** The Windows username is NOT the same as the WSL username. Do not assume `your-user` — check `C:\Users\` directly:



```bash

ls /c/Users/

# Likely outputs: Default, your-user, Public, WsiAccount

```



The actual Windows user is `your-user` (used for login, AppData paths, Desktop, Documents). The WSL user `your-user` only exists inside WSL's filesystem, not in C:\Users.



### User Profile Deep Dive



When profiling C:\Users\USERNAME\, distinguish these categories:



**1. AppData\Local** — main application data, large. Key targets:

- `Docker\` — image/container/volume data. Can be 15-25 GB. Clean with `docker system prune -a` or Docker Desktop GUI

- `wsl\` — WSL virtual disk (ext4.vhdx). 10-15 GB. Mark as **谨慎** — contains another dasha Agent

- `Google\` — Chrome browser cache/profile. 3-6 GB. Clearing cache is safe

- `Programs\` — Various tools. 5-10 GB. Check what's installed

- `npm-cache\` — npm package cache. 0.5-1 GB. Safe to delete

- `ms-playwright\` — Playwright browser engines. 0.5-1 GB. Safe if not testing

- `dasha\` — dasha Agent runtime data. Keep

- `Ollama\` — Ollama config/cache. Keep

- `Packages\` — Windows Store app packages. Keep

- `Temp\` — application temp files. 0.5-2 GB. Safe to clean



**2. AppData\Roaming** — per-user config/data:

- `Python\` — Python venvs/packages. Can be 8-12 GB. **保留** (dasha depends on it)

- `Tencent\` — QQ/WeChat data. Keep if using

- `WorkBuddy\` — Work log data. Keep

- `npm\` — npm global packages. Keep

- `NVIDIA\` — GPU driver settings. Keep



**3. User profile root — large hidden dirs:**

- `.cache\` — miscellaneous cache. 5-10 GB. Can clean most subdirs

- `.dasha\` — dasha Agent configuration + knowledge bases. 3-5 GB. Keep

- `stable-diffusion-webui\` — If present in C:\Users\, check if D: drive also has one (duplicate!)

- `WorkBuddy\` — Work log files. Keep

- `Documents\` — user documents. Check contents



### Checking Docker Space (from git-bash)



Docker Desktop may or may not be running. Check availability:



```bash

docker --version 2>/dev/null

# If this outputs a version, Docker CLI is installed

```



**If Docker daemon is running** (Docker Desktop is open):



```bash

docker system df         # Total space used by images/containers/volumes

docker system df -v      # Detailed breakdown per image/container

docker images            # List all pulled images with sizes

```



⚠️ `docker system df` may time out (10-15s default). If so, try `docker images` instead — it's faster and shows image-level sizes.



**If Docker daemon is NOT running**, check the docker_data.vhdx size:



```bash

ls -lh /c/Users/USER/AppData/Local/Docker/wsl/disk/docker_data.vhdx

```



The .vhdx is a dynamic disk — it shows current size on disk, which is the total space Docker uses. This includes all images, containers, volumes, and build cache. It only grows, never shrinks automatically. To reclaim space:

- Start Docker Desktop → `docker system prune -a` (removes dangling images, stopped containers, unused networks, build cache)

- Or from Docker Desktop GUI: Troubleshoot → Clean / Purge data



### Known C: Drive Space Wasters



1. **Docker images/containers (AppData\Local\Docker, 15-25 GB)** — often accumulate old images. `docker system df` to check, `docker system prune -a` to clean

2. **NVIDIA driver cache (ProgramData\NVIDIA Corporation, 5-10 GB)** — old driver installers accumulate. Use Display Driver Uninstaller (DDU) or manually clean the `Installer2\` subfolder

3. **Package Cache (ProgramData\Package Cache, 1-3 GB)** — Windows installer cache. Contents can be deleted

4. **Windows.old / $Windows.~BT (0-10 GB)** — major Windows version upgrade backup. Can be deleted via Disk Cleanup

5. **MSOCache (C:\MSOCache, 0-2 GB)** — Office installation cache. Requires admin elevation to delete

6. **Python314 / extra Python installations** — if user has multiple Python versions, consider removing unused ones



### Avoiding Duplicate-Analysis Trap



This user's machine has tools in multiple locations. When analyzing C: drive, check for **cross-drive duplicates**:



- `stable-diffusion-webui`: check C:\Users\your-user\ AND D:\

- `Python`: check C:\Program Files\Python310, C:\Python314, C:\Users\your-user\AppData\Roaming\Python

- `OpenClaw`: check C: npm global install AND any D:\ copies

- `ComfyUI`: check D:\SOFT\ComfyUI AND C:\Users\your-user\Documents\ComfyUI AND any D:\ComfyUI

- `WorkBuddy`: check C:\Users\your-user AND D:\



When you find duplicates, check version numbers to determine which is newer/more complete.



### Report Structure for C:



Same format as D: drive report, but add a section for:

1. System files (hiberfil.sys, pagefile.sys) — explain what they are

2. OS itself (Windows folder) — note the size but don't recommend deletion

3. User profile breakdown (AppData breakdown by category)

4. Program Files / Program Files (x86) / ProgramData — only if user asked to audit installed software

5. Cross-drive duplicates found (with paths to both)



Always note that C: has less cleanup potential than D: because so much is system-managed.



## Pitfalls



1. **timeouts on deep dependency directories** — `du -sh` on large dirs (node_modules, .venv, blobs) routinely times out (30-60s+). Batch your calls (3-5 per terminal command) and use shorter timeouts (10-15s). If it still times out, use `ls` + estimation instead. For very large dirs, use `timeout 30 du -sh --exclude=node_modules --exclude=.venv`.

2. **System folders are not user data, but you CAN access them.** $RECYCLE.BIN and System Volume Information are managed by Windows, but if the user needs files from them, use the auto-elevation takeown+icacls approach (see "Accessing Windows Protected System Folders" section above). Only Program Files are genuinely off-limits.

3. **0-byte directories** often mean the installer was extracted but never run. Check for a placeholder file like `put_checkpoints_here`.

4. **Never claim "this tool doesn't work" as a fixed fact.** The tool may work in a different environment (e.g., Windows-side vs WSL-side). Instead, say "doesn't work in this context" and explain the constraint.

5. **模型路径因版本而异。** Desktop版ComfyUI的模型在Documents下，便携版在软件目录下，Ollama模型在ollama/blobs/下。不要假定统一路径。

6. **"编译过"和"源码"的区别很重要。** 有dist/的可以直接用，只有package.json的要pnpm build。GitHub源码zip包不能直接跑。

7. **Always ask before deleting.** The user's explicit instruction takes priority over any recommendation.

8. **Pre-check for duplicate installations.** Users often install the same tool multiple times in different locations (D:\SOFT\, D:\, C:\Program Files, etc.)

9. **$RECYCLE.BIN and System Volume Information need takeown+icacls, not just elevation.** Even running cmd.exe as Administrator, you can't `dir` $RECYCLE.BIN or read files from it. You must: (a) take ownership with `takeown /F <subfolder>` (NEVER `/R` on the root $RECYCLE.BIN), (b) grant full control with `icacls /grant`, (c) then read/copy/move. Do this via an auto-elevating PowerShell script (see "Step 5c" section above) — write the .ps1 to D:\dasha\WORKSPACE\ and run with `cd /c/ && powershell.exe -ExecutionPolicy Bypass -File "D:\path.ps1"`. **Common pitfalls:** takeown /R on root folder hangs indefinitely; git-bash's UNC path causes empty cmd.exe output unless you cd /c/ first.

10. **svchost.exe can lock DeliveryOptimization while Windows Update is running.** If `rd /s /q` fails with "Access is denied" on DeliveryOptimization but succeeds on Config.Msi, try again later or suggest the user reboot first.



## Related Skills



- `comfyui` — for ComfyUI-specific installation comparison and model migration



## Reference Files



- `references/c-drive-analysis-notes.md` — full C: drive survey data from 2026-05-18 session (sizes for all directories, AppData breakdown, reclaimable space estimates). Load with `skill_view(name='storage-audit', file_path='references/c-drive-analysis-notes.md')`.

