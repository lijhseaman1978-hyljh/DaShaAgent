#!/usr/bin/env python3
"""
Synthetic Chinese Training Data Generator
==========================================
Generate training data (plain text articles) via LLM API when web scraping
is blocked or local data is insufficient.

Strategy: Prompt a capable LLM to write short articles across diverse topics.
Each API call produces 10-12 articles. Parse markdown output into individual
.txt files ready for training.

Usage:
    python data_generate_synthetic.py

Output: ./data/raw/synth_<timestamp>_<title>.txt

Config:
    Auto-detects available API keys:
      1. DEEPSEEK_API_KEY → uses https://api.deepseek.com/v1
      2. OPENROUTER_API_KEY → uses https://openrouter.ai/api/v1
      3. Falls back to DEEPSEEK_API_KEY if neither is set (prints warning)
"""

import openai
import os
import re
import sys
import time

# ── Configuration ──────────────────────────────────────────────────────

OUTPUT_DIR = "data/raw"
TEMPERATURE = 0.8
MAX_TOKENS = 4096
DELAY_BETWEEN_CALLS = 2.0  # seconds between batches, avoid rate limits
MAX_RETRIES = 3             # retry on API failure

# ── API Auto-Detection ────────────────────────────────────────────────

def detect_api():
    """Auto-detect API credentials. Returns (client, model_name, source)."""
    deepseek_key = os.environ.get("DEEPSEEK_API_KEY")
    openrouter_key = os.environ.get("OPENROUTER_API_KEY")

    if deepseek_key:
        client = openai.OpenAI(
            api_key=deepseek_key,
            base_url=os.environ.get("DEEPSEEK_BASE_URL", "https://api.deepseek.com/v1")
        )
        model = "deepseek-chat"
        source = "DeepSeek Direct"
        return client, model, source

    if openrouter_key:
        client = openai.OpenAI(
            api_key=openrouter_key,
            base_url="https://openrouter.ai/api/v1"
        )
        model = "deepseek/deepseek-v4-flash"
        source = "OpenRouter"
        return client, model, source

    print("[WARN] No API key found. Set DEEPSEEK_API_KEY or OPENROUTER_API_KEY.")
    print("       For now, using DEEPSEEK_API_KEY from .env fallback...")
    # Try loading from dasha .env as last resort
    env_path = os.path.expanduser("~/.dasha/.env")
    if os.path.exists(env_path):
        with open(env_path) as f:
            for line in f:
                line = line.strip()
                if line.startswith("DEEPSEEK_API_KEY="):
                    key = line.split("=", 1)[1].strip().strip("'\"")
                    if key:
                        client = openai.OpenAI(api_key=key, base_url="https://api.deepseek.com/v1")
                        return client, "deepseek-chat", "DeepSeek Direct (from .env)"
    sys.exit(1)


# ── Topic Banks ────────────────────────────────────────────────────────

# Each inner list = one API call. Vary prompts session-to-session to avoid
# "topic introduction" fatigue where every article sounds the same.

TOPIC_BATCHES_V1 = [
    ["海洋探索", "日常生活", "自然美景", "旅行游记", "中华文化",
     "科学发现", "历史故事", "美食烹饪", "人生哲理", "科技创新"],
    ["人工智能", "环境保护", "体育运动", "音乐艺术", "宇宙天文",
     "健康养生", "动物世界", "时尚穿搭", "建筑美学", "心理学"],
    ["经济知识", "教育成长", "摄影技巧", "电影赏析", "编程技术",
     "家居装修", "亲子教育", "植物花卉", "茶道文化", "职场经验"],
    ["古代文明", "现代科技", "社会热点", "地理探险", "心理成长",
     "语言学习", "手工制作", "交通出行", "哲学思考", "物理世界"],
]

# Bank V2 — different style prompts to vary output
TOPIC_BATCHES_V2 = [
    ["睡前小故事", "童年回忆", "第一次做饭", "我的宠物", "下雨天",
     "老物件的故事", "邻居家的事", "路上的风景", "一碗面的味道", "深夜的思考"],
    ["怎么保养汽车", "家里种什么花", "为什么星星会眨眼", "怎样省钱",
     "如何判断水果熟了", "为什么猫会踩奶", "怎样写日记", "冰箱里的秘密"],
    ["一个失败的经历", "关于等待", "关于勇气", "看不见的努力",
     "慢慢来比较快", "说'不'的艺术", "最贵的东西", "老人说的话"],
    ["窗外的风景", "冬天的味道", "菜市场的热闹", "凌晨四点的城市",
     "火车的记忆", "那条走了十年的路", "一本翻旧的书", "写给十年后的自己"],
]

ALL_BATCHES = TOPIC_BATCHES_V1 + TOPIC_BATCHES_V2


# ── Generation ─────────────────────────────────────────────────────────

def generate_batch(client, model, topics, output_dir, batch_idx, total_batches):
    """Generate articles for one batch of topics via API. Retries on failure."""
    n = len(topics)
    ts = int(time.time())

    # Alternate prompt structures to avoid output monotony
    if batch_idx % 3 == 0:
        # Standard prompt
        prompt = (
            f"请用中文写{n}篇短文，每篇100-500字，"
            f"覆盖以下主题：{'、'.join(topics)}\n\n"
            "格式要求：\n"
            "## [主题名]\n"
            "标题：[文章标题]\n"
            "内容：[正文...]\n\n"
            "## [主题名2]\n"
            "标题：[文章标题2]\n"
            "内容：[正文...2]\n\n"
            "要求：语言自然流畅，避免生硬的开头结尾，不要用'首先'、'其次'等框架词汇。"
        )
    elif batch_idx % 3 == 1:
        # Storytelling prompt
        prompt = (
            f"请以第一人称或第三人称写{n}个故事或随笔，每个100-500字，"
            f"围绕以下主题：{'、'.join(topics)}\n\n"
            "格式要求：\n"
            "## [主题名]\n"
            "标题：[文章标题]\n"
            "内容：[正文...]\n\n"
            "所有内容要有具体情节、细节和感受，不要写成干巴巴的百科介绍。"
        )
    else:
        # Explanatory/informative prompt
        prompt = (
            f"请用中文写{n}篇知识性或评论性短文，每篇100-500字，"
            f"关于以下主题：{'、'.join(topics)}\n\n"
            "格式要求：\n"
            "## [主题名]\n"
            "标题：[文章标题]\n"
            "内容：[正文...]\n\n"
            "要求：深入浅出，像写给朋友看一样自然，不要列一二三四点的框架结构。"
        )

    for attempt in range(MAX_RETRIES):
        try:
            response = client.chat.completions.create(
                model=model,
                messages=[{"role": "user", "content": prompt}],
                temperature=TEMPERATURE,
                max_tokens=MAX_TOKENS,
            )
            text = response.choices[0].message.content
            break
        except Exception as e:
            print(f"  [RETRY {attempt+1}/{MAX_RETRIES}] API failed: {e}")
            if attempt < MAX_RETRIES - 1:
                time.sleep(5 * (attempt + 1))
            else:
                print("  [SKIP] Batch failed after all retries.")
                return 0

    # Parse markdown sections (## Topic)
    sections = re.split(r'^##\s+', text, flags=re.MULTILINE)[1:]
    saved = 0

    for section in sections:
        lines = section.strip().split('\n')
        if not lines:
            continue

        topic = lines[0].strip()
        title = ""
        body_lines = []

        for line in lines[1:]:
            if line.startswith("标题：") or line.startswith("标题:"):
                title = line.split("：", 1)[-1].split(":", 1)[-1].strip()
            else:
                body_lines.append(line)

        body = '\n'.join(body_lines).strip()
        if not body or len(body) < 20:
            continue

        # Save as .txt
        safe_title = re.sub(r'[\\/:*?\"<>|]', '_', title or topic)[:60]
        filename = f"{output_dir}/synth_{ts:08d}_{saved:02d}_{safe_title}.txt"
        with open(filename, "w", encoding="utf-8") as f:
            f.write(body)
        saved += 1
        print(f"  [OK] {filename} ({len(body)} chars)")

    return saved


def main():
    client, model, source = detect_api()
    print(f"API source: {source}")
    print(f"Model: {model}")
    print(f"Output: {OUTPUT_DIR}/")
    print(f"Batches: {len(ALL_BATCHES)} total\n")

    os.makedirs(OUTPUT_DIR, exist_ok=True)
    total_saved = 0
    t_start = time.time()

    for batch_idx, topics in enumerate(ALL_BATCHES, 1):
        print(f"{'='*60}")
        print(f"Batch {batch_idx}/{len(ALL_BATCHES)}: {' | '.join(topics[:4])}..." if len(topics) > 4
              else f"Batch {batch_idx}/{len(ALL_BATCHES)}: {', '.join(topics)}")
        print(f"{'='*60}")

        n = generate_batch(client, model, topics, OUTPUT_DIR, batch_idx, len(ALL_BATCHES))
        total_saved += n
        elapsed = time.time() - t_start
        rate = total_saved / elapsed * 3600 if elapsed > 0 else 0
        print(f"  → Saved {n} files this batch | Total: {total_saved} | {elapsed:.0f}s elapsed | ~{rate:.0f} files/hr")

        if batch_idx < len(ALL_BATCHES):
            time.sleep(DELAY_BETWEEN_CALLS)

    elapsed = time.time() - t_start
    print(f"\n{'='*60}")
    print(f"Done! {total_saved} files generated in {OUTPUT_DIR}/")
    print(f"Time: {elapsed:.0f}s ({elapsed/60:.1f}min)")
    print(f"{'='*60}")
    print("\nNext step: re-run prepare_data.py to rebuild the combined dataset")
    print("  python prepare_data.py")


if __name__ == "__main__":
    main()
