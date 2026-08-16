# OmniVoice Studio — Offline Torch Installation Reproduction

**Problem**: OmniVoice Studio (v0.2.7) on first startup runs `uv sync` which downloads torch 2.8.0+cu128 (3.2GB) from https://download.pytorch.org/whl/cu128

**System**: Windows, RTX 5060 (Blackwell sm_120), Python 3.11

## Finding the project root

The exe (`omnivoice-studio.exe`) copies the project to AppData on first run:

```
Found project root: C:\Users\<user>\AppData\Local\com.debpalash.omnivoice-studio\project
```

The pyproject.toml there is the one that matters — NOT `D:\SOFT\OmniVoice\_up_\up_\pyproject.toml`.

## key lines from pyproject.toml

```toml
# Source routing — must match your Python version
[tool.uv.sources]
torch = [
  { index = "pytorch-cuda", marker = "sys_platform == 'linux' or sys_platform == 'win32'" },
]
torchaudio = [
  { index = "pytorch-cuda", marker = "sys_platform == 'linux' or sys_platform == 'win32'" },
]

[[tool.uv.index]]
name = "pytorch-cuda"
url = "https://download.pytorch.org/whl/cu128"
explicit = true

# Constraint pins to 2.8.0
[tool.uv]
constraint-dependencies = [
    "torch==2.8.0",
    "torchaudio==2.8.0",
]
```

## What didn't work

1. **UV_FIND_LINKS env var** — exe spawns uv with a clean environment, ignores the var
2. **Editing tool.uv.sources to path-based** — uv multi-version resolution fails because a cp311 wheel can't satisfy >=3.11 (needs cp311+cp312+cp313)
3. **Editing pyproject.toml in D:\SOFT** — exe reads the copy in AppData, not the install directory

## What worked

```bash
# 1. Delete old venv
rm -rf .venv
rm -f uv.lock

# 2. Pre-install torch + torchaudio from local cp311 wheels
uv pip install --python .venv/Scripts/python.exe \
  --find-links "C:/Users/<user>/Downloads/torch-2.8.0/" \
  torch==2.8.0 torchaudio==2.8.0
# Output: Resolved 10 packages in 4.15s, Installed 10 packages in 17.64s

# 3. Run uv sync (or exe) for the remaining ~190 deps
uv sync  # takes 2-3 minutes
```

## Verification

```bash
# Check torch installed
uv pip list --python .venv/Scripts/python.exe | grep torch
# Should show: torch 2.8.0+cu128, torchaudio 2.8.0+cu128

# Count all packages
ls .venv/Lib/site-packages/ | wc -l
# Should show ~423 packages after full sync
```

## Wheel naming convention

```
torch-{version}+{cuda}-cp{python}-cp{python}-{platform}.whl
         ^^^^^^^^    ^^^^^^    ^^^^^^
         CUDA ver    Python version labels (must match user's Python)
```

- `cp310` = Python 3.10
- `cp311` = Python 3.11
- `cp312` = Python 3.12

CUDA 12.8 index: https://download.pytorch.org/whl/cu128/
