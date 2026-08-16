---

name: scratch-training

description: Train a custom GPT-style Transformer language model from scratch (not fine-tuning). Covers BPE tokenizer training, sliding-window data preparation, pretraining loop with CUDA, SFT fine-tuning, and interactive inference. Optimized for 8GB consumer GPU (RTX 5060/4060/3060).

category: mlops

tags: [training, pretraining, transformer, from-scratch, sft, fine-tuning, gpt, cuda, 8gb-gpu]

---



# From-Scratch Transformer Training Pipeline



Train a custom, fully-owned GPT-style language model from raw text articles (pretraining) + dialogue data (SFT fine-tuning). No content restrictions — you own the model, you control what it learns.



## 🎯 Architecture (8GB GPU Optimized)



### Light Configuration (~8.5M params, faster training)



| Parameter | Value | Rationale |

|-----------|-------|-----------|

| vocab_size | 12,000 | Small vocabulary for Chinese-focused training; reduces embedding layer size |

| embed_dim | 256 | Fits 8GB VRAM with batch_size=8 |

| num_layers | 6 | Deep enough for basic language understanding |

| num_heads | 8 | embed_dim / num_heads = 32 (standard transformer ratio) |

| ffn_dim | 512 | 2× embed_dim; lighter than standard 4× for 8GB budget |

| max_seq_len | 256 | Balanced context window for 8GB VRAM |

| Total params | ~8.5M | Full training in 3-7 days on RTX 5060 |



### Full Configuration (~33.4M params, more capable)



| Parameter | Value | Rationale |

|-----------|-------|-----------|

| vocab_size | 12,000 | Same tokenizer, different embedding size |

| embed_dim | 512 | Double the capacity — each token gets richer representation |

| num_layers | 8 | Deeper hierarchy for more complex reasoning |

| num_heads | 8 | embed_dim / num_heads = 64 (still within standard ratio) |

| ffn_dim | 1,536 | 3× embed_dim (less aggressive than standard 4× to save VRAM) |

| max_seq_len | 256 | Same context window |

| batch_size | 4 | Reduced from 8 to fit larger parameters |

| Total params | **33,440,768** | ~4× the light config; more coherent generation |



**Verified on RTX 5060 8GB**: ~893MB VRAM usage (model + optimizer + activations), leaving ~7GB headroom. batch_size=4 works stably at seq_len=256. Training time estimate: 1-2 weeks for 30 epochs with ~18M tokens of data.



### How to scale from 8.5M → 33M



In any of the template scripts (train_model.py, chat_with_model.py), change these constants:



```python

EMBED_DIM = 512       # was 256

NUM_LAYERS = 8        # was 6

FFN_DIM = 1536        # was 512

BATCH_SIZE = 4        # was 8 (VRAM trade-off)

```



The templates' model architecture (`TransformerLM`, `TransformerDecoderLayer`) auto-adapts to these values — no structural code changes needed. Just change the constants at the top of the file.



⚠️ **Data-to-parameter ratio consideration:** With 33M parameters, ~18M tokens of training data is on the low side. A good rule of thumb is 50-100 tokens per parameter (1.6B-3.3B tokens for 33M params). With limited data, expect slower convergence and more epochs needed. Consider using a 12K-15K vocab if you add more data to keep embedding size in check.



### 🚀 Auto-Resume from Checkpoint (Key Workflow)



For long multi-session training runs (>20 hours), the template now supports **automatic checkpoint scanning**. Instead of manually passing `--resume <path>`, the script detects the latest checkpoint:



```python

# Auto-resume logic (included in the template):

import glob

checkpoints = glob.glob('models/checkpoint_epoch*.pt')

if checkpoints:

    # Extract epoch numbers from filenames

    def extract_epoch(path):

        match = re.search(r'checkpoint_epoch(\d+)', path)

        return int(match.group(1)) if match else 0

    latest = max(checkpoints, key=extract_epoch)

    checkpoint = torch.load(latest, map_location=DEVICE)

    model.load_state_dict(checkpoint['model_state_dict'])

    optimizer.load_state_dict(checkpoint['optimizer_state_dict'])

    start_epoch = checkpoint['epoch'] + 1

    global_step = checkpoint.get('global_step', 0)

    print(f"Auto-resumed from {latest} (epoch {start_epoch})")

```



**Workflow for interrupted runs:**

1. Training dies (terminal closed, WSL restarted, etc.)

2. Run `python train_model.py` again with no arguments

3. Script auto-finds the latest checkpoint, resumes from where it left off

4. Continuous training with no human intervention



**To force fresh start** (erase checkpoints): `rm models/checkpoint_epoch*.pt`



### ⚠️ Checkpoint Disk Space Warning



Each checkpoint is **~401MB** for 33M params (full optimizer state included). With `SAVE_EVERY=500` and 30 epochs on 18M tokens:

- ~15 checkpoints → **~6GB**

- Add `best_model.pt` (134MB) and final model → potentially **7GB+**



**Best practices:**

- Set `SAVE_EVERY=2000` or higher to reduce checkpoint count

- Periodically delete old checkpoints: `rm -f models/checkpoint_epoch{0..5}_step*.pt` (keep latest 5)

- The final model `transformer_model_final.pt` is only ~134MB (state_dict only, no optimizer)

- For 33M config: expect ~401MB per full checkpoint, ~134MB for state_dict-only saves



### 📈 Real-World Loss Trajectory (Verified 2026-05-27 on RTX 5060, 33M params)



Trained on ~18M tokens (5,000 Chinese Wikipedia articles), 30 epochs:



| Epoch | Loss  | Generation Quality | Tokens/s |

|-------|-------|-------------------|----------|

| 0     | 5.07  | Random gibberish  | ~8,100   |

| 1     | ~3.85 | Word-like fragments | ~8,100   |

| 2     | ~3.50 | Some recognizable chars | ~8,100 |

| 3-4   | ~3.20 | Chinese words appear, sentences nonsensical | ~8,100 |

| 5-6   | **2.91** | Repetitive but recognizable Chinese (e.g. "船船船海海上") | ~8,100 |

| 7-8   | 2.82  | Improved coherence, still repetitive | ~8,100  |

| 20-30 | ~2.5* | Expect: more coherent but limited by data quantity | ~8,100  |



*Beyond epoch 8 is projected — actual run in progress.



**Key insight:** With only 18M tokens for 33M params (~0.5 tokens/param ratio, far below the recommended 50-100), the model learns basic grammar and vocabulary by epoch 5-6 but exhibits severe repetition (lack of diversity). More data is the only real fix — or reduce to 8.5M config for this data volume.



### Why not fine-tune an existing model?

Fine-tuning pre-trained models (LLaMA, Qwen, DeepSeek) requires:

- Full fine-tuning: 7B+ params → needs 24GB+ VRAM

- LoRA/QLoRA: reduces memory but still works within the pre-trained model's constraints and bias

- **From scratch**: no baked-in censorship, no data lineage concerns, full ownership



## 🏗 Project Structure



```

D:/dasha/WORKSPACE/ai_training/

├── data/

│   ├── raw/              ← Place your .txt article files here (UTF-8)

│   └── processed/        ← Tokenized & chunked data (generated)

├── tokenizer/            ← Trained BPE tokenizer files

│   └── trained_tokenizer/

├── models/               ← Checkpoints & final model

│   └── transformer_model_epXX.pt

├── logs/                 ← TensorBoard logs

├── train_tokenizer.py    ← Step 1: Train BPE tokenizer

├── prepare_data.py       ← Step 2: Chunk + tokenize training data

├── train_model.py        ← Step 3: Pretraining loop

├── train_sft.py          ← Step 4: SFT fine-tuning (post-pretraining)

└── chat_with_model.py    ← Step 5: Interactive inference

```



## 🔧 Step-by-Step Pipeline



### Step 1: Install Dependencies



```bash

# Windows (Python 3.10)

/c/Program\ Files/Python310/python.exe -m pip install torch==2.8.0+cu128 torchvision==0.23.0+cu128 torchaudio==2.8.0+cu128 --index-url https://download.pytorch.org/whl/cu128

/c/Program\ Files/Python310/python.exe -m pip install transformers tokenizers datasets accelerate tensorboard

```



**PyTorch version for RTX 5060 (Blackwell sm_120):** Must be PyTorch ≥ 2.5.0 for full CUDA support. PyTorch 2.8.0+cu128 confirmed working. Earlier versions (2.1.x, 2.2.x) will emit "sm_120 not compatible" warning and may silently fall back to CPU.



### Step 2: Train Tokenizer (`train_tokenizer.py`)



```python

from tokenizers import ByteLevelBPETokenizer

from glob import glob



# Collect all .txt files

files = glob('data/raw/*.txt')



# Train BPE tokenizer

tokenizer = ByteLevelBPETokenizer()

tokenizer.train(files, vocab_size=12000, min_frequency=2,

                special_tokens=['<pad>', '<s>', '</s>', '<unk>', '<mask>'])

tokenizer.save('tokenizer/trained_tokenizer/')

print(f"Vocab size: {tokenizer.get_vocab_size()}")

```



### Step 3: Prepare Data (`prepare_data.py`)



Loads all .txt files in `data/raw/`, applies sliding window (max_len=256, stride=128), tokenizes and saves as HuggingFace Dataset.



### Step 4: Train Model (`train_model.py`)



Key architecture (GPT-style decoder-only transformer):



```python

class TransformerConfig:

    vocab_size = 12000

    embed_dim = 256

    num_layers = 6

    num_heads = 8

    ffn_dim = 512

    max_seq_len = 256

    dropout = 0.1

```



Training hyperparameters for 8GB GPU:

- `batch_size=8` (fits 8GB VRAM at seq_len=256)

- `gradient_accumulation_steps=4` (effective batch = 32)

- `learning_rate=3e-4` with cosine schedule

- `warmup_steps=1000`

- `weight_decay=0.01`

- `save_every=500` steps (checkpoint)



### Step 5: Inference



Two options:



#### Option A: CLI Chat (`chat_with_model.py`)



Interactive terminal chat with temperature/top-k/top-p sampling:



```bash

/c/Program\ Files/Python310/python.exe /d/dasha/WORKSPACE/ai_training/chat_with_model.py

```



#### Option B: Web Chat UI (Flask + PHP)

A feature-rich web interface with session management, parameter controls, and model checkpoint switching:

1. **Install dependencies**: `pip install flask` (separate from torch — not included in training deps)
2. After training, start the inference server: `D:\\dasha\\WORKSPACE\\start_ai_chat_server.bat`
3. Open `http://localhost/your-site/ai_chat.php` in browser
4. Or click "AI聊天" in the website navbar (add `ai_chat.php` to config.php's `$allowed_pages`)

**Key ports:** Chat server=8667, dasha-web-ui=8648, ps-gui=8666.

**Start/Stop scripts:**
- `D:\\dasha\\WORKSPACE\\start_ai_chat_server.bat` — starts Flask server
- `D:\\dasha\\WORKSPACE\\stop_ai_chat_server.bat` — kills process on port 8667

**Frontend setup:** The PHP chat UI (`ai_chat.php`) runs inside YOUR_SITE at `C:\\<WAMP_ROOT>\\www\\YOUR_SITE\\`. It uses AJAX to call the Flask API on port 8667. To add a navbar link, edit the site's navigation template. To enable auth, add `ai_chat.php` to the `$allowed_pages` whitelist in config.php.

**Important:** Training must be stopped before starting inference — both use the same GPU and cannot run simultaneously.

See `references/web-chat-server.md` for full setup and API documentation. For detailed API response schemas (all endpoints with JSON examples), see `references/model-inference-api.md`.


## ⚡ Performance on RTX 5060 8GB



### Real-World Measurements (Verified 2026-05-27)



| Configuration | Measured | Notes |

|--------------|----------|-------|

| **33.4M params** (embed_dim=512, 8 layers, ffn=1536) | ~893MB VRAM | batch_size=4, seq_len=256 |

| **8.5M params** (embed_dim=256, 6 layers, ffn=512) | ~350MB VRAM | batch_size=8, seq_len=256 |

| **Per epoch (33M, batch=4)** | ~40-50 min | ~40k steps/epoch, 40620 total samples |

| **30 epochs (33M, batch=4)** | ~20-25 hours | Continuous run |

| **Throughput** | ~8,000 tokens/sec | 33M params, batch=4 |

| **Data prep (5K articles)** | ~5 min | 18M tokens → 162k samples |

| **Tokenizer training (18M tokens)** | ~2 min | BPE vocab=12000 |



### Scaling Estimates



| Data Size | 8.5M params (20 ep) | 33M params (30 ep) |

|-----------|-------------------|-------------------|

| ~18M tokens (5K articles) | ~6-8 hours | ~20-25 hours |

| ~50M tokens (15K articles) | ~18-24 hours | ~60-75 hours |

| ~100M tokens (30K articles) | ~36-48 hours | ~5-6 days |



> The earlier estimate of "3-7 days" for 8.5M params was pessimistic. With batch_size=8, seq_len=256, 20 epochs on 18M tokens completes in under 8 hours. The bottleneck is GPU compute, not memory — the model is small enough that most of the GPU is idle.



### Memory Budget Breakdown (8GB VRAM, 33M params)



- Model parameters (~33M × 4 bytes = 132MB FP32)

- Optimizer states (Adam: 2× param size = 264MB FP32)

- Gradients (= 132MB FP32)

- Activations per batch: ~300MB (seq_len=256, batch=4)

- CUDA context + PyTorch overhead: ~100MB

- **Total: ~900MB**

- Headroom: 7GB for other processes, cache



## 🔄 Background Training Workflow



Training can take 20+ hours — never run it in the foreground terminal. Use background process management. Two approaches: **git-bash nohup** (runs inside WSL/git-bash) or **PowerShell Start-Process** (native Windows, survives dasha session restarts).



### Windows-Native: PowerShell Start-Process (Preferred)



Use when you want training to **survive dasha session restarts** and terminal closures. The training becomes a truly independent Windows process.



```powershell

# start_training_detached.ps1

$python = "C:\Program Files\Python310\python.exe"

$script = "D:\dasha\WORKSPACE\ai_training\train_model.py"

$logDir = "D:\dasha\WORKSPACE\ai_training"



# Auto-detect resume epoch from latest checkpoint

$maxEpoch = 0

Get-ChildItem "$logDir\models\checkpoint_epoch*.pt" | ForEach-Object {

    if ($_.Name -match 'checkpoint_epoch(\d+)') { $e = [int]$matches[1]; if ($e -gt $maxEpoch) { $maxEpoch = $e } }

}



$psi = New-Object System.Diagnostics.ProcessStartInfo

$psi.FileName = $python

$psi.Arguments = "`"$script`""

$psi.WorkingDirectory = $logDir

$psi.UseShellExecute = $false

$psi.RedirectStandardOutput = $true

$psi.RedirectStandardError = $true

$psi.CreateNoWindow = $true

$p = [System.Diagnostics.Process]::Start($psi)

$p.Id | Out-File (Join-Path $logDir "train.pid")

```



Launch from git-bash:

```bash

powershell.exe -ExecutionPolicy Bypass -File "D:\dasha\WORKSPACE\start_training_detached.ps1"

```



### PowerShell GUI: Visual Training Manager



For interactive monitoring with real-time progress bars and loss display:



```bash

powershell.exe -ExecutionPolicy Bypass -File "D:\dasha\WORKSPACE\train_manager.ps1"

```



See `references/powershell-training-manager.md` for full documentation of both GUI and headless approaches.



### Git-Bash: nohup (Alternative, Process Dies on Session End)



For short runs or when the terminal session stays alive:



### Monitor Training Progress



```bash

# Check if process is running (use PID from either approach)

kill -0 $(cat /d/dasha/WORKSPACE/ai_training/train.pid) && echo "Running" || echo "Stopped"



# View recent log output

tail -30 /d/dasha/WORKSPACE/ai_training/training.log



# Check GPU usage (from git-bash or PowerShell)

nvidia-smi

# Or: powershell.exe -Command "nvidia-smi"



# From PowerShell, list Python processes + GPU

powershell.exe -Command "& { nvidia-smi } ; Write-Host '---' ; Get-Process python -ErrorAction SilentlyContinue | Format-Table Id, CPU, PM"



### Cancel Training



```bash

# From git-bash

kill $(cat /d/dasha/WORKSPACE/ai_training/train.pid)



# From PowerShell (if kill doesn't work from git-bash)

powershell.exe -Command "Stop-Process -Id $(Get-Content D:\dasha\WORKSPACE\ai_training\train.pid) -Force"



# Verify no orphan processes

nvidia-smi  # GPU memory should be freed

```



### Training Log Example (from actual run)



```

Epoch  0/30 | Step   650/40620 | Loss 5.0700 | LR 3.00e-04 | Tokens/s 8123

Epoch  0/30 | Step  1300/40620 | Loss 4.9800 | LR 3.00e-04 | Tokens/s 8056

Epoch  0/30 | Step  1950/40620 | Loss 4.9100 | LR 3.00e-04 | Tokens/s 8100

...

Epoch  1/30 | Step   650/40620 | Loss 3.8500 | LR 3.00e-04 | Tokens/s 8150

```



- Loss typically drops from ~5.0 to ~3.0 over 30 epochs with 18M tokens

- Each ~650 steps = ~5 minutes at batch_size=4

- A "step" in the log is after gradient accumulation (effective step)



## 🚫 Common Pitfalls



| Pitfall | Symptom | Fix |

|---------|---------|-----|

| RTX 5060 sm_120 unsupported | `sm_120 not compatible` warning | Upgrade to PyTorch ≥ 2.5.0 |

| CUDA out of memory | `CUDA out of memory. Tried to allocate...` | Reduce batch_size to 4 or max_seq_len to 128 |

| BPE vocab too large | OOM on embedding layer | Reduce vocab_size (start with 8K-12K) |

| Data not in UTF-8 | `UnicodeDecodeError` | Check file encoding; use `encoding='utf-8-sig'` for BOM |

| Checkpoint file too large | Disk space warnings | Add `torch.save(..., _use_new_zipfile_serialization=False)` |

| Loss not decreasing | Stuck training | Lower learning rate; check tokenizer coverage |

| Data too small for model size | Loss plateaus, generation incoherent | Use a smaller architecture (8.5M light config) OR collect more data (aim for 1.6B+ tokens for 33M params) |

| Python 3.10 vs 3.11 module issues | `ModuleNotFoundError` | Must use matching Python version (3.10 if installed via pip) |

| Windows long path >260 chars | `FileNotFoundError` | Use shorter directory names or enable long paths in Windows |

| D: drive path confusion in git-bash | `/mnt/d/` vs `/d/` | Use `/d/dasha/WORKSPACE/...` — `/mnt/d/` goes to `C:\\Program Files\\Git\\mnt\\d\\` |

| **PyTorch 2.5+ API change: `mask` → `src_mask`** | `TypeError: forward() got an unexpected keyword argument 'mask'` | If using PyTorch's built-in `TransformerDecoderLayer`, PyTorch ≥ 2.5 renamed the `mask` kwarg to `src_mask`. The template's custom `TransformerDecoderLayer` does NOT have this issue — it passes `attn_mask` to `nn.MultiheadAttention`. Only affects code that directly instantiates `nn.TransformerDecoderLayer`. |

| **Training process dies silently (WSL)** | `kill -0` shows dead, no log update | Common when terminal session ends. Always launch with `nohup` and redirect stdout/stderr to log file. Use PID tracking file for monitoring. |

| **Auto-resume fails with NameError (missing constant)** | `NameError: name 'MODEL_DIR' is not defined` when re-running train_model.py | All config constants (`MODEL_DIR`, `LOG_STEP`, `SAVE_STEP`, `MAX_SEQ_LEN`, `EMBED_DIM`, `BATCH_SIZE`, etc.) **must be defined at module level** in train_model.py itself. Do NOT import them from another file. The auto-resume logic references these — if they're only in an imported module, re-running the script fails. |

| **Auto-resume fails with missing expected key** | `KeyError: 'global_step'` or `'epoch'` when loading checkpoint | The checkpoint dict may not have all expected keys if saved from an older version of the script. Add `.get()` fallbacks: `checkpoint.get('epoch', -1)`, `checkpoint.get('global_step', 0)` |

|| **Multiple resume variables needed** | `NameError: name 'LOG_STEP' is not defined` despite START_EPOCH being set correctly | When adding resume logic, you must define ALL of: `MODEL_DIR`, `LOG_STEP`, `SAVE_STEP` plus the model architecture constants (`EMBED_DIM`, `NUM_LAYERS`, `NUM_HEADS`, `FFN_DIM`, `MAX_SEQ_LEN`, `BATCH_SIZE`). The auto-resume code references these inside the training loop — missing any = NameError. |
|| **Flask not installed separately** | `ModuleNotFoundError: No module named 'flask'` | Flask is not included with torch. Install explicitly: `pip install flask` |
|| **Inference server port conflict** | `OSError: [Errno 98] Address already in use` or no response on port 8667 | Check port 8667 is free before starting. Kill the old process: `taskkill /F /PID <pid>` |
|| **Stale .pyc bytecode from previous server** | Code changes don't take effect on restart | After patching Flask server files, kill all python.exe, `rm __pycache__/*.pyc`, restart. Use `find /d/PATH -name "*.pyc"` to locate caches. |
|| **Batch file encoding with Chinese chars** | cmd.exe shows garbled text or "XXX is not recognized" | Add `chcp 65001 >nul` as the first line after `@echo off` in .bat files, or use English-only in .bat. |
|| **start /B from git-bash fails silently** | .bat works when double-clicked but not from bash | Use `cmd.exe //c "path\\to\\bat"` from git-bash, or create a VBS launcher with `WshShell.Run`. |
|| **Training PID holds GPU memory** | nvidia-smi shows 0% utilization but memory stays allocated | Kill all python.exe PIDs before starting inference to free GPU memory. |
|| **Chat UI: input box hidden below viewport** | Chat input area is below the visible screen | Add `min-height: 0` to BOTH `.chat-main` and `.messages-container` flex children. Use `100dvh` instead of `100vh`. |
|| **Chat UI: overflow: hidden on html/body** | Mobile browsers scroll unexpectedly | Put `overflow: hidden` on `.app-container` instead of `html, body`. |


## 📋 Data Requirements



### Pretraining (Step 1)



#### Option A: Local .txt files (simplest)

- **Format:** UTF-8 plain text (.txt)

- **Content:** Articles, books, transcripts — any coherent text

- **Quantity:** 10MB+ recommended; more data = better model

- **Place in:** `data/raw/`



#### Option B: HuggingFace dataset download (recommended for volume)

Download directly from HuggingFace using `load_dataset()` — saves manual file collection:



```python

from datasets import load_dataset

import os



os.makedirs('data/raw', exist_ok=True)



# Download Chinese Wikipedia (~18M tokens in 5000 articles)

dataset = load_dataset("wikimedia/wikipedia", "20231101.zh",

                       split="train", streaming=True)



count = 0

for i, article in enumerate(dataset):

    if article['text'] and len(article['text'].strip()) > 200:

        # Sanitize filename (remove problematic characters)

        title = article['title'].replace('/', '_').replace('\\', '_')

        with open(f'data/raw/wiki_{i:05d}_{title[:50]}.txt',

                  'w', encoding='utf-8') as f:

            f.write(article['text'])

        count += 1



print(f"Downloaded {count} articles")

```



- **wikimedia/wikipedia**: ~53MB for 5000 zh articles, ~18.5M tokens

- **c4/zh** (Common Crawl): Larger but noisier

- **mc4** (mC4): Multilingual, Chinese subset available



> ⚠️ `streaming=True` prevents downloading the entire dataset at once — important on systems with limited disk space. Without streaming, the full Chinese Wikipedia dataset is ~2GB+.



#### Option C: Combine multiple sources (best result)

Stack multiple datasets for richer coverage:

1. Wikipedia (encyclopedic knowledge, clean text)

2. News articles (contemporary language, varied topics)

3. Books/long-form content (narrative coherence, complex grammar)

4. Domain-specific text (shipping manuals, regulations, etc.)



#### Option D: Synthetic Data Generation via LLM API (verified 2026-05-31)



When web scraping is blocked (CAPTCHA, network restrictions, site unavailability) and local data is insufficient, use an LLM API to **generate training data from scratch**. This bypasses all download limitations.



**Strategy:** Prompt a capable LLM (DeepSeek, GPT, Claude, etc.) to generate Chinese articles across diverse topics. Each generation produces clean, natural text — no noise, no duplicates, ready to train.



**Core approach** (see `templates/data_generate_synthetic.py`):



```python

def generate_synthetic_data(client, topic_list):

    """Generate articles for N topics in one API call."""

    prompt = f"""请用中文写{len(topic_list)}篇短文，每篇100-500字，

覆盖以下主题：{'、'.join(topic_list)}



格式要求：

## [主题名]

标题：[文章标题]

内容：[正文...]



## [主题名2]

..."""

    response = client.chat.completions.create(

        model="deepseek/deepseek-v4-flash",

        messages=[{"role": "user", "content": prompt}],

        temperature=0.8, max_tokens=4096

    )

    return response.text

```



**Topics that work well** (proven: 187 files, ~8.6MB in one session):

海洋探索, 日常生活, 自然美景, 旅行游记, 中华文化, 科学发现, 历史故事, 美食烹饪, 人生哲理, 科技创新



**Real-world performance (verified 2026-05-31, DeepSeek-V4-Flash):**



| Metric | Value | Notes |

|--------|-------|-------|

| API call time | ~31.8s per batch | 10-12 topics per call, 4096 max_tokens |

| Throughput | ~8.6MB / hour | 187 files, ~46KB per file average |

| Files per batch | ~10-12 | Most topics yield 1 file; some fail parsing |

| Session yield | ~187 files | 16 batches (4 V1 + 4 V2 topic groups) |

| Quality | Fluent Chinese | Natural vocabulary, diverse sentence structures |

| Coverage | 80+ distinct topics | Two topic banks (expository + narrative) prevent monotony |



**Error handling pattern (built into template):**

```python

for attempt in range(MAX_RETRIES):  # Default 3 retries

    try:

        response = client.chat.completions.create(...)

        break

    except Exception as e:

        print(f"  [RETRY {attempt+1}/{MAX_RETRIES}] API failed: {e}")

        if attempt < MAX_RETRIES - 1:

            time.sleep(5 * (attempt + 1))

        else:

            print("  [SKIP] Batch failed after all retries.")

            return 0

```



**Merge synthetic + existing data:**

```bash

# Just copy .txt files into data/raw/ — prepare_data.py reads ALL .txt files

cp data/raw_new/*.txt data/raw/

# Re-run prep to rebuild combined dataset

/.../python.exe prepare_data.py

# The existing script auto-detects all .txt — no config changes needed

```



**Pitfalls:**

- **API costs apply** — DeepSeek-V4-Flash is cheap/free-tier, but commercial APIs bill per token

- **Weak LLM → weak training data** — the synthetic text is only as good as the model generating it

- **Topic prompt fatigue** — vary prompts across sessions, otherwise the generator produces the same "introduction-style" text every time. The template includes two topic banks (V1=expository, V2=narrative) and three prompt templates that alternate (standard, storytelling, explanatory) to fight this

- **Subprocess call pitfall** — calling a subprocess (`subprocess.run(['python', 'data_generate_synthetic.py'])`) can silently fail if the script path or Python path is wrong. Always import and call the function directly, or verify the script path first with `which` / `where`

- **API key not set** — the template auto-detects `DEEPSEEK_API_KEY` and `OPENROUTER_API_KEY` env vars, plus falls back to `~/.dasha/.env`. If none are found, the script exits with a clear error message. Run `cat ~/.dasha/.env \| grep DEEPSEEK` to verify before calling



### SFT Fine-tuning (Step 4, post-pretraining)

- **Format:** JSONL, each line `{"instruction": "...", "response": "..."}` or Alpaca format

- **Content:** Dialogues, QA pairs, instructions

- **Quantity:** 1K+ dialogue pairs minimum

- **Script:** `train_sft.py` (adjusts loss to only apply to response tokens)



## 🔍 Verification Checklist



After each step, confirm:

1. **Tokenizer**: `trained_tokenizer/` directory has `vocab.json` and `merges.txt`

2. **Data**: Processing log shows total tokens and number of chunks

3. **Training starts**: First loss value printed, GPU memory used (~2GB)

4. **Checkpoints**: `.pt` files created in `models/` directory

5. **Inference**: Model generates coherent Chinese text (may be nonsensical at first epochs)

6. **TensorBoard**: Run `tensorboard --logdir logs` to monitor loss curves



## 📁 Skill Assets



### Templates (copy & modify for your project)

- `templates/train_tokenizer.py` — BPE tokenizer training script (~50 lines)

- `templates/prepare_data.py` — Sliding-window data preparation (~70 lines)

- `templates/train_model.py` — Full pretraining loop with ~8.5M param Transformer (~280 lines, including architecture + training + generation)

- `templates/train_sft.py` — SFT fine-tuning on dialogue data (~150 lines, with loss masking)

- `templates/chat_with_model.py` — Interactive/one-shot inference (~200 lines, temperature/top-k/top-p)



### References
- `references/data-requirements.md` — Training data sources, preparation guide, and performance projections
- `references/data-yield-calculations.md` — Real-world measurements: 18M tokens → 162k samples, epoch timing, loss trajectory (verified 2026-05-27)
- `references/powershell-training-manager.md` — PowerShell GUI training manager (WPF/XAML progress bars, loss display, Start/Stop buttons) + headless detached training via Start-Process (survives dasha session restarts)
- `references/web-chat-server.md` — Full Flask server setup, API endpoints, PHP frontend, session management
- `references/model-inference-api.md` — Detailed API response schemas with JSON examples for all endpoints (moved from absorbed skill `local-model-inference`)


## 🔗 Related Skills

- `offline-office` — for preparing training data from PDFs, Word docs, OCR

- `huggingface-hub` — for downloading/datasets and sharing checkpoints

- `weights-and-biases` — for experiment tracking (alternative to local TensorBoard)

