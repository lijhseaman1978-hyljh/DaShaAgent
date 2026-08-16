# AI Chat Web UI — Model Inference Server



## Overview



After training a custom TransformerLM from scratch, provide a **web-based chat interface** instead of the CLI-only `chat_with_model.py`. Architecture: Python Flask backend (loads the model, handles inference) + PHP/HTML frontend (runs inside YOUR_SITE).



## Architecture



```

┌─────────────────────┐      HTTP API       ┌─────────────────────┐

│  PHP Frontend        │ ◄───────────────►   │  Python Backend      │

│  YOUR_SITE/ai_chat.php │     127.0.0.1:8667  │  ai_chat_server.py    │

│  (Browser UI)         │                     │  (Flask, loads model) │

└─────────────────────┘                     └─────────────────────┘

```



## Backend: Flask Server (`ai_chat_server.py`)



Located at `D:/dasha/WORKSPACE/ai_training/ai_chat_server.py`



### Key Design Decisions



- **Model class redefined in the server** — not imported from `train_model.py`. This avoids importing training-only dependencies and prevents accidental GPU memory leaks. The class must match the training architecture exactly (vocab_size, embed_dim, num_layers, num_heads, ffn_dim).

- **Thread safety** — uses a `threading.Lock()` around model and conversation state. Flask `threaded=True` serves concurrent HTTP requests but model generation is serialized.

- **Session-based conversation history** — stored in-memory dict, keyed by session_id string. No persistence across server restarts.

- **CORS** — wide open since the PHP frontend runs on a different port (80 vs 8667).



### API Endpoints



| Endpoint | Method | Description |

|----------|--------|-------------|

| `/api/status` | GET | Model info, params, GPU status, connection health |

| `/api/chat` | POST | Generate response. Body: `{session_id, message, params?}`. Returns `{response, session_id}` |

| `/api/reset` | POST | Clear conversation history. Body: `{session_id}` |

| `/api/history` | GET | Get conversation messages. Query: `?session_id=...` |

| `/api/settings` | GET/POST | Get or update generation parameters |

| `/api/checkpoints` | GET | List all available model checkpoints with size/mtime |

| `/api/switch_model` | POST | Reload a different checkpoint. Body: `{path}` |

| `/api/gpu_info` | GET | GPU memory usage details |



### Chat Parameters



```python

params = {

    "temperature": 0.8,      # 0.1-2.0

    "top_k": 40,              # 1-100 (0 = disable)

    "top_p": 0.9,             # 0.0-1.0 (1.0 = disable)

    "max_length": 200,        # 10-500 tokens

    "system_prompt": "..."    # system-level instruction

}

```



### Loading Models from Checkpoints



- `best_model.pt` (~128MB for 33M params) — state_dict only, fast load, preferred for inference

- `checkpoint_epochN.pt` (~383MB) — full optimizer state, slower load, more VRAM

- **Training and inference cannot run simultaneously** on the same GPU.



### Start / Stop



```

D:\dasha\WORKSPACE\start_ai_chat_server.bat

D:\dasha\WORKSPACE\stop_ai_chat_server.bat

```



## Frontend: Chat UI (`ai_chat.php`)



Located at `/path/to/your-site\ai_chat.php`



### Features



| Module | Details |

|--------|---------|

| **Chat messages** | User (green) / AI (gray) bubbles, Enter=send, Shift+Enter=newline, typing indicator animation |

| **Left sidebar** | Session management (create/rename/delete/switch), localStorage persistence |

| **Right panel** | Parameter sliders (temperature, top-k, top-p, max_len), system prompt, GPU info |

| **Model switching** | Modal listing all checkpoints with size/date, click to reload |

| **Export** | Download current conversation as `.txt` |

| **Status indicator** | Server connection status + model name |



### Session Storage



Stored in `localStorage` under key `ai_chat_sessions`. Format:

```json

{

  "session_id": {

    "name": "对话标题",

    "messages": [{"role": "user", "content": "...", "time": "HH:MM:SS"}, ...]

  }

}

```



## Prompt Construction



```

系统：{system_prompt}

用户：{user_message_1}

助手：{assistant_response_1}

用户：{user_message_2}

助手：

```



## Pitfalls



- **Port conflict**: Check port 8667 is free before starting. dasha-web-ui uses 8648, ps-gui uses 8666.

- **Model loading memory**: Loading 383MB checkpoint temporarily uses ~2GB total VRAM. Use best_model.pt (128MB) for inference.

- **First request latency**: First chat request may be slow (~1-2s) due to CUDA kernel compilation.

- **No streaming in current PHP frontend**: Uses plain POST, not SSE. The Flask server has EventSource support but the frontend doesn't consume it yet.

- **Conversation loss on restart**: Backend in-memory history lost on restart. Frontend localStorage keeps messages but backend context is lost until re-sent.

