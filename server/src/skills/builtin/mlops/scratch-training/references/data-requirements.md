# Training Data Requirements

## Data Sources Available

The user (远洋油轮船长 Li Jinhui) has extensive maritime knowledge bases that can serve as pretraining data:

### 1. Text Articles (.txt format)
Place these in `data/raw/`:
- **Maritime knowledge base** (~670 files, 121MB from ~/.dasha/knowledge/船舶知识库/)
- **BUILT FOUND SMS** (~2.9MB from ~/.dasha/knowledge/BUILT_FOUND_SMS/)
- **HVPQ** (~160KB from ~/.dasha/knowledge/HVPQ/, txt extracts available)
- **NO.A ship certificates** (~578KB from ~/.dasha/knowledge/NO.A/)
- **MANUAL ship documents** (~4MB from ~/.dasha/knowledge/MANUAL/, 88 files)
- **Captain CODE materials** (~765MB from ~/.dasha/knowledge/船长CODE资料/, 77 files)

### 2. SFT Dialogue Data
Place in `data/sft/instructions.jsonl`:
- Each line: `{"instruction": "...", "response": "..."}`
- Format the response as ship captain expertise
- Minimum 500-1000 pairs for basic conversation ability

## Recommended Preparation

### For Pretraining (Phase 1)
1. Extract text from existing knowledge bases using offline-office skill
2. Combine multiple .txt files (500KB-2MB each) for variety
3. Minimum: 10MB total text for ~8.5M param model
4. Target: 50-100MB for good language understanding
5. **NEW: Synthetic data via LLM API** — when scraping is blocked, use `data_generate_synthetic.py` to generate Chinese training data (see SKILL.md Option D for details). Proven: 187 files, ~8.6MB in one session.

### For SFT (Phase 2)
1. Create instruction-response pairs covering:
   - Ship operations knowledge
   - ISM/ISPS/SOLAS regulations
   - Navigation watchkeeping
   - Cargo operations (oil/chemical tankers)
   - Emergency procedures
   - General conversation
2. Each pair: 50-500 tokens
3. QA format is best for learning conversation patterns

## Quick Pipeline

```bash
# Step 1: Copy .txt files to data/raw/
cp -r ~/.dasha/knowledge/船长CODE资料/*.txt /d/dasha/WORKSPACE/ai_training/data/raw/

# Step 2: Train tokenizer (~2 min for 100MB)
/c/Program\ Files/Python310/python.exe train_tokenizer.py

# Step 3: Prepare data (~5 min for 100MB)
/c/Program\ Files/Python310/python.exe prepare_data.py

# Step 4: Train model (3-7 days for 20 epochs)
/c/Program\ Files/Python310/python.exe train_model.py

# Step 5: Chat interactively
/c/Program\ Files/Python310/python.exe chat_with_model.py
```

## Performance Projection

| Data Size | Epochs | Batch | Effective Batch | Est. Time (RTX 5060) |
|-----------|--------|-------|----------------|----------------------|
| 10 MB     | 20     | 8     | 32             | ~1 day               |
| 50 MB     | 20     | 8     | 32             | ~3-4 days            |
| 100 MB    | 20     | 8     | 32             | ~5-7 days            |
| 200 MB    | 10     | 8     | 32             | ~7 days              |

> Note: RTX 5060 8GB is primarily memory-constrained, not compute-constrained for 8.5M params. Actual throughput: ~5,000-8,000 tokens/sec.
