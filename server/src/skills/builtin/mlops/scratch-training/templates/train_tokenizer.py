"""train_tokenizer.py — Train BPE tokenizer from scratch.

Usage:
    /c/Program\ Files/Python310/python.exe train_tokenizer.py

Input: All .txt files in data/raw/ (UTF-8 plain text)
Output: tokenizer/trained_tokenizer/ (vocab.json + merges.txt)
"""

from tokenizers import ByteLevelBPETokenizer
from glob import glob
import os

VOCAB_SIZE = 12000
MIN_FREQUENCY = 2
SPECIAL_TOKENS = ['<pad>', '<s>', '</s>', '<unk>', '<mask>']

def main():
    os.makedirs('tokenizer/trained_tokenizer', exist_ok=True)

    files = glob('data/raw/*.txt')
    if not files:
        print("ERROR: No .txt files found in data/raw/")
        print("Place your article files as UTF-8 .txt in data/raw/ first.")
        return

    print(f"Found {len(files)} text files:")
    for f in files:
        size_kb = os.path.getsize(f) / 1024
        print(f"  {f} ({size_kb:.0f} KB)")

    tokenizer = ByteLevelBPETokenizer()
    print(f"\nTraining BPE tokenizer (vocab_size={VOCAB_SIZE}, min_frequency={MIN_FREQUENCY})...")
    tokenizer.train(files, vocab_size=VOCAB_SIZE, min_frequency=MIN_FREQUENCY,
                    special_tokens=SPECIAL_TOKENS)

    save_path = 'tokenizer/trained_tokenizer'
    tokenizer.save(save_path)
    print(f"\nTokenizer saved to {save_path}/")
    print(f"Actual vocab size: {tokenizer.get_vocab_size()}")

    # Quick test
    test_text = "你好，世界！这是一个测试句子。"
    encoded = tokenizer.encode(test_text)
    print(f"\nTest encoding: '{test_text}'")
    print(f"  Tokens: {encoded.ids[:20]}...")
    print(f"  Length: {len(encoded.ids)} tokens")

if __name__ == '__main__':
    main()
