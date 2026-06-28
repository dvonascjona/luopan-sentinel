<!-- TAG: 执行指令 | 用途: 罗盘哨兵技术债务与待修复问题 | 生成: 2026-05-10 -->
# 罗盘哨兵 — 技术债务（TECH_DEBT.md）

> 版本：v1.2 | 更新：2026-06-28
>
> v1.2 (2026-06-28) [新增] TD-12 大屏截图白屏/¥0（根因=fallback URL畸形+按钮偶发缺失），已修复归档 TD-F；保留 TD-12 跟踪偶发触发器
> v1.1 (2026-05-10) [新增] TD-09 Linux字体暴露、TD-10 鼠标轨迹瞬移、TD-11 Route B待验证端点

---

## 一、活跃技术债

### TD-01：screen_ 中 7 个 null 字段（P1）

**现象**：`live_clean.json` 中以下字段始终为 null：
- `screen_watch_ucnt`
- `screen_refund_amt`
- `screen_stat_cost`
- `screen_5min_gmv`
- `screen_5min_gmv_change`
- `screen_5min_watch`
- `screen_5min_watch_change`

**根因待排查**：
1. `screen_capture.js` 是否捕获到 `five_min_data` 响应？
2. `extract_screen_summary.js` 是否正确从响应中提取这些字段？
3. `screen_clean.json` 中是否有对应数据？

**影响**：大屏 5 分钟增量数据缺失，`hourly_report.js` 趋势分析不完整

---

### TD-02：废弃脚本未清理（P3）

**现象**：`/opt/douyin-fetcher/` 根目录有 30+ 早期探索文件（见 ARCHITECTURE.md 废弃脚本列表）

**影响**：目录混乱，新接手者难以分辨生产文件

**建议**：移到 `/opt/douyin-fetcher/archive/` 子目录

---

### TD-03：备份文件散落（P3）

**现象**：`*.bak.*` 备份文件散落在根目录

| 备份文件 | 大小 |
|---|---|
| `live_capture_v3.js.bak.202605090144` | 15KB |
| `live_capture_v3.js.bak.202605090327` | 15KB |
| `screen_capture.js.bak.202605091006` | 25KB |
| `screen_capture.js.bak.202605091839` | 27KB |
| `quick_check.js.bak.*` (4个) | 10-12KB each |
| `qr_login_flow.js.bak.202605090539` | 10KB |
| `server.js.pre_*` (5个) | 22-66KB each |

**建议**：确认稳定后移到 `archive/backups/`

---

### TD-04：qr_login_flow 缺 flock 互斥（P2）

**现象**：手动多次启动会产生多个进程各发一张二维码

**解决方案**：
- 方案 A：脚本开头加 `flock -xn /tmp/qr_login.lock`
- 方案 B：启动前手动 `pkill -f qr_login_flow`（当前做法，人工保证）

---

### TD-05：Cron jitter 未全覆盖（P3）

**现象**：只有 `quick_check` 加了 `sleep $((RANDOM % 60))` jitter

**建议**：`live_capture_v3` 和 `screen_capture` 也加 `sleep $((RANDOM % 90))` 消除固定节律

---

### TD-06：blend_trend_v2 返回 11001（P3）

**现象**：综合趋势 API `st:11001`，`data=null`

**影响**：低。`five_min_data` 可替代

---

### TD-07：live_order 返回 621000601（P3）

**现象**：逐单列表 API 参数校验失败

**影响**：低。`core_data` 已有聚合数据

---

### TD-08：用户画像数据缺失（P3）

**现象**：平台返回「非电商直播间无法查看用户画像」

**影响**：低。平台限制，非脚本问题，暂无解法

---

### TD-09：Linux 字体库暴露运行环境（P3）[v1.1新增]

**现象**：服务器 Linux 字体集与真实商家用的 Windows/Mac 差异大，Canvas 指纹会体现

**影响**：低。机房 IP 已是更大的暴露点，字体差异是次要信号

**方案**：安装 Windows 中文字体包（如 `fonts-wqy-microhei`），或迁移到 Windows 本地运行

---

### TD-10：鼠标轨迹瞬移（P3）[v1.1新增]

**现象**：`scrollIntoView + click` 没有模拟鼠标移动路径，headless 下坐标直接跳转

**影响**：低。headless 不渲染鼠标轨迹，平台检测 `mousemove` 事件收益极低

**方案**：暂不处理。若未来需要，可加贝塞尔曲线鼠标移动模拟

---

### TD-11：Route B 4 个 DataSetKey 待验证（P2）[v1.1新增]

**现象**：以下千川 Route B 端点尚未实际测试直连可行性

| reqFrom | DataSetKey | 数据价值 |
|---|---|---|
| `commonMetricCard` | `board_roi2_overview_conf_next` | 千川看板总览（订单/GPM/消耗） |
| `totalTrend` | `board_roi2_total_trend_next` | **5 分钟千川消耗时序**（高价值） |
| `funnelModule` | `board_roi2_funnel_core` | 完整漏斗（曝光→成交） |
| `sourceChannel` | `board_roi2_source` | 渠道分流 |

**影响**：`totalTrend` 价值最高——若验证通过，可在 `quick_check.js` 中加入千川消耗实时监控

**方案**：下次直播时手动测试，在 `route_b_pull.js` 中逐个加入并验证

### TD-12：大屏截图偶发白屏/¥0（P3）[v1.2新增]

**现象（2026-06-28 dv 发现）**：杭州业绩表自动填表的两张大屏截图（专业版/基础版）偶发整片空白或「累计销售额 ¥0」，而**表格数字列完全正确**（K/L/M 走 Route B `screen_GMV`/`qc_` 程序提取，与铁律 2.8 一致，不受影响）。千川截图正常。

**根因（已定位）**：
1. **触发器**：罗盘 live-list 里 `a.d1wcp`（直播大屏按钮）偶发未渲染 → `[2] WARN: a.d1wcp not found in DOM` → 走 fallback 直连 URL。
2. **放大器（真凶）**：`screen_capture.js:339` fallback URL 用路径式 `/screen/live/talent/live_room_id=`（畸形），页面解析不到房间 → 专业版白屏；随后点基础版开的新 tab 也丢 `live_room_id`（`?source=compass_inner` 裸 URL）→ 基础版 ¥0。

**已修复（2026-06-28）**：
- **A 根因**：fallback URL `/live_room_id=` → `?live_room_id=`，对齐日志里已验证可正常加载的查询式 URL。
- **B 守卫**：截图前 `ensureScreenRoom()` 校验页面 URL 含 `?live_room_id=\d{6,}`，缺失则重导航正确 URL 重试 ≤3 次；仍空则判定空图、**跳过贴图 + 发飞书文字告警**（不再用 ¥0 图误导 boss）。日志标记 `[SHOT-GUARD]` / `[GUARD:疑似空图]`。
- 备份：`screen_capture.js.bak.202606281054`(pre-A) / `.preB.202606281113`(pre-B)。

**残留（保留跟踪）**：触发器本身（按钮偶发未渲染）未根除，只是被 fallback 修复 + 守卫兜住。若 `[SHOT-GUARD]` 告警变频繁，需回头加「按钮查找重试」或「STEP2 直接构造正确 URL 跳过点击」。

**影响**：低。数字列从不受影响；截图为辅助凭证，已有兜底。

---

## 二、已解决的技术债（归档）

| ID | 问题 | 解决日期 | 方案 |
|---|---|---|---|
| ~~TD-A~~ | storageState 不持久化 | 2026-05-09 | 正常+异常双路径写回 |
| ~~TD-B~~ | 固定 waitForTimeout | 2026-05-09 | 全部改 rnd(min,max) |
| ~~TD-C~~ | n8n REST API 不生效 | 2026-05-10 | 停机直改 SQLite 两张表 |
| ~~TD-D~~ | screen_clean.json 10MB 撑爆 n8n | 2026-05-10 | extract_screen_summary 预提取 |
| ~~TD-E~~ | qr_login 启动即删 cookie | 2026-05-09 | getProfile(false) + 原子替换 |
| ~~TD-F~~ | 大屏截图白屏/¥0（fallback URL 畸形 `/live_room_id=`） | 2026-06-28 | 改 `?live_room_id=` + ensureScreenRoom 守卫跳过空图（见 TD-12） |

---

## 三、Changelog

| 日期 | 变更 |
|---|---|
| 2026-06-28 | v1.2 — [新增] TD-12 大屏截图白屏/¥0 根因+修复；归档 TD-F |
| 2026-05-10 | v1.1 — [新增] TD-09/10/11（Linux字体/鼠标轨迹/Route B待验证） |
| 2026-05-10 | v1.0 — 从 `luopan_agent_progress.md` 拆分建档 |
