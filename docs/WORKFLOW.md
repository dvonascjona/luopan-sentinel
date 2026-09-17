<!-- TAG: 规则文档 | 用途: 罗盘哨兵运维SOP与执行流程 | 生成: 2026-05-10 -->
# 罗盘哨兵 — 工作流（WORKFLOW.md）

> 版本：v1.8 | 更新：2026-09-17

**v1.8变更** · 2026-09-17 · dv × Codex

变更内容：
- [修改] ASK JUNIOR 自动填表不再以 `是否在播=0` 拦截；按 dv 的确认，现有快照可直接写入，允许存在合理时间误差。
- [修复] 罗盘 `日期小时` 与 ASK 表的同名整点行对齐（如 `20` → `20:00`），避免写入尚未到时的未来行。

验收：对当前 `2026-09-17_20` 快照执行后，`20:00` 行 B:L 必须读回为非空数值。

---

**v1.7变更** · 2026-09-17 · dv × Codex

变更内容：
- [修改] 直播时段改为北京时间每天 **19:30 至次日 12:00**。
- [修改] 主罗盘采集在 `19:30 / 每小时:00`，大屏截图延后 15 分钟，消除两套 CloakBrowser 并发。
- [修改] 杭州表填表移到大屏截图完成后；首轮 `19:58`，后续每小时 `:28`。
- [修改] 乘方首轮移到 `19:55`，后续 `:45`，避开大屏截图窗口。
- [修改] 飞书群仅发送直播大屏专业版、基础版；千川截图仍本地归档，不发群。
- [修复] 自动填表的旧 `sheets +read/+write/+write-image` 全部迁移到 `+cells-get/+cells-set/+cells-set-image`，兼容 `lark-cli 1.0.96`。
- [新增] ASK JUNIOR 表使用 `auto_fill_ask_junior_sheet.js`，仅填写 B–L 数值指标；图片不入表。

解决的问题：
- 不在白天无直播时空跑采集与告警。
- 腾讯云只有 3.6GiB 内存，主罗盘与大屏并发会触发资源争抢；新时序确保浏览器任务错开。

---

**v1.6变更** · 2026-06-26 · dv × Claude

变更内容：
- [新增] 三节「自助方案：飞书菜单一键扫码」——机器人菜单「抖音扫码」→ 长连接监听器 `feishu_menu_listener.mjs` → 触发扫码，dv 失效时不用再找 Claude/SSH
- [新增] 监听器 60s 冷却防抖：频繁点/误点只触发一次（限制1）+ 进行中扫码不重复 spawn（限制2）
- [修改] `qr_login_cloak.mjs` 启动**只清 .tmp，不删生产 cookie/state**——扫码成功前采集/填表继续用旧 cookie，成功才原子 rename 覆盖

解决的问题：
- Cookie 刷新从"人肉中转(找Claude→SSH→跑脚本)"变为"飞书点一下"，dv 自助闭环
- 修复隐患：旧逻辑启动即删生产 cookie，扫码失败/误点会断掉采集与填表；现改为成功才覆盖，符合 CLAUDE.md 2.2

---

**v1.5变更** · 2026-06-26 · dv × Claude

变更内容：
- [迁移] 清洗层从 n8n webhook 迁出为独立脚本 `clean_live_data.js`（逻辑零改动，原 Code 节点 JS 直接搬出）
- [修改] cron 两条线 `curl .../webhook/live-data-clean` → `(node clean_live_data.js || echo "[CLEAN FAIL] ...")`，失败留可 grep 标记
- [停用] n8n 工作流 `5wha4FMrZzhOWyye` 已 active=false（保留定义作冷备份，未删除）
- [修改] 填表 cron 时段 `8 8-16` → `8 8-23,0,1`（8点到次日1点）

解决的问题：
- 故障点从「cron + n8n 容器 + webhook」三处收敛为「cron + node」两处，清洗失败直接进日志、exit code 可判，符合 Fail Fast
- 验证：迁移前 n8n 输出 vs 新脚本 dry-run diff 字节级一致（80字段），webhook 停用后返回 404 确认无残留依赖

---

**v1.4变更** · 2026-06-15 · dv × Claude

变更内容：
- [合并] 从服务器 docs/WORKFLOW.md 同步「八、直播大屏截图 SOP」(踩坑1-6) 到本地镜像，消除两份分叉
- [说明] 本地镜像此前缺截图SOP，服务器版缺Cookie v2.0细节，合并后内容统一

解决的问题：
- 本地七文档镜像与服务器 docs/ 不再分叉；截图SOP(含千川右侧列/STEP10/KPI标签PIL叠字修复)本地可查

---

**v1.3变更** · 2026-05-11 · dv × Claude

变更内容：
- [修复] `qr_login_cloak.mjs` 升至 v2.0：二维码从 API 拦截改为截图方案
- [修改] 三、Cookie 保活 SOP：更新原理说明、验证数据、预期文件大小

解决的问题：
- 根因：`open.douyin.com/qrconnect` React 应用在 iframe 中不渲染（`#root` 始终空，canvas: 0），直接导航作为顶层页面时正常渲染
- 旧方案截图 iframe canvas → 一直空白；新方案拦截 `oauth/get_qrcode` API 响应，`body.data.qrcode` 直接返回 base64 PNG
- 验证：2026-05-11 17:12，扫码成功，50 个 Cookie 写入，`fresh_cookies.json`=13KB，`state`=435KB

---

**v1.2变更** · 2026-05-11 · dv × Claude

变更内容：
- [修改] 一、四层架构"采集层"：标注已迁移至 CloakBrowser，移除 stealth-profile 描述
- [废弃] `stealth-profile.js` / `current_profile.json` / `qr_login_flow.js` 已从服务器删除
- [新增] 采集层架构说明：所有 Playwright 脚本统一使用 CloakBrowser `launch()` 引擎

解决的问题：
- `stealth-profile.js` JS 层注入存在检测窗口期，CloakBrowser 二进制层绕过取代
- 250 行维护负担消除，UA/指纹/locale/timezone 由 CloakBrowser 内核统一处理
- 验证：两脚本迁移后 exit 0，v3 Step7 APIs 全200，screen Screen=185/QC=65/Product=81

---

**v1.1变更** · 2026-05-11 · dv × Claude

变更内容：
- [新增] 三、Cookie 保活 SOP — CloakBrowser 优先版（`qr_login_cloak.mjs`）
- [修改] 三、原 `qr_login_flow.js` SOP 降级为备用方案，标注 [已废弃为主方案]
- [修复] 文档正文中的格式乱码（￼ 字符、重复架构图）全部清理

解决的问题：
- CloakBrowser 引擎（stealth Chromium）替换原生 headless，Cookie 存活时间预期提升
- 本次首跑已验证：CloakBrowser 检测到现有 Cookie 有效，自动写回 73 个 Cookie 无需扫码
- 本地 WORKFLOW.md 存在大量粘贴乱码，影响可读性

---

**v1.0变更** · 2026-05-10 · dv × Claude

变更内容：
- [新增] 初始版本 — 从 `luopan_agent_progress.md` 拆分建档

---

## 一、Cron 时序图

```
时间  :00          :05 :10 :15 :20 :25 :30          :35 :40 :45 :50 :55
      ├────────────┼───┼───┼───┼───┼───┼────────────┼───┼───┼───┼───┤
      │            │   │   │   │   │   │            │   │   │   │   │
 v3   ████████                             Playwright 深度采集
 scr  ████████████                         大屏+千川 Playwright
      │        ↓30s                        │
 n8n  │        █ webhook①                  │
 ext  │         █ extract_summary          │
      │                                    │
 rb   │                                    ████ route_b_pull
 ext  │                                        █ extract_summary
 n8n  │                                         █ webhook②(78字段)
      │                                    │
 qc   █     █     █     █     █     █     █     █     █     █     █
      5min  5min  5min  5min  5min  5min  5min  5min  5min  5min  5min
      │                 │                              │
 cc   █                 █                              █
      15min             15min                          15min
```

### 四层架构

```
┌─────────────────────────────────────────────────────┐
│ 层1：采集层                                           │
│   系统 cron → live_capture_v3.js (CloakBrowser) [v1.2迁移] │
│             → screen_capture.js  (CloakBrowser) [v1.2迁移] │
│   → /data/YYYY-MM-DD_HH.json  (原始 ~1MB)           │
└─────────────────────┬───────────────────────────────┘
                      │
┌─────────────────────▼───────────────────────────────┐
│ 层2：清洗层（node 脚本 clean_live_data.js）[v1.5迁移]│
│   读归档 + screen_summary → 合并 78 字段              │
│   → live_clean.json (唯一主输出, ~2KB)               │
└─────────────────────┬───────────────────────────────┘
                      │
┌─────────────────────▼───────────────────────────────┐
│ 层3：记录层（Memoh Bot / 飞书 Bitable）               │
│   读 live_clean.json → 写飞书多维表格（每小时 upsert）│
│   → 历史数据全部落表                                  │
└─────────────────────┬───────────────────────────────┘
                      │
┌─────────────────────▼───────────────────────────────┐
│ 层4：查询层（Memoh Bot / AI）                         │
│   用户飞书问 → bot 读飞书表 → AI 分析 → 回复          │
└─────────────────────────────────────────────────────┘
```

### 完整 Crontab

```bash
# 北京时间每天 19:30 开播，次日 12:00 下播；主罗盘与大屏浏览器任务必须错开 15 分钟。
# 主罗盘归档 → node 清洗：首轮 19:30，之后整点至次日 12:00。
30 19 * * * cd /opt/douyin-fetcher && (node live_capture_v3.js || (echo "[RETRY] 5min后重试" >> /tmp/luopan_cron.log && sleep 300 && node live_capture_v3.js)) >> /tmp/luopan_cron.log 2>&1 && sleep 30 && (node clean_live_data.js || echo "[CLEAN FAIL] $(TZ=Asia/Shanghai date)" >> /tmp/luopan_cron.log)
0 20-23,0-12 * * * cd /opt/douyin-fetcher && (node live_capture_v3.js || (echo "[RETRY] 5min后重试" >> /tmp/luopan_cron.log && sleep 300 && node live_capture_v3.js)) >> /tmp/luopan_cron.log 2>&1 && sleep 30 && (node clean_live_data.js || echo "[CLEAN FAIL] $(TZ=Asia/Shanghai date)" >> /tmp/luopan_cron.log)

# 大屏截图：首轮 19:45，之后 :15 至次日 11:15；完成后自动发图到飞书群。
45 19 * * * cd /opt/douyin-fetcher && (node screen_capture.js || (echo "[SCREEN RETRY]" >> /tmp/screen_cron.log && sleep 300 && node screen_capture.js --retry)) >> /tmp/screen_cron.log 2>&1 && node extract_screen_summary.js >> /tmp/screen_cron.log 2>&1
15 20-23,0-11 * * * cd /opt/douyin-fetcher && (node screen_capture.js || (echo "[SCREEN RETRY]" >> /tmp/screen_cron.log && sleep 300 && node screen_capture.js --retry)) >> /tmp/screen_cron.log 2>&1 && node extract_screen_summary.js >> /tmp/screen_cron.log 2>&1

# 快检：首轮 19:35，之后每 5 分钟至次日 12:00。
35-59/5 19 * * * /bin/bash -c "sleep $((RANDOM % 60)) && flock -xn /tmp/quick_check.lock node /opt/douyin-fetcher/quick_check.js" >> /tmp/quick_check.log 2>&1
*/5 20-23,0-11 * * * /bin/bash -c "sleep $((RANDOM % 60)) && flock -xn /tmp/quick_check.lock node /opt/douyin-fetcher/quick_check.js" >> /tmp/quick_check.log 2>&1
0 12 * * * /bin/bash -c "sleep $((RANDOM % 60)) && flock -xn /tmp/quick_check.lock node /opt/douyin-fetcher/quick_check.js" >> /tmp/quick_check.log 2>&1

# 素材告警：首轮 19:45，之后每 15 分钟至次日 12:00。
45 19 * * * flock -xn /tmp/creative_check.lock node /opt/douyin-fetcher/creative_check.js >> /tmp/creative_check.log 2>&1
*/15 20-23,0-11 * * * flock -xn /tmp/creative_check.lock node /opt/douyin-fetcher/creative_check.js >> /tmp/creative_check.log 2>&1
0 12 * * * flock -xn /tmp/creative_check.lock node /opt/douyin-fetcher/creative_check.js >> /tmp/creative_check.log 2>&1

# Route B：每小时 :30，首轮 19:30，末轮次日 11:30。
30 19-23,0-11 * * * cd /opt/douyin-fetcher && flock -xn /tmp/route_b_pull.lock node route_b_pull.js >> /tmp/route_b_pull.log 2>&1 && node extract_screen_summary.js >> /tmp/route_b_pull.log 2>&1 && (node clean_live_data.js || echo "[CLEAN FAIL] $(TZ=Asia/Shanghai date)" >> /tmp/route_b_pull.log 2>&1) && sleep 10 && node hourly_report.js >> /tmp/hourly_report.log 2>&1

# 乘方：首轮 19:55，之后每小时 :45，避开大屏截图。
55 19 * * * cd /opt/douyin-fetcher && flock -xn /tmp/promover.lock node promover_capture.js >> /tmp/promover_cron.log 2>&1 && node extract_promover_summary.js >> /tmp/promover_cron.log 2>&1
45 20-23,0-11 * * * cd /opt/douyin-fetcher && flock -xn /tmp/promover.lock node promover_capture.js >> /tmp/promover_cron.log 2>&1 && node extract_promover_summary.js >> /tmp/promover_cron.log 2>&1

# ASK JUNIOR 表：大屏截图完成后再写，首轮 19:58，后续 :28。
58 19 * * * cd /opt/douyin-fetcher && flock -xn /tmp/autofill.lock node auto_fill_ask_junior_sheet.js >> /tmp/autofill.log 2>&1
28 20-23,0-11 * * * cd /opt/douyin-fetcher && flock -xn /tmp/autofill.lock node auto_fill_ask_junior_sheet.js >> /tmp/autofill.log 2>&1
```

---

## 二、数据更新节奏

| 时刻 | 事件 | live_clean.json 字段数 |
|---|---|---|
| 19:30 / 每小时 :00 | `live_capture_v3` → `clean_live_data` | 主罗盘基础字段 |
| 19:45 / 每小时 :15 | `screen_capture` → `extract_screen_summary` → 飞书三图 | 大屏 / 千川截图与字段 |
| 每小时 :28 | `auto_fill_ask_junior_sheet` | 允许当前快照直接写 ASK JUNIOR 表 |
| 每小时 :30 | `route_b_pull` → extract → 二次清洗 → 小时报告 | **完整字段** |

---

## 三、Cookie 保活 SOP

### [v1.6新增] 自助方案：飞书菜单一键扫码（dv 日常首选）

> Cookie 失效时无需找 Claude / SSH，直接在飞书机器人「数据分析助手」私聊菜单点 **「抖音扫码」** 即可。
> 监听器：`/opt/douyin-fetcher/feishu_menu_listener.mjs`（PM2 进程 `feishu-menu`，长连接订阅 `application.bot.menu_v6`）

**dv 操作（手机/电脑飞书均可）：**
1. 打开机器人「数据分析助手」私聊 → 点底部菜单 **「抖音扫码」**
2. 群里先收到 `📡 收到刷新请求，正在启动扫码…`，约 10s 后收到二维码图
3. 手机抖音 APP 扫码 → 等群里出现 `✅ 扫码成功，Cookie 已安全更新`
4. 若登录态仍有效，直接收到 `✅ Cookie 已刷新（已登录，无需扫码）`

**两道保护（不会误伤采集）：**
- **60s 冷却**：频繁点/误点 → 回 `⏳ 操作太频繁，请 N 秒后再点`，60s 内只触发一次
- **进行中跳过**：扫码进行中重复点 → 回 `⏳ 已有扫码进行中`，不打断当前二维码
- **cookie 安全**：扫码成功前**绝不删旧 cookie**，采集/填表照常跑；只有扫码成功才原子覆盖

**运维命令（排查时用）：**
```bash
pm2 list | grep feishu-menu          # 进程在线
pm2 logs feishu-menu --lines 30      # 看 [MATCH]/[SPAWN]/[SKIP]/[COOLDOWN]
tail -f /tmp/qr_login_trigger.log    # 看 spawn 出来的扫码脚本进度
```
本质：菜单点击 → 飞书推 `application.bot.menu_v6`(`event_key=refresh_douyin_cookie`) → 监听器匹配(已 `.trim()` 容错前后空格) → 冷却/进行中校验通过 → spawn 下方主方案脚本。自助方案只是给主方案加了飞书触发入口，扫码逻辑完全复用。

---

### [v1.1新增] 主方案：CloakBrowser（推荐）

> CloakBrowser 是 C++ 源码级 stealth Chromium，通过 bot 检测能力更强，Cookie 存活时间预期更长。
> 脚本：`/opt/douyin-fetcher/qr_login_cloak.mjs`（v2.0）

```bash
# 1. 杀掉残留旧实例
pkill -f qr_login; echo ok

# 2. 运行（若已登录则自动保存 Cookie；若失效则飞书发二维码图片）
cd /opt/douyin-fetcher && nohup node qr_login_cloak.mjs > /tmp/qr_cloak.log 2>&1 &

# 3. 查看进度
tail -f /tmp/qr_cloak.log
# 若已登录：飞书收到 "✅ Cookie 已刷新（已登录，无需扫码）"
# 若需扫码：飞书收到二维码图片 → 手机抖音APP扫码 → 自动保存

# 4. 验证
ls -lah /opt/douyin-fetcher/full_storage_state.json /opt/douyin-fetcher/fresh_cookies.json
# 预期：时间戳刷新，fresh_cookies.json ~13KB，state ~435KB
```

**CloakBrowser 关键信息：**
- 二进制：`/root/.cloakbrowser/chromium-146.0.7680.177.3/chrome`（697MB，已安装）
- npm 包：`/opt/douyin-fetcher/node_modules/cloakbrowser/`（v0.3.27）
- 日志：`/tmp/qr_cloak.log`
- 2026-05-11 验证（v2.0）：扫码成功，写回 50 个 Cookie，`fresh_cookies.json`=13KB，`state`=435KB

**[v1.3修改] v2.0 技术原理（二维码为什么之前截不到）：**

~~旧方案（v1.x）：截 iframe 内 canvas~~ [已废弃，见v1.3]

`open.douyin.com/qrconnect` 是 React SPA，当作 iframe 加载时 `#root` 始终为空（`canvas: 0`）——SDK 等待父页面 `postMessage` 初始化，自动化上下文中该消息从未发出，React 不挂载。

**[v1.3新增] 新方案（v2.0）：直接导航 + API 拦截**
1. 先加载 `buyin.jinritemai.com/mpa/account/login` 拦截 iframe 完整 URL（含所有参数）
2. 用新 page 直接导航到该 URL（顶层页面，非 iframe）→ React 正常渲染
3. 拦截 `oauth/get_qrcode` 响应，`body.data.qrcode` 即 base64 PNG，直接写入发飞书
4. 扫码后页面重定向到 `buyin.jinritemai.com/dashboard` → 保存 Cookie

---

### ~~备用方案：原生 Playwright（qr_login_flow.js）~~ [已废弃为主方案，v1.1]

> 仅在 CloakBrowser 异常时使用。

```bash
pkill -f qr_login_flow
cd /opt/douyin-fetcher && node qr_login_flow.js
# 飞书收到二维码 → 手机扫码 → 自动保存
ls -la full_storage_state.json fresh_cookies.json
```

**关键机制：**
- `getProfile(false)` — 不删旧 cookie，保护正在运行的 cron
- 扫码成功 → 先写 `.tmp` → `fs.renameSync` 原子替换
- 失败 → catch 清理 `.tmp`，不动生产文件

---

## 四、n8n 工作流修改 SOP

> **[v1.5 说明]** 清洗管线（`5wha4FMrZzhOWyye`）已迁出为独立脚本 `clean_live_data.js`，**不再走 n8n**——清洗逻辑改动直接编辑该脚本即可，无需停机操作 SQLite。
> 下面这套停机改 SQLite 的 SOP 仅对 n8n 里**其余仍在用的工作流**（抖音下载转 wav、文案钩子提炼等）有效，示例中的 `WF_ID/VER_ID` 需替换为目标工作流。

```bash
# ⚠️ 必须停机操作，禁止在线 PATCH REST API

# 1. 停 n8n
docker stop n8n

# 2. 删 WAL（n8n 已停，安全）
rm -f /var/lib/docker/volumes/n8n_data/_data/database.sqlite-wal
rm -f /var/lib/docker/volumes/n8n_data/_data/database.sqlite-shm

# 3. 修改 SQLite（必须同时更新两张表）
python3 <<'EOF'
import sqlite3, json
DB = '/var/lib/docker/volumes/n8n_data/_data/database.sqlite'
WF_ID = '5wha4FMrZzhOWyye'
VER_ID = 'eac21094-b52e-41d6-8a05-702a5bc6908a'

conn = sqlite3.connect(DB)
row = conn.execute("SELECT nodes FROM workflow_entity WHERE id=?", (WF_ID,)).fetchone()
nodes = json.loads(row[0])

# === 在这里修改 nodes ===
# code_node = [n for n in nodes if n['type'] == 'n8n-nodes-base.code'][0]
# code_node['parameters']['jsCode'] = '...'

new_nodes = json.dumps(nodes)
conn.execute("UPDATE workflow_entity SET nodes=? WHERE id=?", (new_nodes, WF_ID))
conn.execute("UPDATE workflow_history SET nodes=? WHERE workflowId=? AND versionId=?",
             (new_nodes, WF_ID, VER_ID))
conn.commit()
conn.close()
EOF

# 4. 启动 n8n
docker start n8n

# 5. 验证
curl -s -X POST http://localhost:5678/webhook/live-data-clean
```

---

## 五、快检预警规则

### 飞书消息格式（仅预警时发送）

```
🔔 罗盘哨兵 2026-05-10 17:15 BJT
5min  GMV +¥89
观看  +49
订单  +1
涨粉  +0

🌊 进人流速下滑 10%
📉 GMV 环比下滑 82%
```

### 预警阈值

| 指标 | 阈值 | 信号 |
|---|---|---|
| 流速下滑 | >60% | 🌊 进人流速下滑 |
| 流速飙升 | >80% | 🚀 流速飙升 |
| GPM 下滑 | >70% | 📉 GPM 下滑 |
| UV 价值下滑 | >70% | 📉 UV 价值下滑 |
| 连续无出单 | ≥3 周期（15分钟） | ⚠️ 连续无出单 |
| 出单量下滑 | >20% | 📉 出单下滑 |
| 出单量飙升 | >50% | 🚀 出单爆增 |

---

## 六、素材告警规则

| 事件 | 飞书告警 |
|---|---|
| 新素材进入"追投中" | 🚀 新素材起量（消耗/GMV/ROI + 趋势） |
| "追投中"素材变"已暂停" | ⏸️ 追投素材已暂停 |
| 无变化 | 静默（控制台打印 Top3） |

状态持久化：`data/creative_status.json`（key=material_id）

---

## 七、日志查看命令

```bash
# 主采集日志
tail -50 /tmp/luopan_cron.log

# 大屏采集日志
tail -50 /tmp/screen_cron.log

# 5分钟快检日志
tail -50 /tmp/quick_check.log

# 素材告警日志
tail -50 /tmp/creative_check.log

# Route B 日志
tail -50 /tmp/route_b_pull.log

# CloakBrowser 扫码日志 [v1.1新增]
cat /tmp/qr_cloak.log

# 查看最新清洗结果
node -e "const d=require('/opt/douyin-fetcher/data/live_clean.json'); console.log('fields:', Object.keys(d).length); console.log('GMV:', d.GMV, 'qc_cost:', d.qc_cost)"
```

---

## 八、直播大屏截图 SOP [v1.2新增]

> 脚本：`screen_capture.js`（每小时 `:00` cron 自动跑）
> 截图三张：直播大屏专业版 + 直播大屏基础版 + 巨量千川，跑完自动发飞书群

### 截图产出

| 截图 | 文件 | 来源页面 |
|---|---|---|
| 📊 专业版 | `/tmp/sc_pro.png` | Step7 大屏主页（默认就是专业版） |
| 📺 基础版 | `/tmp/sc_basic.png` | 点「专业版▼」下拉 → 基础版卡片 → **新 tab** |
| 💰 千川 | `/tmp/sc_qc.png` | Step12 全域支付数据看板 |

### 飞书发图命令（铁律）

```bash
# ❌ 错误：lark-cli 不接受绝对路径
lark-cli im +messages-send --chat-id XXX --image /tmp/sc_pro.png --as bot
#   → validation error: --file must be a relative path

# ✅ 正确：必须 cd 到目录 + 相对路径
cd /tmp && lark-cli im +messages-send --chat-id XXX --image ./sc_pro.png --as bot
```

代码里 `larkSendImage()` 已封装：自动 `path.dirname` + `cd` + 相对路径。

### 踩坑1：基础版在「新 tab」打开（非同页跳转）

- 点顶部「专业版▼」下拉触发器（`offsetTop < 80` 的 header 区域元素）
- 下拉浮层里有 3 张卡片：专业版 / 基础版 / 主播版
- 点「基础版」**文字节点会失效**，要向上找卡片父容器（256×272px）用 `mouse.click(中心坐标)`
- 点击后基础版在**新标签页**打开：`context.waitForEvent('page')` 捕获
- 基础版 URL：`compass.jinritemai.com/screen/talent/main?live_room_id=XXX&source=compass_inner`
- 专业版 URL：`compass.jinritemai.com/screen/live/talent/live_room_id=XXX`（注意是路径不是查询参数）

### 踩坑2：千川黄色公告条 = Tippy.js 浮层（点击关不掉）

- 黄色「服务费/公告」浮窗是 Tippy.js 组件，DOM 类名 `tippy-box` / `tippy-content` / `[data-tippy-root]`
- 关闭按钮 `.alert-close` 是空 DIV（CSS 伪元素图标），`.click()` 无效
- **正解：CSS 注入 `display:none!important` 强制隐藏**，截图后再移除还原：

```javascript
await qcPage.evaluate(() => {
  const style = document.createElement('style');
  style.id = '__hide_overlays__';
  style.textContent = [
    '[data-tippy-root]', '.tippy-box', '.tippy-content', '.tippy-popper',
    '.notice-box', '.ovui-alert', '.alert-box', '[class*="guide-mask"]',
    // ⚠️ v1.3移除 custom-text-tooltip/tooltip-wrapper/ant-tooltip/ant-popover
    //    —— 它们会连带隐藏 KPI 标签(见踩坑6)，只保留 tippy 公告条选择器
  ].join(',') + '{ display:none!important; visibility:hidden!important; }';
  document.head.appendChild(style);
});
// 截图后移除：document.getElementById('__hide_overlays__').remove()
```

- ⚠️ 禁止用「坐标盲点」关浮窗——会误触发「自定义列」弹窗等其他 UI

### 踩坑3：图表渲染慢，截图前必须停足

- 折线图/环形图/漏斗数字是懒加载，等待不够会截到空图
- 千川截图等待链路：`图表渲染 5-7s → dismissGuides + Escape → 0.6s → CSS隐藏浮层 → 0.4s → 额外停 2s → 截图`
- 专业版/基础版同样需 `dismissGuides()` 点掉「知道了」引导气泡

### 踩坑4：千川看板右侧列被截掉 [v1.3]

- `newContext` 默认视口 1280px，千川看板右侧列（渠道构成/核心漏斗/实时评论）在 1280 外被切
- **正解：进千川看板 KPI 渲染前**，给 qcPage 设视口 `setViewportSize({width:1440, height:900})`
- ⚠️ 必须在「点全域支付数据」**之前**设，不能截图前临时改——临时 resize 会让组件 mid-render 测量出错
- 内容实测固定 1440 宽，非响应式；设 1920 不会变宽只会留白

### 踩坑5：进千川点歪到 #crowd（人群）而非 #ad（千川） [v1.3]

- 旧代码 `jsClickByText(screenPage, '千川')` 模糊匹配，命中页面内容里其他「千川」文字 → 落到 `#crowd`
- **正解：精确点左侧导航栏** `a[href*="#ad"]`，fallback 找 nav 区内文字严格等于「千川」的叶子节点
- 验证：STEP10 日志 URL 应含 `#ad`

### 踩坑6：千川 KPI 标签 Vue 组件自动化下不渲染 [v1.3]

- 顶部 KPI 标签（整体消耗/GPM/净成交金额…）用 Vue `oc-popover` tooltip 组件渲染
- **自动化浏览器(CloakBrowser)下组件不把标签从「隐藏测量态」切回「可见态」**：文字锁在 `<span class="custom-text-tooltip-reference width-desc" style="display:none!important">` 里
- 试过全部失败：放宽视口 / 收窄CSS / 移除resize / CSS强制显示(inline !important压不过) / JS覆盖inline / 真人点击路径 / 等待+rAF —— 组件就是不渲染可见标签
- **正解：绕过组件，DOM读真实坐标+文字 → 截图后 PIL 叠字**

```javascript
// 截图前：查 .card-item 坐标 + .width-desc 标签文字，存 JSON
const metricData = await qcPage.evaluate(() =>
  Array.from(document.querySelectorAll('.card-item')).map(el => {
    const r = el.getBoundingClientRect();
    const span = el.querySelector('.width-desc');
    return { label: span?span.textContent.trim():'', x:Math.round(r.left), y:Math.round(r.top), w:Math.round(r.width), h:Math.round(r.height) };
  }).filter(i => i.label && i.w>5 && i.h>5));
require('fs').writeFileSync('/tmp/qc_metric_pos.json', JSON.stringify(metricData));
// 截图后：execSync 调 overlay_qc_labels.py 叠字（标签放卡片正上方留白区，字号15+深色描边）
```

- 脚本：`/opt/douyin-fetcher/overlay_qc_labels.py`（依赖 pillow：`pip3 install pillow --break-system-packages`）
- 关键：坐标从 DOM 实时读，**不硬编码**，布局变了标签位置自动跟随；标签 y = 卡片顶 - 文字高 - 2，不压数字

### 引导弹窗通用清理 `dismissGuides()`

- 文字关键词：`知道了 / 我知道了 / 好的 / 关闭 / 跳过`
- × 符号：`× ✕ ✖ ✗`
- close 类选择器：`.alert-close / .ant-modal-close / .anticon-close / [aria-label=close]`
- 先按一次 `Escape`，循环点击最多 5 轮，最后再 `Escape` 兜底

### 验收命令

```bash
cd /opt/douyin-fetcher && node screen_capture.js
# 预期日志：
#   [7] Screenshot: 专业版 saved
#   [7] Screenshot: 基础版 saved from new tab ...
#   [12] metric positions: 10 items, sample: 整体消耗(元)
#   [12] Screenshot: 千川 saved
#   [12] PIL label overlay done
#   [SHOT] Sent 3 screenshots to Feishu
```

---

## 九、Changelog

| 日期 | 变更 |
|---|---|
| 2026-06-15 | v1.4 — [合并] 同步服务器截图SOP(八,踩坑1-6：三图发飞书+千川右侧列/STEP10/KPI标签PIL叠字)到本地镜像 |
| 2026-05-11 | v1.3 — [修复] qr_login_cloak.mjs v2.0，API 拦截替代 iframe canvas 截图 |
| 2026-05-11 | v1.2 — [修改] 采集层全迁移 CloakBrowser，[废弃] stealth-profile.js / qr_login_flow.js |
| 2026-05-11 | v1.1 — [新增] CloakBrowser Cookie SOP，[修复] 格式乱码 |
| 2026-05-10 | v1.0 — 从 `luopan_agent_progress.md` 拆分建档 |
