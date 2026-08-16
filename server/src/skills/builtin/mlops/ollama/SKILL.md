---
name: ollama
description: Ollama local inference server — install, diagnose GPU usage, check environment/config, benchmark performance, and troubleshoot on Windows/Linux.
category: mlops
---

# Ollama — Local LLM Inference Server

## When to Use

- User asks about Ollama installation, configuration, or performance
- Diagnosing whether Ollama is using GPU or CPU
- Checking environment variables (CUDA_VISIBLE_DEVICES, OLLAMA_GPU_LAYERS, etc.)
- Benchmarking inference speed (tokens/sec)
- Investigating Ollama process health on Windows (multiple instances, port conflicts)
- Choosing models to run locally via Ollama

## GPU Diagnostics Workflow

### Step 1: Check Ollama Process & Version

**Linux/WSL:**
```bash
ollama --version
ps aux | grep ollama
```

**Windows (from git-bash):**
```bash
cd /c/ && cmd.exe /c "tasklist /FI \"IMAGENAME eq ollama.exe\" /FO CSV /NH"
```

**Windows (PowerShell):**
```powershell
Get-Process -Name ollama | Select-Object Id, ProcessName, StartTime, CPU, @{N='MemMB';E={[math]::Round($_.WorkingSet64/1MB, 1)}}
```

### Step 2: Check Environment Variables

Critical env vars that control GPU usage:

| Variable | Purpose |
|----------|---------|
| `CUDA_VISIBLE_DEVICES` | Which GPU(s) to use |
| `OLLAMA_GPU_LAYERS` | -1=all on GPU, 0=CPU only |
| `OLLAMA_GPU_MEMORY` | VRAM limit per model |
| `OLLAMA_FLASH_ATTENTION` | Enable flash attention |
| `OLLAMA_HOST` | Listen address |
| `OLLAMA_MODELS` | Model storage path |
| `OLLAMA_ORIGINS` | CORS origins allowed |

**Check from PowerShell:**
```powershell
$p = Get-Process -Name ollama -Id <PID>
$p.StartInfo.EnvironmentVariables
```

### Step 3: VRAM Delta Test (Most Reliable GPU Indicator)

Run inference on a tiny model and measure VRAM change:

```powershell
$before = (nvidia-smi --query-gpu=memory.used --format=csv,noheader -i 0).Trim(' MiB')
$start = Get-Date
$resp = curl.exe -s http://localhost:11434/api/generate -d '{\"model\":\"llama3.2:1b\",\"prompt\":\"count 1 to 5\",\"stream\":false}'
$elapsed = (Get-Date) - $start
$after = (nvidia-smi --query-gpu=memory.used --format=csv,noheader -i 0).Trim(' MiB')
Write-Host "VRAM before: $before MiB, after: $after MiB, delta: $($after - $before) MiB"
Write-Host "Time: $($elapsed.TotalSeconds)s"
```

- VRAM delta > 500 MiB = GPU inference confirmed
- Minimal change = likely CPU fallback

### Step 4: Measure Tokens/sec

```powershell
$resp = curl.exe -s http://localhost:11434/api/generate -d '{\"model\":\"llama3.2:1b\",\"prompt\":\"count 1 to 10\",\"stream\":false}' | ConvertFrom-Json
Write-Host "Tokens: $($resp.eval_count) | Duration: $($resp.total_duration/1e9)s | Speed: $($resp.eval_count / ($resp.eval_duration/1e9)) tok/s"
```

Reference speeds on RTX 5060 (8GB Blackwell):
- llama3.2:1b: ~237 tok/s
- phi3:mini (2.2B, cold start): ~10.5s first response

### Step 5: Check Logs

```powershell
Get-Content "$env:LOCALAPPDATA\Ollama\server.log" -Tail 50
Get-Content "$env:LOCALAPPDATA\Ollama\app.log" -Tail 50
```

Watch for:
- `source=gpu.go` — GPU detection success
- `source=cpu.go` — CPU fallback (problematic)
- `bind: address already in use` — port conflict
- `CUDA error` — CUDA/driver issue

### Step 6: Check Loaded Models

```bash
ollama ps
```

Shows currently loaded model, processor (GPU/CPU), context.

## Windows-Specific Notes

### Multiple Processes & Port Conflict

Ollama on Windows can have multiple instances (one from service, one manual). Only one can bind to port 11434. Fix:

```powershell
# Kill older process
Stop-Process -Id <old-PID> -Force
```

### Ollama Does NOT Show in nvidia-smi Process List (on Windows)

On Windows, Ollama shows as type `C` not `C+G` in nvidia-smi, and GPU memory column shows `N/A`. This is normal — do not conclude GPU is not being used. Use VRAM delta test.

### No CUDA Toolkit Required

Ollama uses nvcuda.dll from the NVIDIA driver itself. Full CUDA Toolkit installation is NOT needed.

### Config File

`$env:USERPROFILE\.ollama\config.json`:
```json
{
  "models": {
    "model-name": {
      "num_gpu": -1,
      "flash_attention": true,
      "f16_kv": true,
      "num_ctx": 4096
    }
  }
}
```

### Service

Ollama runs as a Windows service. Check with `Get-Service ollama`.

## Linux/WSL Notes

- Service: `systemctl --user status ollama`
- Config: `~/.ollama/`
- Models: `~/.ollama/models/` or custom via `OLLAMA_MODELS`
- nvidia-smi shows Ollama as type `C` compute process

## Config Reference

| Setting | Effect | Recommended |
|---------|--------|-------------|
| `num_gpu: -1` | All layers on GPU | Yes |
| `flash_attention: true` | Memory-efficient attention | Yes |
| `f16_kv: true` | FP16 KV cache | Yes |
| `num_ctx: 4096` | Context window | 4096-8192 |
| `OLLAMA_GPU_MEMORY: 7000MB` | VRAM cap per model | Leave 1-2GB free |

## Reference Files

- **[windows-gpu-diagnostic.md](references/windows-gpu-diagnostic.md)** — Concrete session transcript and env dump from RTX 5060 diagnostics. Use as reference when troubleshooting GPU usage on Windows.

## Pitfalls

- **Not in nvidia-smi = not using GPU?** No. C-type processes on Windows don't show memory. Always use VRAM delta test.
- **Two Ollama processes = port conflict.** Kill the older one.
- **Fresh install with old config:** After upgrade, env vars may need re-setting via Windows system env vars, not just from a script session.
- **WSL vs Windows Ollama:** Both can coexist on different ports. Docker Desktop's WSL2 backend does not conflict by default.
