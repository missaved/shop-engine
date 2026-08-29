#!/usr/bin/env bash
# 无人值守看门狗（2026-08-29）：每 15 分钟 cron 触发
#  1) 占位图补全循环若不在（且未正常完成）→ 重启
#  2) 补图完成后 → 自动启动 cn-drinks 中国酒水预设生成（FoodPreset 尚无该子分类时）
cd /root/shop-saas/app || exit 1
LOG=logs/watchdog.log
touch "$LOG"

# 1. 补图循环存活
if ! pgrep -f refill-img-loop.sh >/dev/null && ! grep -q '占位图补全完成' logs/refill-img.log 2>/dev/null; then
  nohup bash scripts/refill-img-loop.sh >/dev/null 2>&1 &
  echo "[$(date '+%F %T')] 补图进程不在，已重启" >> "$LOG"
fi

# 2. 补图完成 → 生成 cn-drinks
if grep -q '占位图补全完成' logs/refill-img.log 2>/dev/null && ! pgrep -f 'generate-presets' >/dev/null; then
  set -a; source .env 2>/dev/null; set +a
  DBURL="${DATABASE_URL%%\?*}"
  CN=$(psql "$DBURL" -tA -c "SELECT count(*) FROM \"FoodPreset\" WHERE country='VN' AND subcategory='cn-drinks' AND active=true;" 2>/dev/null)
  if [ "$CN" = "0" ] || [ -z "$CN" ]; then
    nohup pnpm tsx scripts/generate-presets.mts cn-drinks --auto-wait >> logs/gen-cn-drinks.log 2>&1 &
    echo "[$(date '+%F %T')] 启动 cn-drinks 生成" >> "$LOG"
  fi
fi
