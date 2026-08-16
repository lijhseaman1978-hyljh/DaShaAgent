# PowerShell Training Manager GUI & Detached Training

Two complementary approaches for Windows-native training control, each solving different problems:

- **train_manager.ps1** — A WPF/XAML GUI with progress bars, loss display, epoch tracking, and Start/Stop buttons. Designed for the user to visually monitor training without checking logs.
- **start_training_detached.ps1** — A headless launcher that starts training as a truly independent Windows process (survives dasha session restarts). Use when you just need to start training and walk away.

## Problem Statement

Training a from-scratch model takes 20+ hours over 30 epochs. The dasha terminal tool:
1. **Doesn't survive session restarts** — processes die when the terminal is garbage-collected
2. **Keeps the GPU busy** — you can't test inference while training runs
3. **Lacks visual feedback** — no real-time progress, epoch %, or loss trends

Both scripts below solve these for a Windows-native environment (Python 3.10, RTX 5060 8GB).

## Approach 1: PowerShell GUI (train_manager.ps1)

A standalone PowerShell window with WPF controls that:
- Shows current epoch / total epochs (e.g. "Epoch 9 / 30")
- Shows per-epoch progress as a percentage with a progress bar
- Displays real-time Loss value
- Has Start / Stop buttons
- Monitors the training log file for streaming output

### Architecture

```
┌─────────────────────────────┐
│  train_manager.ps1           │
│  ┌───────────────────────┐   │
│  │ WPF Window (XAML)     │   │
│  │ - Epoch: [██████░░] 75%│   │
│  │ - Loss: 2.9081         │   │
│  │ - Per-step progress    │   │
│  │ - [Start] [Stop]       │   │
│  └───────────────────────┘   │
│          │                    │
│          ▼                    │
│  ┌───────────────────────┐   │
│  │ Training Process       │   │
│  │ (Start-Process Hidden) │   │
│  │ stdout → training.log  │   │
│  └───────────────────────┘   │
│          ▲                    │
│          │ (Reads & parses)   │
│          │                    │
│  ┌───────────────────────┐   │
│  │ FileSystemWatcher      │   │
│  │ + Timer (1s interval)  │   │
│  └───────────────────────┘   │
└─────────────────────────────┘
```

### Key Features

| Feature | Implementation | Notes |
|---------|---------------|-------|
| **Epoch detection** | Regex `Epoch\s+(\d+)/(\d+)` | Parsed from training log stdout |
| **Step progress** | `current_step / total_steps` | Shows as percentage bar |
| **Loss display** | `Loss (\d+\.\d+)` from last log line | Updates every polling interval |
| **Process management** | `Get-Process -Id $pid` | Start via `Start-Process`, stop via `Stop-Process -Force` |
| **Log monitoring** | `System.IO.StreamReader` | Uses `BaseStream.Seek` + `ReadToEnd` for incremental reads |
| **Thread-safe UI** | `$window.Dispatcher.Invoke()` | Required for WPF cross-thread updates |

### XAML Layout (Key Elements)

```xml
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation">
  <Grid>
    <Label Content="模型训练管理器" FontSize="20" FontWeight="Bold"/>
    
    <!-- Epoch info -->
    <Label Name="EpochLabel" Content="Epoch: 0 / 30"/>
    <ProgressBar Name="EpochProgress" Minimum="0" Maximum="30"/>
    
    <!-- Step progress -->
    <Label Name="StepLabel" Content="Step: 0 / 40620"/>
    <ProgressBar Name="StepProgress"/>
    
    <!-- Loss display -->
    <Label Name="LossLabel" Content="Loss: --" FontSize="16"/>
    
    <!-- Buttons -->
    <Button Name="StartBtn" Content="开始训练"/>
    <Button Name="StopBtn" Content="停止训练" IsEnabled="False"/>
    
    <!-- Status -->
    <TextBlock Name="StatusText"/>
  </Grid>
</Window>
```

### Monitoring Logic

```powershell
$timer = New-Object System.Windows.Threading.DispatcherTimer
$timer.Interval = [TimeSpan]::FromSeconds(1)
$timer.Add_Tick({
    if ($global:Process -and !$global:Process.HasExited) {
        $lines = Get-Content -Path $LogFile -Tail 5
        if ($lines.Count -gt 0) {
            $lastLine = $lines[-1]
            # Parse Epoch 9/30 | Step 23400/40620 | Loss 2.9081
            if ($lastLine -match 'Epoch\s+(\d+)/(\d+)') {
                $script:EpochLabel.Content = "Epoch: $($matches[1]) / $($matches[2])"
                $script:EpochProgress.Value = [int]$matches[1]
            }
            if ($lastLine -match 'Loss\s+([\d.]+)') {
                $script:LossLabel.Content = "Loss: $($matches[1])"
            }
        }
    }
})
$timer.Start()
```

### Pitfalls

| Pitfall | Symptom | Fix |
|---------|---------|-----|
| **Empty log file on first read** | `$lines[-1]` crashes with `Index was outside the bounds of the array` | Check `$lines.Count -gt 0` before accessing `[-1]` |
| **Python log to stderr, monitor reads stdout** | GUI shows no log output | Ensure training script logs to stdout or redirect stderr: `2>&1` |
| **WPF window too large for screen** | Bottom of window clipped | Set `SizeToContent="WidthAndHeight"` or explicit `Height=480 Width=800` |
| **Timer not stopping when training ends** | GUI keeps showing last values | Add `$global:Process.HasExited` check; stop timer and show "训练已完成" |
| **Process ID lost on dasha restart** | Can't attach to running process | Avoid — train_manager.ps1 is for live monitoring. For restart-resilient training, use Approach 2 |
| **PowerShell execution policy** | Script won't run | `powershell.exe -ExecutionPolicy Bypass -File train_manager.ps1` |

### Starting the GUI

```powershell
# From PowerShell directly
powershell.exe -ExecutionPolicy Bypass -File D:\dasha\WORKSPACE\train_manager.ps1

# From git-bash (must use full Windows path)
powershell.exe -ExecutionPolicy Bypass -File "D:\dasha\WORKSPACE\train_manager.ps1"
```

## Approach 2: Detached Training (start_training_detached.ps1)

A headless launcher that spawns training as an independent Windows process. The GUI is optional — use this when you want training to survive everything short of a reboot.

```powershell
# start_training_detached.ps1
$python = "C:\Program Files\Python310\python.exe"
$script = "D:\dasha\WORKSPACE\ai_training\train_model.py"
$logDir = "D:\dasha\WORKSPACE\ai_training"
$logFile = Join-Path $logDir "training.log"

# Get epoch resume info
$maxEpoch = 0
Get-ChildItem "$logDir\models\checkpoint_epoch*.pt" | ForEach-Object {
    if ($_.Name -match 'checkpoint_epoch(\d+)') {
        $e = [int]$matches[1]
        if ($e -gt $maxEpoch) { $maxEpoch = $e }
    }
}
Write-Host "Resuming from epoch $maxEpoch → training..."

# Launch with hidden window
$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = $python
$psi.Arguments = "`"$script`""
$psi.WorkingDirectory = $logDir
$psi.UseShellExecute = $false
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError = $true
$psi.CreateNoWindow = $true

$p = [System.Diagnostics.Process]::Start($psi)
$p.PriorityClass = [System.Diagnostics.ProcessPriorityClass]::BelowNormal

# Save PID for later monitoring
$p.Id | Out-File (Join-Path $logDir "train.pid")
Write-Host "Training started (PID: $($p.Id))"
```

### Monitoring from CLI

```bash
# Check if training process still alive
kill -0 $(cat /d/dasha/WORKSPACE/ai_training/train.pid) && echo "Running" || echo "Stopped"

# Check recent progress
tail -3 /d/dasha/WORKSPACE/ai_training/training.log

# Check GPU usage
nvidia-smi

# Stop training (from anywhere)
kill $(cat /d/dasha/WORKSPACE/ai_training/train.pid)
# Wait and verify GPU freed
nvidia-smi
```

## Which Approach to Use

| Scenario | Use |
|----------|-----|
| User wants to **see progress visually** | `train_manager.ps1` (GUI) |
| Just **start and forget** — check later | `start_training_detached.ps1` (headless) |
| User is **not at computer** but wants training running | `start_training_detached.ps1` (survives reboot only if scheduled) |
| **First time training** or debugging | `train_manager.ps1` to watch for errors |
| **Resuming after dasha session restart** | `start_training_detached.ps1` (detached process still alive) or just re-launch training (auto-resume from checkpoint) |

## Related Files

- `D:\dasha\WORKSPACE\train_manager.ps1` — WPF/XAML GUI training manager
- `D:\dasha\WORKSPACE\start_training_detached.ps1` — Headless detached launcher
- `D:\dasha\WORKSPACE\ai_training\training.log` — Training output log
- `D:\dasha\WORKSPACE\ai_training\train.pid` — Training process PID
- `D:\dasha\WORKSPACE\ai_training\models\checkpoint_epoch*.pt` — Checkpoints
- `D:\dasha\WORKSPACE\ai_training\models\best_model.pt` — Best model
