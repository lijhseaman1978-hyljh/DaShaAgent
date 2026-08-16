"""train_sft.py — Supervised Fine-Tuning (SFT) on dialogue data.

After pretraining (train_model.py), run SFT to teach the model
conversation ability. Uses instruction-response pairs.

Usage:
    /c/Program\ Files/Python310/python.exe train_sft.py --checkpoint models/transformer_model_final.pt

Input: data/sft/instructions.jsonl (one JSON per line)
Format:
    {"instruction": "...", "response": "..."}
    or Alpaca format:
    {"instruction": "...", "input": "...", "output": "..."}

Output: models/sft_model_final.pt
"""

import os
import json
import math
import torch
import torch.nn as nn
import torch.nn.functional as F
from torch.utils.data import Dataset, DataLoader
from transformers import PreTrainedTokenizerFast

# Import model architecture
from train_model import TransformerLM, TransformerConfig, VOCAB_SIZE, EMBED_DIM, NUM_LAYERS, NUM_HEADS, FFN_DIM, MAX_SEQ_LEN, DROPOUT

DEVICE = 'cuda' if torch.cuda.is_available() else 'cpu'
BATCH_SIZE = 4       # Smaller batch for SFT (memory for longer sequences)
GRAD_ACCUM = 4       # Effective batch = 16
LR = 1e-4
NUM_EPOCHS = 5
MAX_SEQ_LEN_SFT = 256


class SFTDataset(Dataset):
    """Load instruction-response pairs for fine-tuning."""

    def __init__(self, data_path, tokenizer, max_len=MAX_SEQ_LEN_SFT):
        self.tokenizer = tokenizer
        self.max_len = max_len
        self.pairs = []

        with open(data_path, 'r', encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                obj = json.loads(line)
                instruction = obj.get('instruction', '')
                inp = obj.get('input', '')
                response = obj.get('response', '') or obj.get('output', '')

                if inp:
                    full_text = f"<s>User: {instruction}\n{inp}\nAssistant: {response}</s>"
                else:
                    full_text = f"<s>User: {instruction}\nAssistant: {response}</s>"

                # Find the assistant response start for loss masking
                response_start = full_text.find("Assistant:")
                response_start_tok = len(tokenizer.encode(full_text[:response_start + len("Assistant:")]))

                self.pairs.append({
                    'text': full_text,
                    'response_start': response_start_tok,
                })

    def __len__(self):
        return len(self.pairs)

    def __getitem__(self, idx):
        pair = self.pairs[idx]
        tokens = self.tokenizer.encode(pair['text'], add_special_tokens=False)
        if len(tokens) > self.max_len:
            tokens = tokens[:self.max_len]
        return torch.tensor(tokens, dtype=torch.long)


def collate_sft(batch):
    """Pad and create loss mask (only compute loss on response tokens)."""
    padded = torch.nn.utils.rnn.pad_sequence(
        batch, batch_first=True, padding_value=0)
    if padded.size(1) > MAX_SEQ_LEN_SFT:
        padded = padded[:, :MAX_SEQ_LEN_SFT]
    return padded


def train(checkpoint_path, data_path):
    os.makedirs('models', exist_ok=True)

    # Load tokenizer
    tokenizer = PreTrainedTokenizerFast(
        tokenizer_file='tokenizer/trained_tokenizer/vocab.json',
        unk_token='<unk>', pad_token='<pad>',
        bos_token='<s>', eos_token='</s>', mask_token='<mask>',
    )

    # Load dataset
    dataset = SFTDataset(data_path, tokenizer)
    print(f"SFT dataset: {len(dataset)} pairs")

    dataloader = DataLoader(
        dataset, batch_size=BATCH_SIZE, shuffle=True,
        collate_fn=collate_sft, num_workers=0
    )

    # Load pretrained model
    config = TransformerConfig()
    model = TransformerLM(config).to(DEVICE)

    if not os.path.exists(checkpoint_path):
        print(f"ERROR: Pretrained checkpoint not found: {checkpoint_path}")
        print("Run train_model.py first.")
        return

    checkpoint = torch.load(checkpoint_path, map_location=DEVICE)
    if 'model_state_dict' in checkpoint:
        model.load_state_dict(checkpoint['model_state_dict'])
        print(f"Loaded pretrained checkpoint (epoch {checkpoint.get('epoch','?')})")
    else:
        model.load_state_dict(checkpoint)
        print("Loaded pretrained model state dict")

    print(f"Total params: {sum(p.numel() for p in model.parameters()):,}")

    # Optimizer (lower LR for fine-tuning)
    optimizer = torch.optim.AdamW(model.parameters(), lr=LR, weight_decay=0.01)
    criterion = nn.CrossEntropyLoss(ignore_index=0)

    model.train()
    for epoch in range(NUM_EPOCHS):
        total_loss = 0
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
            loss = loss / GRAD_ACCUM
            loss.backward()
            total_loss += loss.item() * GRAD_ACCUM

            if (step + 1) % GRAD_ACCUM == 0:
                torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
                optimizer.step()
                optimizer.zero_grad()

            if step % 10 == 0:
                print(f"Epoch {epoch} | Step {step}/{len(dataloader)} | "
                      f"Loss {loss.item() * GRAD_ACCUM:.4f}")

        avg_loss = total_loss / len(dataloader)
        print(f"\nEpoch {epoch} complete. Avg loss: {avg_loss:.4f}\n")

        # Generation sample
        model.eval()
        test_prompts = ["<s>User: 你好\nAssistant:"]
        for p in test_prompts:
            gen = model.generate(tokenizer, p, max_new_tokens=50,
                                 temperature=0.8, top_k=40, top_p=0.9)
            print(f"  SAMPLE: {gen}\n")
        model.train()

    # Save SFT model
    final_path = 'models/sft_model_final.pt'
    torch.save({
        'model_state_dict': model.state_dict(),
        'config': {
            'vocab_size': VOCAB_SIZE,
            'embed_dim': EMBED_DIM,
            'num_layers': NUM_LAYERS,
            'num_heads': NUM_HEADS,
            'ffn_dim': FFN_DIM,
            'max_seq_len': MAX_SEQ_LEN,
        },
        'sft_epochs': NUM_EPOCHS,
    }, final_path)
    print(f"SFT model saved to {final_path}")


if __name__ == '__main__':
    import sys
    ckpt = sys.argv[sys.argv.index('--checkpoint') + 1] if '--checkpoint' in sys.argv else 'models/transformer_model_final.pt'
    data = 'data/sft/instructions.jsonl'
    if not os.path.exists(data):
        print(f"ERROR: SFT data not found at {data}")
        print("Create data/sft/instructions.jsonl with instruction-response pairs.")
        sys.exit(1)
    train(ckpt, data)
