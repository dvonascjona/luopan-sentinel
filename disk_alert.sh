#!/bin/bash
CHAT_ID="oc_af2b50b253a140dafe12c2d2a1acd9e9"
THRESHOLD=85
USAGE=$(df / | awk 'NR==2 {print $5}' | tr -d '%')
if [ "$USAGE" -ge "$THRESHOLD" ]; then
  AVAIL=$(df -h / | awk 'NR==2 {print $4}')
  lark-cli im +messages-send --chat-id "$CHAT_ID" --text "⚠️ 罗盘哨兵磁盘告警\n当前占用: ${USAGE}%（剩余 ${AVAIL}）\n超过阈值 ${THRESHOLD}%，请及时清理" --as bot 2>&1
  echo "$(date '+%Y-%m-%d %H:%M:%S') [ALERT] 磁盘 ${USAGE}% >= ${THRESHOLD}%，已发飞书"
else
  echo "$(date '+%Y-%m-%d %H:%M:%S') [OK] 磁盘 ${USAGE}%"
fi
