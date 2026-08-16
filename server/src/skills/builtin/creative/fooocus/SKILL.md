---
name: fooocus
description: "Install, debug, and run Fooocus AI image generation on Windows — GPU acceleration, Chinese language, model paths, and RTX 5060 (Blackwell) compatibility."
version: 1.0.0
author: dasha
license: MIT
platforms: [windows]
metadata:
  dasha:
    tags:
      - fooocus
      - ai-image-generation
      - gpu
      - stable-diffusion
    category: creative
---

# Fooocus

Fooocus is a GUI-based Stable Diffusion XL image generator. This user runs it on Windows (RTX 5060 Laptop GPU, 8GB VRAM) with a custom Python venv (`fooocus_env`) and the code+models in `Fooocus-2.5.5/`.

## Architecture

The installation is split across two directories in `D:\AI_Tools\`:

```
D:\AI_Tools\
├── fooocus_env\             # Python virtual environment (venv) — "the engine"
│   ├── Lib\site-packages\   # pip-installed packages
│   └── Scripts\python.exe   # Python 3.10.6
│       pytorch 2.8.0+cu128
│       numba 0.65.1+
│       llvmlite 0.47.0+
│
├── Fooocus-2.5.5\           # Application code + models — "the body"
│   ├── entry_with_update.py # Main entry point
│   ├── args_manager.py      # CLI argument parsing (--language, --port, etc.)
│   ├── modules\
│   │   ├── localization.py  # Language file loader
│   │   └── config.py        # Model path configuration
│   ├── language\
│   │   └── cn.json          # Chinese translation (566 keys)
│   ├── models\              # SDXL model files (juggernautXL 6.7GB, etc.)
│   └── outputs\             # Generated images
```

**Key Concept:** `fooocus_env` is just the Python runtime; models are read from `Fooocus-2.5.5/config.txt` pointing to `Fooocus-2.5.5/models/`. The `fooocus_env/models/` directory is NOT used — it's a left-over duplicate.

## Starting Fooocus

### Entry Point: `direct_start.py` vs `entry_with_update.py`

Fooocus-2.5.5 ships with two entry points:

| File | Behavior | When to Use |
|------|----------|-------------|
| `entry_with_update.py` | Tries to git-pull updates on launch; checks pip dependencies via `REQS_FILE='requirements_versions.txt'`; slower startup, requires git | First launch or when you want auto-updates |
| `direct_start.py` | Sets `REQS_FILE=''` (skips pip check); no git update; faster startup | Daily use, debugging, offline environments |

**Prefer `direct_start.py` for everyday use** — it skips the git update check and pip dependency scan, both of which can fail silently on systems without git installed or with slow internet.

### Detached Launch from git-bash (No Child Process Kill)

When launching Fooocus from a git-bash terminal (like Windows-side dasha does), the shell kills child processes when the terminal command returns — so direct invocation via `python direct_start.py` won't survive.

**Reliable approach: Use VBS + cmd.exe to create a fully detached process**

```bat
@echo off
cd /d D:\AI_Tools\Fooocus-2.5.5
start /B "" D:\AI_Tools\fooocus_env\Scripts\python.exe direct_start.py --language cn
```

The `start /B` creates a new process group. From git-bash, the `.bat` must be invoked via cmd.exe:

```bash
/c/Windows/System32/cmd.exe /c "D:\AI_Tools\_start_fx.cmd"
```

**More reliable approach: VBScript launcher (fully detached)**

The VBS launcher survives terminal session termination:

```vbscript
' start_fooocus.vbs
Set WshShell = CreateObject("WScript.Shell")
WshShell.Run "D:\AI_Tools\fooocus_env\Scripts\python.exe D:\AI_Tools\Fooocus-2.5.5\direct_start.py --language cn", 0, False
```

Then launch from git-bash with:

```bash
/c/Windows/System32/wscript.exe //B "D:\AI_Tools\Fooocus-2.5.5\start_fooocus.vbs"
```

The `//B` flag suppresses the VBScript engine banner. The `WshShell.Run ... 0, False` creates a hidden, fully detached process with no window.





### Direct Python Launch (for debugging)

Prefer `direct_start.py` over `entry_with_update.py` — it skips git update checks and pip dependency scans, starting faster and more reliably offline.

```bash
# Activate the venv and launch with Chinese language
cd /d/AI_Tools/Fooocus-2.5.5

# Option A: Activate venv first
source /d/AI_Tools/fooocus_env/Scripts/activate
MSYS2_NO_PATHCONV=1 python direct_start.py --language cn

# Option B: Direct path to venv Python
MSYS2_NO_PATHCONV=1 /d/AI_Tools/fooocus_env/Scripts/python direct_start.py --language cn
```

### Via Batch File (for user's desktop use)

Create a batch file `启动Fooocus_中文版.bat` in `D:\AI_Tools\`:

```batch
@echo off
title Fooocus AI 图像生成 (中文版)
cd /d D:\AI_Tools\Fooocus-2.5.5
D:\AI_Tools\fooocus_env\Scripts\python.exe direct_start.py --language cn
pause
```

**⚠️ CRITICAL: Do NOT add `--always-low-vram`, `--vae-in-cpu`, or `--all-in-fp32` flags.** On RTX 5060 8GB:
- `--always-low-vram` forces model unload/reload between each image (auto-detection only triggers at <=4GB, so this is unnecessary and harmful)
- `--vae-in-cpu` forces VAE decoding on CPU at fp32 (~20x slower than GPU bf16)
- `--all-in-fp32` forces UNet to fp32 (~10x slower per step)
- Remove all three for normal operation

**⚠️ CRLF line endings required:** When writing `.bat` files from git-bash/WSL, the write_file tool produces Unix line endings (`\n`). Windows `cmd.exe` silently ignores or misparses batch files with Unix line endings. After writing a `.bat` file, run `unix2dos` to fix:

```bash
unix2dos /d/AI_Tools/启动Fooocus_中文版.bat
# Verify: should show 0d 0a (CRLF) line endings
xxd /d/AI_Tools/启动Fooocus_中文版.bat | head -5
```

**⚠️ `--skip-pip` is NOT a valid argument.** The old launcher (`fooocus中文启动.bat`) included `--skip-pip` which causes `parse_args()` to fail with:
```
entry_with_update.py: error: unrecognized arguments: --skip-pip
```
This causes the process to exit before the web server starts. If the old batch file has `--skip-pip`, remove it.

Fooocus starts on port **7865** by default.

### The `--language cn` Flag

The flag flows through:
1. `entry_with_update.py` calls `from launch import *`
2. `launch.py` calls `ini_args()` → imports `args_manager` → `parse_args()` runs with current `sys.argv`
3. `args_manager.args.language` is set to `'cn'` (default is `'default'`)
4. `webui.py` → `ui_gradio_extensions.py` → `javascript_html()` calls `localization_js(args_manager.args.language)`
5. `localization_js('cn')` loads `language/cn.json` (566 keys), returns inline `<script>` tag with `window.localization = {...}`
6. `javascript/localization.js` reads `window.localization` on `DOMContentLoaded` and replaces all UI text via `localizeWholePage()`

**Debugging Chinese localization failure (`window.localization = {}`):**

```bash
# 1. Check what the running server serves
curl -s http://127.0.0.1:7865 | grep "window.localization"
# Expected: <script type="text/javascript">window.localization = {"Preview": "\u9884\u89c8", ...}</script>
# Bad: <script type="text/javascript">window.localization = {}</script>

# 2. Test localization_js() directly
MSYS2_NO_PATHCONV=1 /d/AI_Tools/fooocus_env/Scripts/python -c "
import sys; sys.path.insert(0, '.')
from modules.localization import localization_js
result = localization_js('cn')
print('Length:', len(result))
print('Has data:', len(result) > 100)
"

# 3. Test full args + localization pipeline
MSYS2_NO_PATHCONV=1 /d/AI_Tools/fooocus_env/Scripts/python -c "
import sys
sys.argv = ['entry_with_update.py', '--language', 'cn']
sys.path.insert(0, '.')
from args_manager import args
print('language:', repr(args.language))  # must be 'cn', not 'default'
from modules.localization import localization_js
result = localization_js(args.language)
print('Result has data:', len(result) > 100)
"
```

**Why localization might return empty:**
- **Stale __pycache__**: Delete `modules/__pycache__/localization.cpython-310.pyc` and restart
- **args mismatch**: The Gradio server may be a child process with different `sys.argv` — kill all python.exe, restart fresh. Don't rely on partial restarts.
- **cn.json corrupt**: Must be valid JSON with 566 string:string pairs (all values must be `str`)
- **Early exit**: If `--skip-pip` or other unrecognized arg is passed, `parse_args()` exits with error before the web server starts

## Variant Installations on This System

This user has **two** separate Fooocus installations:

| Location | Python | Models | Entry Point |
|----------|--------|--------|-------------|
| `D:\\AI_Tools\\fooocus\\` | System Python310 (`C:\\Program Files\\Python310`) | `models\\checkpoints\\` | `launch.py` |
| `D:\\AI_Tools\\Fooocus-2.5.5\\` | `fooocus_env` venv | `models\\` | `entry_with_update.py` |

The `fooocus\\` variant is a plain code checkout using system Python (no venv). The `Fooocus-2.5.5\\` variant uses the dedicated `fooocus_env` virtual environment. Both work independently but share the `D:` drive.

## Desktop Shortcut

A `.lnk` shortcut on the user's desktop points to `D:\\AI_Tools\\fooocus\\run_fooocus.bat`, which handles error display:

```batch
@echo off
title Fooocus AI 图像生成
cd /d D:\AI_Tools\fooocus
echo Starting Fooocus...
"C:\Program Files\Python310\python.exe" launch.py
echo 程序已退出，错误码: %ERRORLEVEL%
pause
```

The `pause` at the end prevents the window from closing on error. To create a similar shortcut via PowerShell:

```powershell
$ws = New-Object -ComObject WScript.Shell
$sc = $ws.CreateShortcut("$env:USERPROFILE\Desktop\Fooocus.lnk")
$sc.TargetPath = "D:\AI_Tools\fooocus\run_fooocus.bat"
$sc.WorkingDirectory = "D:\AI_Tools\fooocus"
$sc.Save()
```

## Stray Process Cleanup

Fooocus or other Python processes may leave orphaned `python.exe` instances consuming GPU VRAM. On Windows, identifying which Python PID is which requires command-line inspection.

### Reliable Approach (from WSL/git-bash via execute_code)

The `execute_code` tool (Python subprocess calling PowerShell) reliably gets full command lines — git-bash's quoting doesn't interfere:

```python
import subprocess
# Get ALL python.exe processes with full command lines
result = subprocess.run(
    ['powershell.exe', '-ExecutionPolicy', 'Bypass', '-Command',
     'Get-CimInstance Win32_Process -Filter "Name=\'python.exe\'" | Select-Object ProcessId, CommandLine | Format-Table -AutoSize -Wrap'],
    capture_output=True, text=True, timeout=15
)
print(result.stdout)
```

Then from the output, grep for `entry_with_update` or `direct_start` to find Fooocus-specific PIDs.

### Kill a Specific PID

```bash
/c/Windows/System32/taskkill.exe /F /PID <PID_NUMBER>
```

### What NOT to Do

Commands that appear to work from git-bash but fail due to quoting/redirect issues:

- `wmic process where "name='python.exe'" get CommandLine` — git-bash mangles quotes
- PowerShell inline with `-Command` and nested quotes — bash strips or transforms `$_`, `$_.ProcessName` etc.
- `.cmd` scripts with `> D:\output.txt` redirect — the redirect doesn't survive cmd.exe invocation from git-bash
- `Get-Process` — does NOT give command-line arguments (only process name and PID)

### Identifying Fooocus vs Non-Fooocus Python Processes

On this system, Fooocus-related Python processes run `entry_with_update.py` or `direct_start.py`. Non-Fooocus processes include:

| Role | Binary | Pattern |
|------|--------|---------|
| dasha Gateway | `dasha venv` or `Python311` | `-m dasha_cli.main gateway run --replace` |
| dasha Web UI bridge | `dasha venv` or `Python311` | `dasha_bridge.py --endpoint tcp://...` |
| Fooocus (correct) | `fooocus_env\Scripts\python.exe` | `entry_with_update.py --language cn` |
| Fooocus (duplicate) | `C:\Program Files\Python310\python.exe` | `entry_with_update.py --language cn` |
| Temporary sandbox | any python.exe | `dasha_sandbox_*\script.py` |

**Don't lump all Python processes together as Fooocus** — dasha runs its own Python processes that should never be killed.

## GPU Acceleration

### Checking CUDA Availability in the Venv

```bash
/d/AI_Tools/fooocus_env/Scripts/python -c "import torch; print('CUDA:', torch.cuda.is_available()); print('Device:', torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'CPU')"
```

### Why Fooocus Might Run on CPU Despite CUDA Being Available

Possible causes:
1. **numba JIT crash (Blackwell GPUs):** RTX 5060 (sm_120/Blackwell) with numba < 0.65.0 + llvmlite < 0.47.0 causes `OSError: exception: privileged instruction`. This crashes the model loading thread silently — Fooocus falls back to CPU.
2. **Out of VRAM:** SDXL with FP16 needs ~7GB VRAM. 8GB laptop GPU (RTX 5060) is tight. If other apps use VRAM, Fooocus may fall back to CPU.
### Fixing the numba crash (RTX 5060 Blackwell)

The RTX 5060 Laptop GPU uses the **Blackwell architecture (sm_120)**. Older numba/llvmlite versions crash with `OSError: exception: privileged instruction` when compiling CUDA kernels during model loading.

```bash
# Activate venv
source /d/AI_Tools/fooocus_env/Scripts/activate

# Upgrade numba and llvmlite
pip install --upgrade numba==0.65.1 llvmlite==0.47.0

# Verify
python -c "import numba; print(numba.__version__); from numba.core import config; print('NVIDIA support:', config.COMPATIBILITY_CHECK)"
```

**Version Requirements:**
- numba >= 0.65.0
- llvmlite >= 0.47.0 (corresponding version for numba 0.65.x)
- Earlier versions lack Blackwell (sm_120) JIT support

### CUDA / Torch Compatibility with RTX 5060 (Blackwell sm_120)

The RTX 5060 uses **CUDA capability sm_120** (Blackwell microarchitecture). This is CRITICAL — not all PyTorch versions support it:

| Torch Version | sm_120 Support | Status |
|---|---|---|
| < 2.5.0 | No | Falls back or errors |
| 2.5.x (e.g. 2.5.1+cu121) | No | Issues warning "not compatible with the current PyTorch installation" but may partially work on CUDA with degraded performance |
| 2.6.x | Partial | |
| >= 2.8.0+cu128 | Yes ✅ | Full support, no warnings |

**To check for the sm_120 warning, look at Fooocus startup logs:**
```
NVIDIA GeForce RTX 5060 Laptop GPU with CUDA capability sm_120 is not compatible
with the current PyTorch installation. The current PyTorch install supports CUDA
capabilities sm_50 sm_60 sm_61 sm_70 sm_75 sm_80 sm_86 sm_90.
```

**To install the correct PyTorch for Blackwell (from local wheel files):**\n\nThis user has local wheel files in `D:\\AI_Tools\\Fooocus-2.5.5\\` for offline install. Available versions:\n\n| Package | File | Notes |\n|---------|------|-------|\n| torch | `torch-2.8.0+cu128-cp310-cp310-win_amd64.whl` | ✅ sm_120 support |\n| torchvision | `torchvision-0.23.0+cu128-cp310-cp310-win_amd64.whl` | Compatible with torch 2.8.0 |\n| torchaudio | `torchaudio-2.8.0+cu128-cp310-cp310-win_amd64.whl` | Matches torch 2.8.0 |\n\n**⚠️ torchvision version matching:** `torchvision-0.26.0+cu128` requires `torch==2.11.0` (too new for torch 2.8.0). Use `torchvision-0.23.0+cu128` instead.\n\n**Install command (clean install, with numpy fallback):**\n```bash\n# First uninstall old packages\npip uninstall torch torchvision torchaudio numpy -y\n\n# Install from wheels, pin numpy<2 to avoid incompatibility with older packages\npip install ^\n  D:\\AI_Tools\\Fooocus-2.5.5\\torch-2.8.0+cu128-cp310-cp310-win_amd64.whl ^\n  D:\\AI_Tools\\Fooocus-2.5.5\\torchvision-0.23.0+cu128-cp310-cp310-win_amd64.whl ^\n  D:\\AI_Tools\\Fooocus-2.5.5\\torchaudio-2.8.0+cu128-cp310-cp310-win_amd64.whl ^\n  \"numpy<2\"\n```\n\n**Verify after install:**\n```python\nimport torch\nprint(torch.__version__)               # Must be 2.8.0+cu128\nprint(torch.cuda.is_available())       # Must be True\nprint(torch.cuda.get_arch_list())      # Must include 'sm_120'\n```\n\n**⚠️ numpy version trap:** torch 2.8.0's installer may pull `numpy>=2` as a dependency, but many Python packages (including older versions of fooocus dependencies) are compiled against `numpy<2` and crash with:\n```\nA module that was compiled using NumPy 1.x cannot be run in NumPy 2.2.6 as it may crash.\n```\nAlways pin `numpy<2` when installing torch 2.8.0 alongside legacy ML packages.\n\n**Alternative (online install via PyPI):**\n```bash\n/d/AI_Tools/fooocus_env/Scripts/pip install torch==2.8.0+cu128 torchvision==0.23.0+cu128 torchaudio==2.8.0+cu128 \"numpy<2\" --index-url https://download.pytorch.org/whl/cu128\n```

**When torch was working before but suddenly stopped:**
This user previously had torch 2.8.0+cu128 installed (confirmed by `torchaudio-2.8.0+cu128.dist-info` still present in site-packages), but the torch package files were deleted — possibly by a disk cleanup tool scanning for large files. The `.dist-info` remained but the actual `torch/` directory was gone, causing `import torch` to fail silently inside the venv. Check for this pattern: dist-info exists but the matching package directory is missing.

## Model Path Configuration

Models are configured in `Fooocus-2.5.5/config.txt`:

```ini
path_checkpoints = D:\AI_Tools\Fooocus-2.5.5\models\
path_loras = D:\AI_Tools\Fooocus-2.5.5\models\loras
path_embeddings = D:\AI_Tools\Fooocus-2.5.5\models\embeddings
path_vae_approx = D:\AI_Tools\Fooocus-2.5.5\models\vae_approx
path_controlnet = D:\AI_Tools\Fooocus-2.5.5\models\controlnet
path_clip = D:\AI_Tools\Fooocus-2.5.5\models\clip
path_intermediate = D:\AI_Tools\Fooocus-2.5.5\outputs\
default_model = juggernautXL_versionX.safetensors
```

**Current models on this system:**
- `juggernautXL_versionX.safetensors` (6.7 GB) — main SDXL model
- `realisticStockPhoto_v20.safetensors` — partially downloaded/incomplete

**Model duplicates found:**
- `juggernautXL` exists in both `Fooocus-2.5.5/models/` AND `fooocus_env/models/` — safe to delete from `fooocus_env/models/`
- `sd_xl_base_1.0.safetensors.corrupted` (1.9 GB) in `fooocus_env/models/` — corrupted/incomplete download
- Various `.partial` files in `Fooocus-2.5.5/models/` — incomplete downloads

## Common Issues & Fixes

### Issue 1: Fooocus Process Starts but Port 7865 Never Opens

The process shows in tasklist but doesn't respond on port. Diagnosis:

```bash
# Is the process actually running?
ps aux | grep python  # or on Windows: cmd.exe //c "tasklist | findstr python"
# Is the port listening?
cmd.exe //c "netstat -ano | findstr :7865"
```

Common causes (check in this order):
1. **`--skip-pip` in launcher args** — `entry_with_update.py` doesn't recognize this arg, `parse_args()` throws error, exits immediately. Remove `--skip-pip` from the command line.
2. **The git update phase** — `entry_with_update.py` tries `pygit2` to fetch updates on first run. If there's no `.git` directory, it prints "Repository not found" and continues. This is normal, not a block.
3. **numba JIT crash** (see above) — fix by upgrading numba/llvmlite. The crash silently aborts model loading, the server never starts.
4. **Model download in progress** — On first launch, Fooocus downloads models from HuggingFace. Can take 2-10 minutes depending on network. Let it run unattended.
5. **Out of disk space** — Model downloads fail silently. Check available space on both C: and D: drives.

### Issue 2: C: Drive Space Drops When Fooocus Runs

When Fooocus loads large models (6.7 GB juggernautXL), Windows may dynamically expand `pagefile.sys` on C: drive to handle memory pressure. This can consume 10-20 GB of C: space temporarily.

**Not a real leak** — the pagefile will shrink after reboot or when memory pressure subsides.

**Workaround:** Set a fixed pagefile size to prevent dynamic expansion:
```cmd
wmic computersystem where name="%computername%" set AutomaticManagedPagefile=False
wmic pagefileset where name="C:\\pagefile.sys" set InitialSize=32768,MaximumSize=32768
```

### Issue 3: Launcher Scripts (fooocus中文启动.bat, 启动Fooocus.bat)

The user has two batch files in `D:\AI_Tools\` root. They call `entry_with_update.py` with or without `--language cn`. After the D:\AI_Tools\ root cleanup (user deleted + restored them), they may have inconsistent content.

To recreate the Chinese launcher:
```
write_file writes D:\\AI_Tools\\fooocus中文启动.bat with the content from the batch template above.
```

### Issue 5: Extremely Slow Generation (~20s/step on RTX 5060 When It Should Be 1-3s)

**Symptoms:** Each sampling step takes ~15-20s instead of 1-3s. GPU-Util shows low usage. VRAM isn't full. OR: sampling steps themselves are fast but there are long pauses between images and after the last sampling step before completion.

**Root Cause #1: FORCE_FP32 = True in model_patcher.py**

The file `ldm_patched/modules/model_patcher.py` has a global variable at the top:

```python
FORCE_FP32 = True   # ← THIS IS THE PROBLEM
```

When True, ALL models (UNet, VAE, CLIP) run in full float32 precision instead of float16. For SDXL on an 8GB RTX 5060:
- Memory usage doubles vs fp16
- Each step goes from ~1-2s to ~20s
- Can trigger OOM or CPU fallback on some ops

**Fix — override in args_parser.py:**

Edit `ldm_patched/modules/args_parser.py` and after the line `parser.add_argument('--fp32', ...)` (which defaults to False), OR more reliably, modify `args_parser.py` to set `default=False` for the `--fp32` argument if it currently defaults to True. But actually the deeper issue is that `model_patcher.py` hardcodes `FORCE_FP32 = True` — the cleanest fix is to change that to `FORCE_FP32 = False`:

```python
# In ldm_patched/modules/model_patcher.py, find around line 220
FORCE_FP32 = False  # Changed from True — allows fp16 inference, ~10x faster
```

**Root Cause #2: Default resolution 896×1152 is very high for 8GB**

Fooocus defaults to SDXL's native 896×1152 resolution. On an 8GB card this causes high memory pressure even in fp16. Lowering to 768×768 or 1024×576 during testing helps isolate whether the bottleneck is precision or resolution.

**Root Cause #3: Duplicate Fooocus instances competing for GPU (see Issue 6)**

### Issue 6: Multiple Duplicate Fooocus Instances (System Python + fooocus_env)

**Symptoms:** Fooocus starts but is very slow. GPU memory shows high usage with no obvious explanation. Port 7865 responds but generation is sluggish.

**Discovery:** This user's system has `C:\Program Files\Python310\python.exe` (system Python) which ALSO has torch 2.8.0+cu128 installed. When a batch file or VBS script launches `entry_with_update.py`, it may use system Python depending on `PATH` resolution — or `entry_with_update.py` may spawn a child process that inherits a different Python.

**Result:** Two Fooocus processes launch simultaneously:
- System Python PID (2.94 GB RAM + GPU usage)
- fooocus_env PID (normal memory)

Both compete for the 8GB GPU VRAM, causing thrashing.

**Fix — identify and kill duplicates precisely:**

```bash
# First, enumerate all Fooocus-related processes with full command lines
# (Use the execute_code Python subprocess approach above, or:)

# Quick check: are there multiple Fooocus PIDs in tasklist?
/c/Windows/System32/tasklist.exe /FI "IMAGENAME eq python.exe" /FO CSV /NH
# Note the PIDs, then check their command lines via Get-CimInstance

# Kill specific known-duplicate PIDs
/c/Windows/System32/taskkill.exe /F /PID 49288
/c/Windows/System32/taskkill.exe /F /PID 33716
```

**⚠️ Don't use `pkill -f entry_with_update` from git-bash** — `pkill` only kills WSL-side processes, not Windows native processes. Use `taskkill /F /PID <N>` instead.

**⚠️ Don't use `taskkill /FI "WINDOWTITLE eq ..."`** — Fooocus processes run without visible windows (Python console windows), so window-title filters don't match.

**Prevention:** Ensure the launcher batch file explicitly uses the full path to `fooocus_env\Scripts\python.exe` — never rely on `PATH` or `python` without the full path. Also check that `entry_with_update.py` isn't being launched from Windows File Explorer by double-clicking the .py file itself (which uses the default file association → system Python).

**Root Cause #4: `--always-low-vram` flag (model unloads/reloads between each image)**

**Symptoms:** Sampling steps themselves are fast (1-3s each) once they start, but there's a 10-30s pause between finishing image A and starting image B, and another 10-30s pause after the last sampling step before the final image appears. These delays add up significantly when generating multiple images.

**Root cause:** The `--always-low-vram` flag forces Fooocus into LOW_VRAM mode regardless of GPU VRAM. In this mode, `model_management.py` (line 121-128) unloads the model from GPU after each image and reloads it for the next. The auto-detection logic at line 124 only triggers LOW_VRAM when VRAM <= 4GB (`torch.cuda.get_device_properties(0).total_memory / (1024**3) <= 4.0`). On an 8GB RTX 5060, LOW_VRAM is never auto-triggered — it's only activated via `--always-low-vram`.

**Fix:** Remove `--always-low-vram` from the Fooocus launcher command line. On 8GB GPUs this flag is purely harmful — it adds unnecessary model load/unload overhead between every image.

**Root Cause #5: `--vae-in-cpu` flag (VAE decoding on CPU in fp32)**

**Symptoms:** After sampling completes, there's a long pause before the generated image displays. The GPU-Util drops to near-zero during this phase while CPU usage spikes.

**Root cause:** The `--vae-in-cpu` flag forces VAE decoding to run on CPU in full fp32 precision. By default, `model_management.py` line 190 sets `VAE_DTYPE = torch.bfloat16` and runs VAE on GPU. The `--vae-in-cpu` flag overrides this, moving VAE to CPU+fp32 — which is ~20x slower. This flag is NOT defined in `args_parser.py` (not a recognized CLI arg), but may be hardcoded in a custom launcher or wrapper script.

**Fix:** Remove any reference to `--vae-in-cpu` from the Fooocus launcher. On RTX 5060 with 8GB VRAM and torch 2.8.0+cu128, VAE runs properly on GPU at bf16 without any special flags.

**Note:** `--all-in-fp32` is a separate issue — it forces the UNet to fp32 (causes slow individual steps, not inter-image delays). See Root Cause #1 above. These three flags (`--always-low-vram`, `--vae-in-cpu`, `--all-in-fp32`) are independent and may appear together in launcher scripts. Remove all three for normal operation on RTX 5060 8GB.

### Issue 7: Torch dist-info Exists but `import torch` Fails (After Disk Cleanup)

Pattern: `ls site-packages/ | grep torch` shows `torchaudio-2.8.0+cu128.dist-info` (metadata), but `import torch` in the venv Python fails with `ModuleNotFoundError`. The actual `torch/` package directory is gone.

**What happened:** A disk cleanup tool (Windows Disk Cleanup, CCleaner, or manual "delete large files") scanned `D:\AI_Tools\fooocus_env\Lib\site-packages\` and removed the torch package (1.5-2 GB) as "large temporary files". The `.dist-info` directories are small (a few KB) and survived.

**Check:**
```bash
# Package directory must exist
ls /d/AI_Tools/fooocus_env/Lib/site-packages/ | grep "^torch$"
# dist-info should also exist
ls /d/AI_Tools/fooocus_env/Lib/site-packages/ | grep "torch-.*dist-info"
```

**Fix:** Reinstall torch — see the CUDA/Torch Compatibility section above for the correct version.

## File Organization Tips

- **Do NOT confuse** `fooocus_env` (venv only) with `Fooocus-2.5.5` (code+models)
- **Don't delete** `Fooocus-2.5.5/language/cn.json` — it's the Chinese translation file
- **Models folder** `Fooocus-2.5.5/models/` is 11 GB — the main storage
- **Do NOT download** models to C: drive — they go in D:\AI_Tools\Fooocus-2.5.5\models\

## Related Skills

- `comfyui` — the other AI image gen tool on this system; shares model files
- `storage-audit` — for analyzing disk space (pagefile, model duplicates)
