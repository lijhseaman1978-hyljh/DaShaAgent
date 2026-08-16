"""prepare_data.py — Sliding-window tokenization of raw text.

Usage:
    /c/Program\ Files/Python310/python.exe prepare_data.py

Input: data/raw/*.txt + tokenizer/trained_tokenizer/
Output: data/processed/ (HuggingFace Dataset with input_ids + attention_mask)
"""

import os
import json
from glob import glob
from transformers import PreTrainedTokenizerFast
from datasets import Dataset
import pickle

MAX_LEN = 256
STRIDE = 128

def load_tokenizer():
    """Load the trained BPE tokenizer from saved files."""
    tok_dir = 'tokenizer/trained_tokenizer'
    return PreTrainedTokenizerFast(
        tokenizer_file=os.path.join(tok_dir, 'vocab.json'),
        unk_token='<unk>',
        pad_token='<pad>',
        bos_token='<s>',
        eos_token='</s>',
        mask_token='<mask>',
    )

def chunk_text(text, tokenizer, max_len=MAX_LEN, stride=STRIDE):
    """Split long text into overlapping chunks using sliding window."""
    tokens = tokenizer.encode(text, add_special_tokens=False)
    chunks = []
    for i in range(0, len(tokens), stride):
        chunk = tokens[i:i + max_len]
        if len(chunk) < 10:  # skip very short chunks (noise)
            continue
        chunks.append(chunk)
    return chunks

def main():
    os.makedirs('data/processed', exist_ok=True)

    tokenizer = load_tokenizer()
    print(f"Tokenizer loaded. Vocab size: {tokenizer.vocab_size}")

    raw_files = glob('data/raw/*.txt')
    if not raw_files:
        print("ERROR: No .txt files found in data/raw/")
        return

    all_chunks = []
    total_chars = 0

    for fpath in raw_files:
        fname = os.path.basename(fpath)
        with open(fpath, 'r', encoding='utf-8') as f:
            text = f.read()
        total_chars += len(text)
        chunks = chunk_text(text, tokenizer)
        all_chunks.extend(chunks)
        print(f"{fname}: {len(text):,} chars → {len(chunks)} chunks")

    print(f"\nTotal: {total_chars:,} chars → {len(all_chunks):,} chunks")

    # Save as HuggingFace Dataset
    dataset = Dataset.from_dict({'input_ids': all_chunks})
    dataset.save_to_disk('data/processed/dataset')
    print(f"Dataset saved to data/processed/dataset/ ({len(dataset)} samples)")

    # Also save raw token IDs as pickle (backup)
    with open('data/processed/token_ids.pkl', 'wb') as f:
        pickle.dump(all_chunks, f)
    print(f"Raw token IDs saved to data/processed/token_ids.pkl")

if __name__ == '__main__':
    main()
