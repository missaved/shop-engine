#!/usr/bin/env bash
# 占位图补全循环（2026-08-29 用户报「全部是默认图」）：
#   跑 refill-placeholder-images.mts 把 placeholder 图重出为真图；
#   minimax QUOTA（exit 3）→ 睡 5h5m 自动续跑；正常完成退出；异常 60s 重试。
cd /root/shop-saas/app || exit 1
while true; do
  pnpm tsx scripts/refill-placeholder-images.mts >> logs/refill-img.log 2>&1
  code=$?
  if [ $code -eq 3 ]; then
    echo "[$(date '+%F %T')] minimax QUOTA，睡 5h5m 后续跑" >> logs/refill-img.log
    sleep 18300
  elif [ $code -eq 0 ]; then
    echo "[$(date '+%F %T')] 占位图补全完成" >> logs/refill-img.log
    break
  else
    echo "[$(date '+%F %T')] 异常 exit=$code，60s 后重试" >> logs/refill-img.log
    sleep 60
  fi
done
