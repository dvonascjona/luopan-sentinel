#!/usr/bin/env bash
set -euo pipefail

now_bjt() {
  TZ=Asia/Shanghai date '+%Y-%m-%d %H:%M:%S BJT'
}

mem_available_kb() {
  awk '/^MemAvailable:/ { print $2 }' /proc/meminfo
}

swap_used_kb() {
  awk '/^SwapTotal:/ { total=$2 } /^SwapFree:/ { free=$2 } END { print total-free }' /proc/meminfo
}

before_mem="$(mem_available_kb)"
before_swap="$(swap_used_kb)"

# 只回收可再生成的文件缓存；不停止 n8n、PM2、Memoh 等业务进程。
sync
echo 3 > /proc/sys/vm/drop_caches
echo 1 > /proc/sys/vm/compact_memory

after_mem="$(mem_available_kb)"
after_swap="$(swap_used_kb)"

printf '[MEMORY_PREP] %s available_kb=%s->%s swap_used_kb=%s->%s\n' \
  "$(now_bjt)" "$before_mem" "$after_mem" "$before_swap" "$after_swap"

# 两个 CloakBrowser 并发前至少保留 1 GiB 可用内存；不足就真实失败并报警到日志。
if (( after_mem < 1048576 )); then
  printf '[MEMORY_PREP_FAIL] available_kb=%s threshold_kb=1048576\n' "$after_mem" >&2
  exit 1
fi
