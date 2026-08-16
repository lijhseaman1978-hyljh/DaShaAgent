"""train_model.py — GPT-style Transformer pretraining from scratch.

Usage:
    /c/Program\ Files/Python310/python.exe train_model.py [--resume checkpoint.pt]

Input: data/processed/dataset/ (HuggingFace Dataset from prepare_data.py)
Output: models/transformer_model_epXX.pt (checkpoints)
Logs: logs/ (TensorBoard)

Architecture: ~8.5M params, optimized for 8GB GPU (RTX 5060)
  - vocab_size=12000, embed_dim=256, num_layers=6, num_heads=8
  - ffn_dim=512, max_seq_len=256, dropout=0.1
"""

import os
import sys
import math
import argparse
import time
import glob
import re
import torch
import torch.nn as nn
import torch.nn.functional as F
from torch.utils.data import DataLoader
from torch.utils.tensorboard import SummaryWriter
from datasets import load_from_disk
from transformers import PreTrainedTokenizerFast
import pickle

# ─── Configuration ──────────────────────────────────────────────
VOCAB_SIZE = 12000
EMBED_DIM = 256
NUM_LAYERS = 6
NUM_HEADS = 8
FFN_DIM = 512
MAX_SEQ_LEN = 256
DROPOUT = 0.1
BATCH_SIZE = 8
GRAD_ACCUM_STEPS = 4
LEARNING_RATE = 3e-4
WARMUP_STEPS = 1000
WEIGHT_DECAY = 0.01
NUM_EPOCHS = 20
SAVE_EVERY = 500  # save checkpoint every N steps
LOG_EVERY = 50    # log loss every N steps
DEVICE = 'cuda' if torch.cuda.is_available() else 'cpu'


# ─── Model Architecture ─────────────────────────────────────────

class TransformerConfig:
    vocab_size = VOCAB_SIZE
    embed_dim = EMBED_DIM
    num_layers = NUM_LAYERS
    num_heads = NUM_HEADS
    ffn_dim = FFN_DIM
    max_seq_len = MAX_SEQ_LEN
    dropout = DROPOUT


class PositionalEncoding(nn.Module):
    def __init__(self, d_model, max_len=MAX_SEQ_LEN, dropout=DROPOUT):
        super().__init__()
        self.dropout = nn.Dropout(dropout)
        pe = torch.zeros(max_len, d_model)
        position = torch.arange(0, max_len, dtype=torch.float).unsqueeze(1)
        div_term = torch.exp(torch.arange(0, d_model, 2).float() *
                             (-math.log(10000.0) / d_model))
        pe[:, 0::2] = torch.sin(position * div_term)
        pe[:, 1::2] = torch.cos(position * div_term)
        pe = pe.unsqueeze(0)  # (1, max_len, d_model)
        self.register_buffer('pe', pe)

    def forward(self, x):
        x = x + self.pe[:, :x.size(1), :]
        return self.dropout(x)


class TransformerDecoderLayer(nn.Module):
    def __init__(self, config):
        super().__init__()
        self.self_attn = nn.MultiheadAttention(
            config.embed_dim, config.num_heads,
            dropout=config.dropout, batch_first=True
        )
        self.norm1 = nn.LayerNorm(config.embed_dim)
        self.norm2 = nn.LayerNorm(config.embed_dim)
        self.ffn = nn.Sequential(
            nn.Linear(config.embed_dim, config.ffn_dim),
            nn.GELU(),
            nn.Dropout(config.dropout),
            nn.Linear(config.ffn_dim, config.embed_dim),
            nn.Dropout(config.dropout),
        )

    def forward(self, x, causal_mask):
        attn_out, _ = self.self_attn(x, x, x, attn_mask=causal_mask)
        x = self.norm1(x + attn_out)
        ffn_out = self.ffn(x)
        x = self.norm2(x + ffn_out)
        return x


class TransformerLM(nn.Module):
    def __init__(self, config):
        super().__init__()
        self.config = config
        self.embedding = nn.Embedding(config.vocab_size, config.embed_dim)
        self.pos_encoding = PositionalEncoding(config.embed_dim, config.max_seq_len)
        self.layers = nn.ModuleList([
            TransformerDecoderLayer(config) for _ in range(config.num_layers)
        ])
        self.ln_final = nn.LayerNorm(config.embed_dim)
        self.lm_head = nn.Linear(config.embed_dim, config.vocab_size, bias=False)
        # Tie weights
        self.embedding.weight = self.lm_head.weight

        self._init_weights()

    def _init_weights(self):
        for p in self.parameters():
            if p.dim() > 1:
                nn.init.xavier_uniform_(p)

    def forward(self, input_ids):
        causal_mask = torch.triu(
            torch.full((input_ids.size(1), input_ids.size(1)),
                       float('-inf'), device=input_ids.device),
            diagonal=1
        )
        x = self.embedding(input_ids) * math.sqrt(self.config.embed_dim)
        x = self.pos_encoding(x)
        for layer in self.layers:
            x = layer(x, causal_mask)
        x = self.ln_final(x)
        logits = self.lm_head(x)
        return logits

    def generate(self, tokenizer, prompt, max_new_tokens=50,
                 temperature=0.8, top_k=40, top_p=0.9):
        """Generate text from a prompt string."""
        self.eval()
        input_ids = tokenizer.encode(prompt, add_special_tokens=True,
                                     return_tensors='pt').to(DEVICE)

        with torch.no_grad():
            for _ in range(max_new_tokens):
                if input_ids.size(1) > self.config.max_seq_len:
                    input_ids = input_ids[:, -self.config.max_seq_len:]
                logits = self.forward(input_ids)
                next_logits = logits[:, -1, :] / temperature

                # Top-k filtering
                if top_k > 0:
                    top_k_vals, _ = torch.topk(next_logits, top_k, dim=-1)
                    next_logits[next_logits < top_k_vals[:, -1:]] = float('-inf')

                # Top-p (nucleus) filtering
                if top_p < 1.0:
                    sorted_logits, sorted_indices = torch.sort(
                        next_logits, descending=True, dim=-1)
                    cumulative_probs = torch.cumsum(
                        F.softmax(sorted_logits, dim=-1), dim=-1)
                    sorted_indices_to_remove = cumulative_probs > top_p
                    sorted_indices_to_remove[:, 1:] = sorted_indices_to_remove[:, :-1].clone()
                    sorted_indices_to_remove[:, 0] = False
                    indices_to_remove = sorted_indices_to_remove.scatter(
                        1, sorted_indices, sorted_indices_to_remove)
                    next_logits[indices_to_remove] = float('-inf')

                probs = F.softmax(next_logits, dim=-1)
                next_token = torch.multinomial(probs, num_samples=1)
                input_ids = torch.cat([input_ids, next_token], dim=-1)

                if next_token.item() == tokenizer.eos_token_id:
                    break

        return tokenizer.decode(input_ids[0], skip_special_tokens=False)


# ─── Training Loop ──────────────────────────────────────────────

def collate_fn(batch):
    """Pad token sequences to max length in batch."""
    tokens = [torch.tensor(item['input_ids'], dtype=torch.long) for item in batch]
    padded = torch.nn.utils.rnn.pad_sequence(tokens, batch_first=True,
                                              padding_value=0)
    # Truncate to MAX_SEQ_LEN
    if padded.size(1) > MAX_SEQ_LEN:
        padded = padded[:, :MAX_SEQ_LEN]
    return padded


def train():
    os.makedirs('models', exist_ok=True)
    os.makedirs('logs', exist_ok=True)

    # Load tokenizer (for generation samples)
    tok_dir = 'tokenizer/trained_tokenizer'
    tokenizer = PreTrainedTokenizerFast(
        tokenizer_file=os.path.join(tok_dir, 'vocab.json'),
        unk_token='<unk>', pad_token='<pad>',
        bos_token='<s>', eos_token='</s>', mask_token='<mask>',
    )

    # Load dataset
    if os.path.exists('data/processed/dataset'):
        dataset = load_from_disk('data/processed/dataset')
        print(f"Dataset loaded: {len(dataset)} samples")
    else:
        # Fallback: load pickle
        with open('data/processed/token_ids.pkl', 'rb') as f:
            token_ids = pickle.load(f)
        from datasets import Dataset
        dataset = Dataset.from_dict({'input_ids': token_ids})
        print(f"Dataset loaded from pickle: {len(dataset)} samples")

    dataloader = DataLoader(
        dataset, batch_size=BATCH_SIZE, shuffle=True,
        collate_fn=collate_fn, num_workers=0,
        pin_memory=(DEVICE == 'cuda')
    )

    # Model
    config = TransformerConfig()
    model = TransformerLM(config).to(DEVICE)
    total_params = sum(p.numel() for p in model.parameters())
    print(f"Model parameters: {total_params:,}")

    # Optimizer
    optimizer = torch.optim.AdamW(
        model.parameters(), lr=LEARNING_RATE, weight_decay=WEIGHT_DECAY
    )
    criterion = nn.CrossEntropyLoss(ignore_index=0)  # ignore <pad>

    writer = SummaryWriter('logs')
    global_step = 0
    start_epoch = 0

    # ─── Auto-Resume from Latest Checkpoint ────────────────────────
    checkpoints = glob.glob('models/checkpoint_epoch*.pt')
    if checkpoints:
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
        # Clean up: remove stale checkpoints that are less complete
        epoch_in_ckpt = checkpoint['epoch']
        for ck in checkpoints:
            ck_ep = extract_epoch(ck)
            if ck_ep < epoch_in_ckpt:
                os.remove(ck)
                print(f"  Removed stale checkpoint: {ck}")
    else:
        print("No checkpoints found. Starting fresh training.")

    # Resume from explicit --resume flag (overrides auto-resume)
    if '--resume' in sys.argv:
        idx = sys.argv.index('--resume')
        ckpt_path = sys.argv[idx + 1]
        checkpoint = torch.load(ckpt_path, map_location=DEVICE)
        model.load_state_dict(checkpoint['model_state_dict'])
        optimizer.load_state_dict(checkpoint['optimizer_state_dict'])
        start_epoch = checkpoint['epoch'] + 1
        global_step = checkpoint.get('global_step', 0)
        print(f"Resumed from {ckpt_path} (epoch {start_epoch})")

    print(f"\nTraining on {DEVICE}")
    print(f"  Batch size: {BATCH_SIZE} | Grad accum: {GRAD_ACCUM_STEPS}")
    print(f"  Effective batch: {BATCH_SIZE * GRAD_ACCUM_STEPS}")
    print(f"  Max seq len: {MAX_SEQ_LEN} | Params: {total_params:,}")

    model.train()
    t_start = time.time()

    for epoch in range(start_epoch, NUM_EPOCHS):
        total_loss = 0.0
        optimizer.zero_grad()

        for step, batch in enumerate(dataloader):
            batch = batch.to(DEVICE)
            logits = model(batch)

            shift_logits = logits[:, :-1, :].contiguous()
            shift_labels = batch[:, 1:].contiguous()
            loss = criterion(
                shift_logits.view(-1, VOCAB_SIZE),
                shift_labels.view(-1)
            )
            loss = loss / GRAD_ACCUM_STEPS
            loss.backward()

            total_loss += loss.item() * GRAD_ACCUM_STEPS

            if (step + 1) % GRAD_ACCUM_STEPS == 0:
                # Gradient clipping
                torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)

                # Learning rate warmup + cosine decay
                if global_step < WARMUP_STEPS:
                    lr = LEARNING_RATE * (global_step + 1) / WARMUP_STEPS
                else:
                    progress = (global_step - WARMUP_STEPS) / max(1,
                        (NUM_EPOCHS * len(dataloader) // GRAD_ACCUM_STEPS - WARMUP_STEPS))
                    lr = LEARNING_RATE * 0.5 * (1 + math.cos(math.pi * progress))
                for param_group in optimizer.param_groups:
                    param_group['lr'] = lr

                optimizer.step()
                optimizer.zero_grad()
                global_step += 1

                # Logging
                if global_step % LOG_EVERY == 0:
                    avg_loss = total_loss / LOG_EVERY
                    elapsed = time.time() - t_start
                    tokens_per_sec = (BATCH_SIZE * MAX_SEQ_LEN * LOG_EVERY * GRAD_ACCUM_STEPS) / elapsed
                    print(
                        f"Epoch {epoch:2d}/{NUM_EPOCHS} | "
                        f"Step {global_step:6d} | "
                        f"Loss {avg_loss:.4f} | "
                        f"LR {lr:.2e} | "
                        f"Tokens/s {tokens_per_sec:.0f}"
                    )
                    writer.add_scalar('Loss/train', avg_loss, global_step)
                    writer.add_scalar('LR', lr, global_step)
                    total_loss = 0.0
                    t_start = time.time()

                # Save checkpoint
                if global_step % SAVE_EVERY == 0:
                    ckpt_path = f'models/checkpoint_epoch{epoch}.pt'
                    ckpt_size = os.path.getsize(ckpt_path) / 1024 / 1024 if os.path.exists(ckpt_path) else 0
                    torch.save({
                        'epoch': epoch,
                        'global_step': global_step,
                        'model_state_dict': model.state_dict(),
                        'optimizer_state_dict': optimizer.state_dict(),
                        'loss': avg_loss,
                        'config': {
                            'vocab_size': VOCAB_SIZE,
                            'embed_dim': EMBED_DIM,
                            'num_layers': NUM_LAYERS,
                            'num_heads': NUM_HEADS,
                            'ffn_dim': FFN_DIM,
                            'max_seq_len': MAX_SEQ_LEN,
                        }
                    }, ckpt_path)
                    new_size = os.path.getsize(ckpt_path) / 1024 / 1024
                    print(f"  → Checkpoint replaced: {ckpt_path} ({new_size:.1f} MB)")
                    # Warn if disk space getting tight
                    if new_size > 300:
                        total_checkpoints = len(glob.glob('models/checkpoint_epoch*.pt'))
                        print(f"  ⚠️  Total checkpoints: {total_checkpoints} (~{total_checkpoints*new_size:.0f} MB)")

                    # Generation sample
                    sample_prompts = ["船", "海", "今天天气", "船舶"]
                    model.eval()
                    for p in sample_prompts:
                        gen = model.generate(tokenizer, p, max_new_tokens=30)
                        print(f"  GEN[{p}]: {gen}")
                    model.train()

        # End of epoch
        epoch_loss = total_loss / max(len(dataloader), 1)
        print(f"\n{'='*50}")
        print(f"Epoch {epoch} complete. Avg loss: {epoch_loss:.4f}")
        print(f"{'='*50}\n")

    writer.close()
    print("Training complete!")

    # Save final model
    final_path = 'models/transformer_model_final.pt'
    torch.save(model.state_dict(), final_path)
    print(f"Final model saved to {final_path}")


if __name__ == '__main__':
    train()
