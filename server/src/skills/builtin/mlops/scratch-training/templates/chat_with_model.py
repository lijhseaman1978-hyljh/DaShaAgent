"""chat_with_model.py — Interactive chat with the trained model.

Usage:
    /c/Program\ Files/Python310/python.exe chat_with_model.py [--checkpoint models/transformer_model_final.pt]

Options:
    --checkpoint    Path to model checkpoint (default: models/transformer_model_final.pt)
    --temperature   Sampling temperature (default: 0.8)
    --top_k         Top-k filtering (default: 40)
    --top_p         Nucleus sampling threshold (default: 0.9)
    --max_tokens    Max new tokens per generation (default: 100)
    --one-shot      Generate from a single prompt and exit
"""

import os
import sys
import torch
import argparse
from transformers import PreTrainedTokenizerFast

DEVICE = 'cuda' if torch.cuda.is_available() else 'cpu'

# Import model architecture from train_model
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from train_model import TransformerLM, TransformerConfig, VOCAB_SIZE, EMBED_DIM, NUM_LAYERS, NUM_HEADS, FFN_DIM, MAX_SEQ_LEN, DROPOUT


def load_model(checkpoint_path):
    """Load trained model from checkpoint."""
    config = TransformerConfig()
    model = TransformerLM(config).to(DEVICE)

    if not os.path.exists(checkpoint_path):
        print(f"ERROR: Checkpoint not found at {checkpoint_path}")
        print("Run train_model.py first to generate a checkpoint.")
        sys.exit(1)

    checkpoint = torch.load(checkpoint_path, map_location=DEVICE)
    if 'model_state_dict' in checkpoint:
        model.load_state_dict(checkpoint['model_state_dict'])
        epoch = checkpoint.get('epoch', '?')
        step = checkpoint.get('global_step', '?')
        print(f"Loaded checkpoint: epoch={epoch}, step={step}")
    else:
        model.load_state_dict(checkpoint)
        print(f"Loaded model state dict from {checkpoint_path}")

    model.eval()
    total_params = sum(p.numel() for p in model.parameters())
    print(f"Model: {total_params:,} params on {DEVICE}")
    return model


def load_tokenizer():
    """Load trained BPE tokenizer."""
    tok_dir = 'tokenizer/trained_tokenizer'
    return PreTrainedTokenizerFast(
        tokenizer_file=os.path.join(tok_dir, 'vocab.json'),
        unk_token='<unk>',
        pad_token='<pad>',
        bos_token='<s>',
        eos_token='</s>',
        mask_token='<mask>',
    )


def interactive_chat(model, tokenizer, temperature=0.8, top_k=40, top_p=0.9, max_new_tokens=100):
    """Interactive chat loop."""
    print(f"\n{'='*50}")
    print("Entering interactive chat mode.")
    print("Type 'quit' to exit, 'reset' to clear conversation.")
    print(f"  temperature={temperature}, top_k={top_k}, top_p={top_p}")
    print(f"{'='*50}\n")

    history = ""  # Simple concatenation context

    while True:
        try:
            user_input = input("You: ").strip()
        except (EOFError, KeyboardInterrupt):
            print("\nGoodbye!")
            break

        if not user_input:
            continue
        if user_input.lower() == 'quit':
            break
        if user_input.lower() == 'reset':
            history = ""
            print("Conversation reset.\n")
            continue

        # Build prompt with history context (simple approach)
        prompt = f"{history}<s>User: {user_input}\nAssistant:"

        # Truncate to max_seq_len-100 to leave room for generation
        encoded = tokenizer.encode(prompt)
        if len(encoded) > MAX_SEQ_LEN - max_new_tokens:
            # Keep the last MAX_SEQ_LEN - max_new_tokens tokens
            prompt_tokens = encoded[-(MAX_SEQ_LEN - max_new_tokens):]
            prompt = tokenizer.decode(prompt_tokens)

        try:
            response = model.generate(
                tokenizer, prompt,
                max_new_tokens=max_new_tokens,
                temperature=temperature,
                top_k=top_k,
                top_p=top_p,
            )
            # Extract just the new generation
            new_part = response[len(prompt):].strip()
            print(f"AI: {new_part}\n")
            history += f"User: {user_input}\nAssistant: {new_part}\n"
        except Exception as e:
            print(f"Error during generation: {e}")
            print("Try 'reset' and a shorter prompt.\n")


def main():
    parser = argparse.ArgumentParser(description='Chat with the trained model')
    parser.add_argument('--checkpoint', default='models/transformer_model_final.pt',
                        help='Path to model checkpoint')
    parser.add_argument('--temperature', type=float, default=0.8,
                        help='Sampling temperature')
    parser.add_argument('--top_k', type=int, default=40,
                        help='Top-k filtering')
    parser.add_argument('--top_p', type=float, default=0.9,
                        help='Nucleus (top-p) sampling')
    parser.add_argument('--max_tokens', type=int, default=100,
                        help='Max new tokens per generation')
    parser.add_argument('--one-shot', type=str, default=None,
                        help='Single prompt to generate from, then exit')

    args = parser.parse_args()

    tokenizer = load_tokenizer()
    model = load_model(args.checkpoint)
    print(f"Tokenizer vocab: {tokenizer.vocab_size}")

    if args.one_shot:
        # One-shot mode
        response = model.generate(
            tokenizer, args.one_shot,
            max_new_tokens=args.max_tokens,
            temperature=args.temperature,
            top_k=args.top_k,
            top_p=args.top_p,
        )
        print(f"\nPrompt: {args.one_shot}")
        print(f"Response: {response}")
    else:
        # Interactive chat
        interactive_chat(
            model, tokenizer,
            temperature=args.temperature,
            top_k=args.top_k,
            top_p=args.top_p,
            max_new_tokens=args.max_tokens,
        )


if __name__ == '__main__':
    main()
