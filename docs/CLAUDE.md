<!-- TAG: 规则文档 | 用途: 罗盘哨兵项目规则与开发红线 | 生成: 2026-05-10 -->
# 罗盘哨兵 — 项目规则（CLAUDE.md）

> 版本：v1.2 | 更新：2026-06-15
>
> v1.1 (2026-05-10) [新增] 2.3 指纹策略铁律、2.4 风险评估决策、编号重排

---

## 一、服务器信息

| 项目 | 值 |
|---|---|
| IP | 118.25.83.180 |
| 用户 | root |
| 抓取工作目录 | `/opt/douyin-fetcher` |
| 数据归档目录 | `/opt/douyin-fetcher/data/` |
| n8n 地址 | `http://127.0.0.1:5678` |
| 文档目录 | `/opt/douyin-fetcher/docs/` |

---

## 二、开发红线（Hard Rules）

### 2.1 n8n 修改铁律
- **永远不改 `activeVersionId`**，只改 nodes 内容
- **修改 workflow 必须停机操作 SQLite**：`docker stop n8n` → 删 WAL/SHM → UPDATE `workflow_entity` + `workflow_history` 两张表 → `docker start n8n`
- REST API PATCH 只更新 `workflow_entity`，执行时读 `workflow_history`，两者不同步 = 形同虚设
- 在线复制 SQLite 主文件不含 WAL → 重启后 `SQLITE_CORRUPT`

### 2.2 Cookie / Session 铁律
- `storageState` 每次成功后**必须写回磁盘**（正常路径 + FATAL 路径）
- Cookie 失效路径**故意不保存**（token 已无效）
- `qr_login_flow.js` 用 `getProfile(false)`，**启动不删旧 cookie**
- 扫码成功后 `.tmp` 原子替换生产文件（`fs.renameSync`）
- 启动前 `pkill -f qr_login_flow` 防多实例

### 2.3 指纹策略铁律 [v1.1新增]
- **指纹只在扫码登录时生成一次**（`getProfile(true)`），之后所有采集复用 `current_profile.json`（`getProfile(false)`）
- 同 IP + 频繁换指纹 = 群控特征，风险比不换更高
- 不注入 Canvas/WebGL 伪指纹（商家账号有历史指纹档案，注入假值反而触发异常）
- 不切换 User-Agent（有真实 storageState 历史，换 UA 是异常信号）

### 2.4 风险评估决策 [v1.1新增]

当前选择**方案 C**（服务器直跑，接受 cookie 每 1-3 天手动扫码刷新）：

| 风险点 | 评估 | 说明 |
|---|---|---|
| 直播间被限流 | ✅ 排除 | 推流/限流走 CDN 层，compass 走数据仓库层，系统完全隔离 |
| 账号被识别异常 | ⚠️ 中等可控 | 风险点是登录 IP（数据中心）+ headless 设备，不是读数据本身 |
| 账号被封 | ✅ 极低 | 用自己账号读自己数据，不涉及刷量/作弊 |

备选方案（未来可切换）：
- **方案 A**：Windows 本地跑 Playwright → 家庭宽带 IP，cookie 寿命恢复 2-3 天
- **方案 B**：服务器加住宅代理（residential proxy），月费 ¥50-200

### 2.5 采集铁律
- 三个脚本共用 `full_storage_state.json` 和 `fresh_cookies.json`，输出文件名必须不冲突
- 凌晨 1 点 timeout 是正常现象（主播下播），必须保留重试逻辑
- Cron 跳过凌晨 2-7 点
- 所有 `waitForTimeout` 必须用随机区间（`rnd(min, max)`），禁止固定值
- 直接构造 URL 绕过 React session 初始化 → API 返回 621000601，必须通过按钮点击进入

### 2.6 飞书 Bitable 铁律
- 飞书文档 URL 中的 token ≠ Bitable `app_token`，需通过 wiki node API 获取真实 `obj_token`
- 每小时表时间字段：开始时间 = 上次捕获时刻，结束时间 = 本次捕获时刻（精确到分钟，非整点）
- 退款字段必须写两端累计值，否则净 GMV 公式算错

### 2.7 Route B 铁律
- Cookies 从 `full_storage_state.json` 读，过滤 `domain.includes('jinritemai')`
- URL 去掉 `msToken` 和 `a_bogus` 参数（动态签名，去掉后仍可用）
- Route B 依赖 `screen_clean.json` 中的 POST body 模板，`screen_capture.js` 必须先跑过一次

---

## 三、命名规范

| 类型 | 规范 | 示例 |
|---|---|---|
| 归档 JSON | `YYYY-MM-DD_HH.json` | `2026-05-10_17.json` |
| 大屏归档 | `screen_YYYY-MM-DD_HH.json` | `screen_2026-05-10_17.json` |
| 快照 | `data/snapshots/HH-MM.json`（北京时间） | `17-05.json` |
| 备份 | `*.bak.YYYYMMDDHHmm` | `live_capture_v3.js.bak.202605090144` |

---

## 四、飞书集成信息

| 项目 | 值 |
|---|---|
| app_token | `ArjAbDoyoaqoNWs1ogkcvOS2nlb` |
| wiki node | `X4bqwHf6cieA8uktE9pcKgcvnYd` |
| 场次表 table_id | `tbl4M9bO67eFdw1K` |
| 每小时表 table_id | `tblnm0ENiM2ZtPF1` |
| Memoh bot ID | `ed5e3179-8ccd-4a34-96d8-08da4ec7a86a` |
| n8n 工作流 ID | `5wha4FMrZzhOWyye` |
| n8n activeVersionId | `eac21094-b52e-41d6-8a05-702a5bc6908a` |

---

## 4b、杭州业绩表自动填表 [v1.2新增 2026-06-15]

| 项目 | 值 |
|---|---|
| 飞书 Sheet | 2026杭州6月业绩 |
| spreadsheet token | `PsAbsD9YNhVlowtmVZHcfXu9nIg` |
| sheet_id | `0UqBfV` |
| 填表脚本 | `/opt/douyin-fetcher/auto_fill_hangzhou_sheet.js`（本地 lark-cli，identity=bot） |
| cron | `:08` 触发，**仅 20,21,22,23,0,1 点共6小时**（主播20点-凌晨1点下播）|

**列映射**：K整体成交=`qc_overall_gmv` / L整体消耗=`qc_overall_cost` / M直播间成交=`screen_GMV`÷100 / N最高在线 / O平均在线 / P件单价=`screen_GMV÷screen_pay_combo_cnt`(成交件数真公式，件数缺时回退客单价) / Q图1=sc_pro / R图2=sc_basic / S千川图=sc_qc

**行匹配铁律**：每行存「下播时间」那刻的累计值（证据：第29行下播19:00整体消耗=罗盘19:00千川消耗）→ 目标行=下播整点==`live_clean.日期小时`的captureHour，命中唯一行才写，0或多行→飞书报警不写。仅captureHour≤1才纳入前一天(24:00续场)。

**千川整体成交字段**：`total_pay_order_gmv_include_coupon_realtime_for_roi2`（整体成交）、`stat_cost_for_roi2`（整体消耗），取自 screen_clean.json qianchuan_apis 中 `url含reqFrom=commonMetricCard` 的 StatsData.Totals（≠ qc_GMV_settle 千川结算）。extract_screen_summary.js 已提取为 `qc_overall_gmv/cost`。

**业绩数据铁律：禁止视觉读图填数** —— 业绩表所有数字必须程序提取（视觉读数有看错风险+与程序数据不同源不同刻）。截图仅作证据贴入 Q/R/S。

**n8n 全量透传**：合并节点 `Object.assign({}, clean, summaryExtra)`，给 screen_summary 加字段会自动进 live_clean.json，无需改 n8n。

---

## 五、Changelog

| 日期 | 变更 |
|---|---|
| 2026-06-15 | v1.2 — [新增] 4b 杭州业绩表自动填表（auto_fill_hangzhou_sheet.js + :08 cron）+ 业绩数据禁视觉读图铁律 |
| 2026-05-10 | v1.1 — [新增] 2.3 指纹策略铁律、2.4 风险评估决策 |
| 2026-05-10 | v1.0 — 从 `luopan_agent_progress.md` 拆分建档 |
