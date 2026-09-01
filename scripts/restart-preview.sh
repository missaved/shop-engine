#!/usr/bin/env bash
# 重启局域网预览服务（`next start` / pnpm 起生产模式）
# 背景：本项目局域网预览跑的是生产模式（next start），但 build/start 错位会复现
# 「页面引用新 asset（CSS/JS文件名）但 server 用旧 .next 快照 → 静态资源 404 → 样式/交互崩」。
# Vercel 部署不受影响（自动 build+start 同步）；仅本地预览需要每次改码+build 后重启本服务。
#
# 用法：
#   bash scripts/restart-preview.sh          # 杀旧 + 用当前 .next 重启
#   bash scripts/restart-preview.sh --build  # 先 pnpm build 再重启（推荐每次改码后）
#   bash scripts/restart-preview.sh --port 3000
#   bash scripts/restart-preview.sh --host 0.0.0.0
# 环境变量：
#   PORT（默认 3000）/ HOST（默认 0.0.0.0）

set -euo pipefail

# ---- 参数解析 ----
PORT="${PORT:-3000}"
HOST="${HOST:-0.0.0.0}"
DO_BUILD=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --build) DO_BUILD=1 ;;
    --port) PORT="$2"; shift ;;
    --host) HOST="$2"; shift ;;
    -h|--help)
      echo "用法: $0 [--build] [--port 3000] [--host 0.0.0.0]"
      echo "  --build  启动前先 pnpm build（推荐：改码后必加，确保 .next 与源码同步）"
      exit 0 ;;
    *) echo "未知参数: $1"; exit 1 ;;
  esac
  shift
done

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$APP_DIR"

echo "==> 项目目录: $APP_DIR"

# ---- 1) 可选 build（同步 .next）----
if [[ "$DO_BUILD" == "1" ]]; then
  echo "==> [build] 构建 .next ..."
  CI=true pnpm build
fi

# ---- 2) 杀掉旧 next start（防 build/start 错位）----
echo "==> 停止旧 next start（端口 $PORT）..."
# 优先按端口找 PID（fuser），再兜底 pkill
if command -v fuser >/dev/null 2>&1; then
  fuser -k "${PORT}/tcp" 2>/dev/null || true
fi
# 兜底：杀所有 next start（含 sh 包装 + next-server），避免误匹配自身
pkill -9 -f "next start.*-p ${PORT}" 2>/dev/null || true
pkill -9 -f "next-server" 2>/dev/null || true
# 等端口释放
for _ in $(seq 1 20); do
  if ! (ss -tlnp 2>/dev/null | grep -q ":${PORT} "); then
    break
  fi
  sleep 0.5
done
echo "==> 端口 $PORT 已释放"
sleep 1

# ---- 3) 用新 .next 启动（setsid + 双重后台 + 全重定向，防父脚本阻塞/被 SIGHUP）----
echo "==> 启动 next start -H $HOST -p $PORT ..."
LOG="/tmp/next-start-$PORT.log"
# 用 pnpm 确保 PATH 含 node_modules/.bin（next 在 PATH 外）。
# 双 fork + setsid + 全重定向：子进程脱离本脚本的进程组与全部 fd，
# 脚本退出后 next 仍存活（不被 SIGHUP），且后台子进程不阻塞脚本结束。
(
  setsid bash -c "exec pnpm next start -H '${HOST}' -p '${PORT}' >> '${LOG}' 2>&1" >/dev/null 2>&1 </dev/null &
)
disown -a 2>/dev/null || true

# ---- 4) 等待就绪 ----
echo "==> 等待服务就绪..."
for _ in $(seq 1 40); do
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "http://localhost:${PORT}/api/health" 2>/dev/null || echo 000)"
  if [[ "$code" == "200" ]]; then
    echo "==> ✅ 服务就绪: http://localhost:${PORT}  (health=200)"
    echo "    局域网访问: http://${HOST}:${PORT}"
    exit 0
  fi
  # 启动失败（如 EADDRINUSE / Failed to start）
  if grep -qiE "EADDRINUSE|Failed to start" "$LOG" 2>/dev/null; then
    echo "❌ 启动失败，日志:"
    tail -20 "$LOG"
    exit 1
  fi
  sleep 0.5
done

echo "❌ 等待超时，最后日志:"
tail -20 "$LOG"
exit 1
