---
title: Offline Python Dependency Installation
name: offline-python-deps
description: Pre-install large Python wheels (PyTorch, torchaudio, etc.) from local files before running an app's installer, to skip multi-GB downloads.
tags: [torch, uv, pip, offline, windows, wheels]
category: devops
---

# Offline Python Dependency Installation

Use when an app bundles `uv` or `pip` and tries to download large ML wheels (torch, torchaudio, etc.) during first startup. Pre-installing from local files skips the multi-GB download.

## Trigger
- User says "让它直接使用本地的，不要先去下载"
- An app's first-run installer shows `Downloading torch (3.2GiB)`
- App uses `uv sync` or `uv pip install` and you have the wheels locally

## Workflow

### 1. Check the wheel files
Verify the .whl files match the **Python version** the app uses (not just the torch version):
```
torch-2.8.0+cu128-cp310-cp310-win_amd64.whl   ← Python 3.10 only
torch-2.8.0+cu128-cp311-cp311-win_amd64.whl   ← Python 3.11 only
```
The `cpXY` tag must match the app's Python requirement (`requires-python` in pyproject.toml).

### 2. Find the REAL project root
The app's installer may copy the project to AppData. The exe's log reveals it:
```
Found project root: C:\Users\<user>\AppData\Local\<vendor>\<app>\project
```
Check this directory — the pyproject.toml there is the one uv reads, NOT the one in the install directory.

### 3. Pre-install torch & torchaudio from local wheels
```bash
# Navigate to the project root
cd "C:/Users/<user>/AppData/Local/<vendor>/<app>/project"

# Create venv (if not already present) and install from local wheels
uv pip install --python .venv/Scripts/python.exe \
  --find-links "C:/Users/<user>/Downloads/wheel-dir/" \
  torch==2.8.0 torchaudio==2.8.0
```
Key: `--find-links` (NOT `--no-index`) so torch comes from local while its dependencies (filelock, jinja2, etc.) download from PyPI normally.

### 4. Run the app's normal installer
After torch is in the venv, running `uv sync` or the app exe will:
1. Detect torch/torchaudio already installed at the right version
2. Skip the multi-GB download
3. Only install the remaining ~190 smaller packages from PyPI

**OR** let `uv sync` run in background — it will eventually complete after resolving the full dependency graph (can take 2-3 minutes for 190+ deps).

## Pitfalls

### ❌ UV_FIND_LINKS env var doesn't always work
Setting `UV_FIND_LINKS` before launching the app's exe may be ignored — the exe might spawn uv with a clean environment. Directly installing into the .venv is more reliable.

### ❌ Don't use `tool.uv.sources` with local paths for multi-version projects
Changing pyproject.toml `tool.uv.sources` from index-based to path-based fails when `requires-python` spans multiple versions (e.g., `>=3.11`):
- uv resolves for ALL supported Python versions (3.11, 3.12, 3.13)
- A cp311-only wheel fails the 3.12/3.13 resolution forks
- Error: `torchaudio has no wheels with a matching Python version tag`

### ❌ Don't modify pyproject.toml if you can pre-install instead
Restoring original config after pre-installing is safer — `uv sync` finds the matching version in .venv and skips the download naturally.

### ✅ The reliable approach
1. Leave pyproject.toml at its original configuration
2. Delete old .venv to start fresh
3. `uv pip install --find-links <dir> torch==X.Y torchaudio==X.Y` into the venv
4. Run app exe normally or `uv sync` for the rest

### ⚠️ uv lock/sync takes time for complex dep graphs
For 190+ dependencies with transitive deps, uv resolution + installation can take 2-5 minutes. Be patient. The process is not hanging — it's working through the graph.

### ⚠️ Wheel Python version tag mismatch
If you download `cp310` wheels but the app needs `cp311`, uv will silently skip them and try the internet instead. Always match cpXY tag to the app's `requires-python`.

### ⚠️ .venv lock file
If a previous uv sync was interrupted, `.venv/.lock` may persist and block new processes. Delete it with `rm -f .venv/.lock` before retrying.

## Verification

### Package check
```bash
uv pip list --python .venv/Scripts/python.exe | grep torch
# Should show: torch X.Y+cu128, torchaudio X.Y+cu128
```

### GPU check (apps with health endpoint)
After starting the backend, hit the health endpoint:
```bash
curl -s http://localhost:<port>/health
# Expected: {"status":"ok","device":"cuda (NVIDIA ...)"}
```
Confirms torch uses GPU, not CPU fallback — especially important for Blackwell (sm_120) GPUs that need torch >= 2.5+.

## References
- `references/omnivoice-studio-setup.md` — full reproduction from this session
