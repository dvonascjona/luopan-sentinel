<!-- TAG: 规则文档 | 用途: 罗盘哨兵项目规则与开发红线 | 生成: 2026-05-10 -->
# 罗盘哨兵 — 项目规则（CLAUDE.md）

> 版本：v1.5 | 更新：2026-06-26
>
> v1.5 (2026-06-26) [新增] 群配置单一数据源 feishu_config.cjs（换群只改一处）；通知群切到 oc_5391…；2.9 加共享配置铁律
> v1.4 (2026-06-26) [新增] 2.9 飞书菜单触发铁律（长连接监听+60s冷却+扫码成功才覆盖cookie），四节加监听脚本/事件ID
> v1.3 (2026-06-26) [修改] 清洗层由 n8n 迁出为 node 脚本 clean_live_data.js，2.8/四节相关描述同步
> v1.2 (2026-05-12) [新增] 2.8 AI 职责边界铁律
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

### 2.8 AI 职责边界铁律 [v1.2新增]
- **AI 不参与数据采集**：爬取、点击、等待、存档全部由固定脚本完成，禁止让 AI 实时操作浏览器做采集
- **AI 不参与清洗逻辑**：字段提取、格式转换由 node 脚本 `clean_live_data.js` 完成（v1.3 从 n8n Code 节点迁出），确定性优先
- **AI 只做分析输出**：接收清洗后的结构化数据（live_clean.json / promover_summary.json），输出人可直接决策的洞察
- **理由**：AI 操作浏览器 token 消耗数量级高于脚本；AI 输出有随机性，采集层需要 100% 可重跑；脚本报错有 stack trace，AI 操作出错无法溯源
- **AI 可以介入的唯一例外**：新平台探索阶段（看截图找 API 位置），探索完成后立即固化为脚本，AI 退出采集流程

### 2.9 飞书菜单触发铁律 [v1.4新增]
- **接收方式只用长连接**：lark-cli v1.0.24 不支持 `application.bot.menu_v6`，必须用 `@larksuiteoapi/node-sdk` 的 `WSClient` 自起长连接（出站连接，**不开 iptables 端口**）。飞书后台「事件与回调」订阅方式必须选「长连接」，不能选请求地址
- **event_key 匹配必须 `.trim()`**：后台填的自定义事件 ID 可能带前后空格，匹配前先 trim（实测踩过）
- **触发前两道闸，缺一不可**：① 60s 冷却防抖（频繁/误点只触发一次，也兜 spawn 后 pgrep 未可见的连点竞态）；② 进行中扫码绝不 kill（`pgrep -f` 用方括号 `[q]r_login_cloak` 防自匹配，否则永远误判"已在跑"）
- **扫码与有效 cookie 隔离**：`qr_login_cloak.mjs` 启动**只清 .tmp，绝不删生产 `full_storage_state.json`/`fresh_cookies.json`**；扫码成功才 `renameSync` 原子覆盖。扫码失败/超时/误点 → 旧 cookie 原样保留，采集与填表不受影响（与 2.2 一致）
- **凭证存放**：App Secret 在 root-only `/opt/douyin-fetcher/.feishu_menu.env`(chmod 600, gitignore)，不入文档仓库；lark-cli 把 secret 存 keyring，配置文件里只有 `{source,id}` 引用，取不到明文
- **常驻**：PM2 进程名 `feishu-menu`，`pm2 save` 持久化
- **群配置单一数据源 [v1.5]**：所有发消息脚本（9个）的 `CHAT_ID` 统一来自 `/opt/douyin-fetcher/feishu_config.cjs`（`module.exports`，.js 用 `require`、.mjs 用 `import config from "./feishu_config.cjs"`）。**换群只改这一处**，禁止再在脚本里硬编码 chat_id。改后：cron 脚本下次定点自动生效，`feishu-menu` 需 `pm2 restart`

---

## 三、命名规范

| 类型 | 规范 | 示例 |
|---|---|---|
| 归档 JSON | `YYYY-MM-DD_HH.json` | `2026-05-10_17.json` |
| 大屏归档 | `screen_YYYY-MM-DD_HH.json` | `screen_2026-05-10_17.json` |
| 快照 | `data/snapshots/YYYY-MM-DD/HH-MM.json`（北京时间） | `2026-09-17/21-30.json` |
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
| 菜单自定义事件 ID | `refresh_douyin_cookie` |
| 菜单监听脚本 | `/opt/douyin-fetcher/feishu_menu_listener.mjs`（PM2: `feishu-menu`） |
| Secret 文件 | `/opt/douyin-fetcher/.feishu_menu.env`（600, gitignore） |

---

## 五、Changelog

| 日期 | 变更 |
|---|---|
| 2026-06-26 | v1.4 — [新增] 2.9 飞书菜单触发铁律；四节加监听脚本/事件ID/Secret文件 |
| 2026-06-26 | v1.3 — [修改] 清洗层 n8n→node 脚本 `clean_live_data.js`，2.8/四节描述同步 |
| 2026-05-12 | v1.2 — [新增] 2.8 AI 职责边界铁律 |
| 2026-05-10 | v1.1 — [新增] 2.3 指纹策略铁律、2.4 风险评估决策 |
| 2026-05-10 | v1.0 — 从 `luopan_agent_progress.md` 拆分建档 |
