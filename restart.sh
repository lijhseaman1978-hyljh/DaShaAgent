#!/usr/bin/env bash
# DaShaAgent 一键重启（单实例，规避进程蔓延）
# 用法: bash restart.sh   （脚本会自动定位自身所在目录，无需写死路径）
set -u
HARNESS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
mkdir -p "$HARNESS_DIR/data"
LOG="$HARNESS_DIR/data/harness_boot.log"

echo "[restart] 1/3 停止所有 harness 进程（按 cwd 精确匹配，不误杀其他）..."
KILLED=0
SELF=$$
# 修复：脚本自身（及其父 shell / 子 shell）cwd 也可能等于 HARNESS_DIR，
# 若不排除会把自己杀掉，导致 restart 在第 1 步就中止。
for p in /proc/[0-9]*; do
  pid=$(basename "$p")
  [ "$pid" = "$SELF" ] && continue
  [ "$pid" = "$PPID" ] && continue
  cwd=$(readlink "$p/cwd" 2>/dev/null)
  if [ "$cwd" = "$HARNESS_DIR" ]; then
    # 只杀真正的 harness 服务进程（node/tsx），不动 shell / 编辑器 / git 等
    cmd=$(tr '\0' ' ' < "$p/cmdline" 2>/dev/null)
    case "$cmd" in
      *tsx*server*|*node*server*|*node_modules/.bin/tsx*) ;;
      *) continue ;;
    esac
    kill -9 "$pid" 2>/dev/null && { echo "  killed PID $pid  [$cmd]"; KILLED=$((KILLED+1)); }
  fi
done
[ "$KILLED" -eq 0 ] && echo "  (无旧进程)"
sleep 2

echo "[restart] 2/3 以 tsx 单实例启动服务..."
cd "$HARNESS_DIR" || exit 1
# 关键：直接跑 tsx，不要 npm run dev（npm 会拉 supervisor 导致进程蔓延抢端口）
nohup node_modules/.bin/tsx server/src/unified.ts > "$LOG" 2>&1 &
NEW_PID=$!
echo "  已启动 PID $NEW_PID，日志: $LOG"

echo "[restart] 3/3 等待并探测端口..."
sleep 6
PORT="${AH_CONTROL_PORT:-3001}"
CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "http://localhost:$PORT/" 2>/dev/null)
if [ "$CODE" = "200" ]; then
  echo "[restart] ✅ 服务就绪 (HTTP 200)，使用: http://localhost:$PORT/"
else
  echo "[restart] ⚠️ 6s 内未收到 200（可能冷启动较慢），请稍候并查看日志: tail -f $LOG"
fi
