# Windows Protected System Folder Access — PowerShell Templates

Consolidated reference for auto-elevating PowerShell scripts that access `$RECYCLE.BIN` and `System Volume Information`.

## Template A: Minimal Auto-Elevate + List Files

```powershell
# === SCRIPT: List files inside a protected folder ===
$folderPath = "E:\`$RECYCLE.BIN\S-1-5-21-XXXXXXXXXX-XXXX"

# Auto-elevate
$currentUser = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal   = New-Object Security.Principal.WindowsPrincipal($currentUser)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host "Not running as admin. Restarting with admin privileges..."
    $scriptPath = $MyInvocation.MyCommand.Path
    Start-Process powershell.exe -Verb RunAs -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$scriptPath`""
    exit
}

Write-Host "=== Running as Administrator ==="
Write-Host ""

# Take ownership (individual subfolder only!)
takeown /F $folderPath /R /D Y 2>&1 | Out-Null
Write-Host "Ownership taken."

# Grant full control
icacls $folderPath /grant "${env:USERNAME}:F" /T /Q 2>&1 | Out-Null
Write-Host "Full control granted."
Write-Host ""

# List files
Write-Host "=== File Listing ==="
Get-ChildItem -Path $folderPath -Force -ErrorAction SilentlyContinue | ForEach-Object {
    $size = if ($_.Length -gt 1MB) { "$([math]::Round($_.Length/1MB,2)) MB" } else { "$($_.Length) bytes" }
    Write-Host "  $($_.Name)  ($size)"
}

Write-Host ""
Write-Host "=== Done ==="
pause
```

## Template B: Move All Video Files from Entire $RECYCLE.BIN

Full working script. Tested and confirmed "很好" by user (Captain 示例用户). Save as `move_e_videos.ps1` on Desktop for repeated use.

```powershell
$rootPath  = "E:\`$RECYCLE.BIN"
$destDir   = "E:\E VIDEO"

# Auto-elevate if not admin
$currentUser = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal   = New-Object Security.Principal.WindowsPrincipal($currentUser)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host "Not running as admin. Restarting with admin privileges..."
    $scriptPath = $MyInvocation.MyCommand.Path
    Start-Process powershell.exe -Verb RunAs -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$scriptPath`""
    exit
}

Write-Host "============================================================"
Write-Host "  Scan ALL folders under: $rootPath"
Write-Host "  Move videos to:         $destDir"
Write-Host "============================================================"
Write-Host ""

# Create destination if not exists
if (-not (Test-Path $destDir)) {
    New-Item -ItemType Directory -Path $destDir -Force | Out-Null
    Write-Host "Created destination folder: $destDir`n"
}

# Find all subfolders in $RECYCLE.BIN
$subFolders = Get-ChildItem -Path $rootPath -Directory -Force -ErrorAction SilentlyContinue
if (-not $subFolders) {
    Write-Host "ERROR: No subfolders found in $rootPath"
    pause
    exit 1
}

Write-Host "Found $($subFolders.Count) subfolder(s):"
$subFolders | ForEach-Object { Write-Host "  - $($_.Name)" }
Write-Host ""

# Video file extensions
$videoExts = @("*.mp4","*.mov","*.avi","*.mkv","*.wmv","*.flv","*.webm","*.mts","*.m2ts","*.ts")
$totalMoved = 0; $totalFailed = 0

foreach ($folder in $subFolders) {
    $folderPath = $folder.FullName
    Write-Host "--- Processing: $($folder.Name) ---"

    # Take ownership (/R is OK here because it's a leaf subfolder, not $RECYCLE.BIN root)
    Write-Host "  Taking ownership..."
    takeown /F $folderPath /R /D Y 2>&1 | Out-Null
    icacls $folderPath /grant "${env:USERNAME}:F" /T /Q 2>&1 | Out-Null

    # Search for video files recursively
    $videoFiles = @()
    foreach ($ext in $videoExts) {
        $found = Get-ChildItem -Path $folderPath -Filter $ext -File -Force -Recurse -ErrorAction SilentlyContinue
        if ($found) { $videoFiles += $found }
    }

    if ($videoFiles.Count -eq 0) {
        Write-Host "  No video files found in this folder.`n"
        continue
    }

    Write-Host "  Found $($videoFiles.Count) video file(s):"
    $moved = 0; $failed = 0

    foreach ($file in $videoFiles) {
        $destPath = Join-Path $destDir $file.Name
        # Handle filename conflicts: append number if exists
        $finalPath = $destPath; $counter = 1
        while (Test-Path $finalPath) {
            $base = [System.IO.Path]::GetFileNameWithoutExtension($file.Name)
            $ext  = [System.IO.Path]::GetExtension($file.Name)
            $finalPath = Join-Path $destDir "${base}_$counter$ext"
            $counter++
        }
        try {
            Move-Item -Path $file.FullName -Destination $finalPath -Force -ErrorAction Stop
            Write-Host "  [OK] $($file.Name)"
            $moved++; $totalMoved++
        } catch {
            Write-Host "  [FAIL] $($file.Name) - $_"
            $failed++; $totalFailed++
        }
    }
    Write-Host "  This folder: $moved moved, $failed failed`n"
}

Write-Host "============================================================"
Write-Host "  ALL DONE"
Write-Host "  Total moved: $totalMoved files"
Write-Host "  Total failed: $totalFailed files"
Write-Host "  Destination: $destDir"
Write-Host "============================================================"

# Open destination folder
Start-Process explorer.exe -ArgumentList $destDir
pause
```

## Template C: Clear $RECYCLE.BIN Contents (Delete All Files)

Same pattern but uses `Remove-Item -Force` instead of `Move-Item`.

```powershell
$rootPath = "E:\`$RECYCLE.BIN"

# Auto-elevate (same boilerplate as above)

$subFolders = Get-ChildItem -Path $rootPath -Directory -Force

foreach ($folder in $subFolders) {
    Write-Host "Processing: $($folder.Name)"
    takeown /F $folder.FullName /R /D Y 2>&1 | Out-Null
    icacls $folder.FullName /grant "${env:USERNAME}:F" /T /Q 2>&1 | Out-Null

    $files = Get-ChildItem $folder.FullName -File -Force -Recurse -ErrorAction SilentlyContinue
    Write-Host "  Found $($files.Count) files to delete"
    Remove-Item -Path "$($folder.FullName)\*" -Recurse -Force -ErrorAction SilentlyContinue
    Write-Host "  Deleted."
}
Write-Host "All done."
pause
```

## Template D: Access System Volume Information

Same technique. The folder contains shadow copy / restore point data. Files here may be old versions of user documents.

```powershell
$folderPath = "E:\System Volume Information"
$destDir    = "E:\E VIDEO"

# Auto-elevate (same boilerplate)
# takeown /F is NOT recursive on System Volume Information (too many nested dirs)
takeown /F $folderPath 2>&1 | Out-Null
icacls $folderPath /grant "${env:USERNAME}:F" 2>&1 | Out-Null

# List root contents
Get-ChildItem $folderPath -Force

# Search for video files (specify subfolder names if known)
Get-ChildItem "$folderPath\*" -Include @("*.mp4","*.mov","*.avi") -Recurse -File -Force -ErrorAction SilentlyContinue
```

## Known Pitfalls & Context-Specific Notes

### "VIDEO FILE WON'T OPEN AFTER COPYING FROM System Volume Information"

Files moved from System Volume Information sometimes retain restricted NTFS permissions even at the destination. The file shows as 0644 and lists fine but refuses to open. Fix: run `takeown + icacls` on the individual file:

```powershell
takeown /F "E:\E VIDEO\R8F79MC.mp4"
icacls "E:\E VIDEO\R8F79MC.mp4" /grant "${env:USERNAME}:F"
```

### IMPORTANT: takeown /R on $RECYCLE.BIN root hangs

Never run `takeown /F "E:\$RECYCLE.BIN" /R`. The root $RECYCLE.BIN folder is special — it has system-level protection that makes recursive takeown hang indefinitely (the script becomes unresponsive, can't even Ctrl+C). Always enumerate SID subfolders first, then `takeown /F <subfolder> /R` on each individually.

### git-bash execution pattern

From git-bash, PowerShell commands often fail or produce empty output due to:
1. **UNC path inheritance**: `cmd.exe` inherits a `\\?\C:\...` path from git-bash and silently produces no output. Fix: `cd /c/` first.
2. **MSYS path mangling**: `cmd.exe /c` gets `C:\` prepended by MSYS. Use `cmd //c` (double slash) or `MSYS2_NO_PATHCONV=1`.
3. **Always write .ps1 to disk**: Never use inline `-Command` for complex scripts. Write to D:\dasha\WORKSPACE\ and use `-File`.

```bash
# Correct execution pattern
write_file(path="D:/dasha/WORKSPACE/script.ps1", content='...')
cd /c/ && powershell.exe -ExecutionPolicy Bypass -File "D:\dasha\WORKSPACE\script.ps1"
```

### User Verbatim Preferences

- "像刚才那个V6脚本好用" (the V6 clear-recycle script style was good)
- "这个不对，闪退了" → meaning scripts MUST have `pause` at the end
- "你再用个自动提权的脚本" → expects auto-elevation, don't ask them to manually run as admin
- "这个脚本很好" (about move_e_videos.ps1) → the verbose style with === headers, OK/FAIL per file, totals at end, and explorer auto-open is the preferred format

### Filename Conflict Resolution

When moving files, two files from different SID folders may have the same name. Use this pattern to avoid overwrites:

```powershell
$finalPath = Join-Path $destDir $file.Name
$counter = 1
while (Test-Path $finalPath) {
    $base = [System.IO.Path]::GetFileNameWithoutExtension($file.Name)
    $ext  = [System.IO.Path]::GetExtension($file.Name)
    $finalPath = Join-Path $destDir "${base}_$counter$ext"
    $counter++
}
Move-Item -Path $file.FullName -Destination $finalPath -Force
```
