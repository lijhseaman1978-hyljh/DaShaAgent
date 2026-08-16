<#
.SYNOPSIS
    Move all video files from E:\$RECYCLE.BIN to E:\E VIDEO with auto-elevation.
.DESCRIPTION
    Takes ownership of all SID subfolders under $RECYCLE.BIN, searches for video files,
    and moves them to the destination directory. Handles filename conflicts.
    Opens the destination folder when done.
.PARAMETER SourceDrive
    Drive letter for the source $RECYCLE.BIN (default: E)
.PARAMETER DestDir
    Destination directory (default: E:\E VIDEO)
.EXAMPLE
    .\move_recycle_videos.ps1
    .\move_recycle_videos.ps1 -SourceDrive D -DestDir "D:\Recovered Videos"
#>

param(
    [string]$SourceDrive = "E",
    [string]$DestDir = "E:\E VIDEO"
)

$rootPath = "${SourceDrive}:\`$RECYCLE.BIN"

# Auto-elevate if not admin
$currentUser = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal   = New-Object Security.Principal.WindowsPrincipal($currentUser)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host "Not running as admin. Restarting with admin privileges..."
    $scriptPath = $MyInvocation.MyCommand.Path
    $argsStr = if ($args) { " -SourceDrive $SourceDrive -DestDir '$DestDir'" } else { "" }
    Start-Process powershell.exe -Verb RunAs -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$scriptPath`" $argsStr"
    exit
}

Write-Host "============================================================"
Write-Host "  Scan ALL folders under: $rootPath"
Write-Host "  Move videos to:         $DestDir"
Write-Host "============================================================"
Write-Host ""

# Create destination if not exists
if (-not (Test-Path $DestDir)) {
    New-Item -ItemType Directory -Path $DestDir -Force | Out-Null
    Write-Host "Created destination folder: $DestDir`n"
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
        $destPath = Join-Path $DestDir $file.Name
        # Handle filename conflicts: append number if exists
        $finalPath = $destPath; $counter = 1
        while (Test-Path $finalPath) {
            $base = [System.IO.Path]::GetFileNameWithoutExtension($file.Name)
            $ext  = [System.IO.Path]::GetExtension($file.Name)
            $finalPath = Join-Path $DestDir "${base}_$counter$ext"
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
Write-Host "  Destination: $DestDir"
Write-Host "============================================================"

# Open destination folder
Start-Process explorer.exe -ArgumentList $DestDir
pause
