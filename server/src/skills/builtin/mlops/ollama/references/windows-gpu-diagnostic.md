# Ollama GPU Diagnostic Reference

## Session Context (2026-05-23)

Diagnosed Ollama GPU usage on Windows 10 with RTX 5060 Laptop GPU (8GB, Blackwell sm_120).

### Environment Found

| Variable | Value | Meaning |
|----------|-------|---------|
| CUDA_VISIBLE_DEVICES | 0 | Using GPU 0 |
| OLLAMA_GPU_LAYERS | -1 | All layers on GPU |
| OLLAMA_GPU_MEMORY | 7000MB | VRAM cap, leaving ~1GB for OS/display |
| OLLAMA_FLASH_ATTENTION | 1 | Enabled |
| OLLAMA_HOST | 0.0.0.0 | Listen all interfaces |
| OLLAMA_MODELS | D:\Ollama\Models | Custom model storage path |

### Key Findings on Windows

1. **Ollama DOES use GPU on RTX 5060** — confirmed by VRAM delta test (1874 MB idle → 3533 MB during inference)
2. **nvidia-smi does NOT show Ollama GPU memory** — Ollama shows as type `C` (compute) in the process list, with N/A memory. This is a Windows nvidia-smi limitation, NOT an indication of CPU fallback.
3. **No CUDA Toolkit needed** — Ollama uses nvcuda.dll from the NVIDIA driver (596.36, supporting CUDA 13.2)
4. **Performance** — llama3.2:1b: ~237 tok/s, phi3:mini first response: ~10.5s (includes model load)
5. **Two processes = port conflict** — Old service instance (PID 23252, 106MB) + manual run (PID 40892, 7866MB). One cannot bind to 11434.

### Files Created

- `D:\dasha\WORKSPACE\check_ollama_gpu.ps1` — Main diagnostic script (env vars, processes, VRAM, inference test)
- `D:\dasha\WORKSPACE\fix_gpu_env.ps1` — Environment variable setter

### Models on Disk (D:\Ollama, 102GB)

Key models: dasha3:8b (4.7GB), gemma4:e4b (9.6GB), qwen3.5:4b/9b, deepseek-r1:14b/7b, llama3.2:1b/3b, gemma3:4b/12b/27b, qwen3:4b/8b, MFDoom/deepseek-r1-tool-calling:7b, bge-m3, nomic-embed-text, all-minilm:l6-v2

### Config

`%USERPROFILE%\.ollama\config.json`:
```json
{
  "integrations": { "openclaw": { "models": ["qwen3.5"] } },
  "last_model": "qwen3.5:9b-q4_K_M",
  "models": {
    "qwen3.5:9b-q4_K_M": {
      "num_gpu": 20,
      "flash_attention": true,
      "f16_kv": true,
      "num_ctx": 4096
    }
  }
}
```
