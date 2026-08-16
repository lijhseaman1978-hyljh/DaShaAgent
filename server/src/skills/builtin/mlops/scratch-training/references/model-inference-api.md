# API Response Formats

## `/api/status` — GET

```json
{
  "loaded": true,
  "params_m": 33.44,
  "device": "cuda",
  "model_path": "D:/dasha/WORKSPACE/ai_training/models/best_model.pt",
  "vocab_size": 12000,
  "embed_dim": 512,
  "num_layers": 8,
  "num_heads": 8,
  "params": {
    "temperature": 0.8,
    "top_k": 40,
    "top_p": 0.9,
    "max_length": 200,
    "system_prompt": "你是一个有用的 AI 助手。"
  },
  "cuda_available": true,
  "gpu_memory": "0.1GB/8.0GB",
  "conversations": 0
}
```

## `/api/chat` — POST

Request:
```json
{
  "session_id": "default",
  "message": "你好",
  "params": {
    "temperature": 0.8,
    "top_k": 40,
    "top_p": 0.9,
    "max_length": 200
  }
}
```

Response:
```json
{
  "response": "的和和和和",
  "session_id": "test1"
}
```

## `/api/settings` — POST

Request:
```json
{
  "temperature": 0.9,
  "top_k": 50,
  "system_prompt": "你是一个有用的 AI 助手。"
}
```

Response:
```json
{
  "success": true,
  "params": { "...updated params..." }
}
```

## `/api/checkpoints` — GET

```json
{
  "checkpoints": [
    {"name": "checkpoint_epoch30.pt", "path": "D:/...", "size_mb": 383.0, "mtime": "2026-05-30 20:08"},
    {"name": "checkpoint_epoch29.pt", "path": "D:/...", "size_mb": 383.0, "mtime": "2026-05-30 19:37"},
    ...
  ],
  "current": "best_model.pt"
}
```

## `/api/switch_model` — POST

Request: `{"path": "D:/.../checkpoint_epoch20.pt"}`

Response: Same as `/api/status` (returns new model info after load).

## Model Loading Pattern

```python
state = torch.load(self.model_path, map_location=DEVICE)
if isinstance(state, dict) and 'model_state_dict' in state:
    self.model.load_state_dict(state['model_state_dict'])
else:
    self.model.load_state_dict(state)  # bare state_dict
```

The model might be saved two ways — either bare `state_dict()` or wrapped in a dict with `'model_state_dict'` key (if the trainer also saves optimizer state). Handle both.

## Generation Parameters

| Param | Range | Default | Effect |
|-------|-------|---------|--------|
| temperature | 0.1 - 2.0 | 0.8 | Lower = more deterministic, higher = more random |
| top_k | 1 - 100 | 40 | Only sample from top K tokens |
| top_p | 0.1 - 1.0 | 0.9 | Nucleus sampling: cumulative probability threshold |
| max_length | 10 - 500 | 200 | Max tokens to generate per response |

## GPU Memory Usage

- 33M model + inference context: ~500MB-1.2GB on CUDA
- best_model.pt (128MB) = saved after each epoch if loss improved
- checkpoint_epochN.pt (383MB) = full checkpoint with optimizer state
