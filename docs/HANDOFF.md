<!-- TAG: 进度跟踪 | 用途: 罗盘哨兵跨会话交接索引（Claude优先读此文件，替代SSH读服务器） | 生成: 2026-05-12 -->
# 罗盘哨兵 — 跨会话交接（HANDOFF.md）

> 更新：2026-09-17（ASK JUNIOR 自动填表已修复并回填） | 本文件是入口，详细规则看同目录其他文档

> 2026-09-17 补充：5 分钟 cron 的 `%` 截断问题已修复；快照存储升级为 `data/snapshots/YYYY-MM-DD/HH-MM.json`，`quick_check.js` 在线趋势与 `hourly_report.js` 均只读取目标日期目录。

---

## 一、快速定位

| 需要什么 | 读哪里 |
|---|---|
| 红线/规则/铁律 | `CLAUDE.md`（本目录） |
| 系统架构/数据流 | `ARCHITECTURE.md`（本目录）← v1.2已更新四数据源全景 |
| 步骤进度/P0-P5 | `STEPS.md`（本目录）← v1.4已更新 |
| Cron/SOP/日志命令 | `WORKFLOW.md`（本目录） |
| API调研结论 | `RESEARCH.md`（本目录） |
| 技术债/待修复 | `TECH_DEBT.md`（本目录） |
| 实时日志/数据 | SSH → 服务器（118.25.83.180）|

---

## 二、现场状态快照（2026-09-17 北京时间，最高优先级）

> 补充：ASK JUNIOR 表的自动填表脚本为 `auto_fill_ask_junior_sheet.js`。脚本直接允许 `是否在播=0` 的快照写入；罗盘快照按同名整点写 ASK 表（如 `日期小时=20` 写 `20:00` 行）。每次写入均会读回 B:L 做验证。

> 本节来自对腾讯云 `118.25.83.180` 的只读实测，覆盖下方历史状态。详细证据见 [OPS_SNAPSHOT_2026-09-17.md](OPS_SNAPSHOT_2026-09-17.md)。

| 链路 | 实测状态 | 证据 / 影响 |
|---|---|---|
| 飞书 CLI | ✅ 可用 | 已升级至 `lark-cli 1.0.96`；bot、用户身份均 `ready/verified`。Sheet bot 只读探针成功。 |
| 飞书菜单监听 | ✅ 在线 | PM2 `feishu-menu` 在线、无 unstable restart；长连接日志有正常重连记录。 |
| Cron 调度 | ⚠️ 在跑但产出失效 | 采集、截图、快检、素材、填表等 cron 均仍登记运行；调度不等于数据链路成功。 |
| 主罗盘清洗数据 | 🔴 停滞 | `data/live_clean.json` 最后修改于 **2026-07-01 08:30 北京时间**。 |
| 大屏截图 / 杭州填表 | 🔴 阻塞 | 截图采集多次落到 `www.douyinec.com` 或缺少直播大屏按钮；`autofill` 因 `/tmp/sc_pro.png` 缺失而提前失败，未执行写表。 |
| 乘方素材 | 🔴 阻塞 | `fxg_storage_state.json` 登录态失效，反复跳转到 fxg/千川登录页。 |
| 素材告警 | 🔴 阻塞 | `creative_check.js` 持续返回 HTTP 403。 |
| 服务器文档 | ⚠️ 已废弃 | `/opt/douyin-fetcher/docs` 只剩历史 `.bak`；`/root/luopan_agent_progress.md` 已过期，不能再作为运行依据。 |
| 直播排程 | ✅ 已调整 | 北京时间每天 19:30 至次日 12:00；主罗盘与大屏截图错开 15 分钟，详见 `WORKFLOW.md` v1.7。 |

### 恢复顺序（未执行）

1. 使用飞书菜单「抖音扫码」刷新主百应登录态；确认 `full_storage_state.json` 与 `fresh_cookies.json` 时间推进。
2. 单独恢复 fxg/千川登录态，之后验证 `promover_capture.js` 不再跳登录页。
3. 用真实直播时段验收 `screen_capture.js` 生成三张截图，再验收 `auto_fill_hangzhou_sheet.js` 能写入对应唯一行。
4. 待数据源恢复后，再判断 `creative_check.js` 的 403 是 cookie、接口权限还是接口变更；不要在失效登录态下反复 patch。

## 三、历史状态（截至 2026-05-12 第四段，仅供追溯）

### 系统整体：✅ 运行中

| 组件 | 状态 |
|---|---|
| live_capture_v3.js（每小时罗盘） | ✅ 正常，:00跑 |
| screen_capture.js（大屏+千川） | ✅ 正常，:00跑，三图发飞书（专业版/基础版/千川）；**千川图右侧列+KPI标签已完善**（视口1440/PIL叠字，见WORKFLOW v1.3踩坑4-6）|
| quick_check.js（5分钟快检） | ✅ 正常，每轮发飞书告警 |
| creative_check.js（素材起量） | ✅ 正常，每15分钟 |
| route_b_pull.js（:30千川） | ✅ 正常 |
| hourly_report.js（:30末尾） | ✅ 已接 cron |
| n8n 78字段合并工作流 | ✅ 正常 |
| qr_login_cloak.mjs v2.0 | ✅ API 拦截方案，二维码正常发飞书；**v2.1 启动只清.tmp 不删生产cookie** |
| feishu_menu_listener.mjs（飞书菜单触发） | ✅ **新增**，PM2 `feishu-menu` 长连接，点菜单→扫码，60s冷却+cookie隔离 |
| promover_capture.js v1.2（:35 乘方） | ✅ **分页器已修复**，63条视频全量 |
| extract_promover_summary.js（:35末尾） | ✅ 输出 promover_summary.json 29字段 |
| 飞书每小时表写入 | ⏳ **P0 未实现** |

### 最近数据快照（2026-05-12 10:xx）
- `live_clean.json`：78字段，正常归档
- `promover_summary.json`：29字段 / prom_cost=3188.91 / roi=2.23 / settle=7106.15 / orders=62
- 单视频：**63条全量**，top: 枕头QM cost=1071 orders=14 status=投放中
- Cookie：`fxg_storage_state.json` 有效（最后刷新 2026-05-11 17:12）

---

## 三、P0 任务（下一步必做）

### 飞书每小时表自动写入 `write_feishu_hourly.js`

- **表**：`tblnm0ENiM2ZtPF1`（app_token: `ArjAbDoyoaqoNWs1ogkcvOS2nlb`）
- **触发时机**：`:30` cron 末尾（route_b → extract → webhook → **写飞书表**）
- **upsert key**：`日期_小时`（如 `2026-05-12_10`）
- **字段来源**：`live_clean.json`（78字段）为主，`promover_summary.json` 补充汇总字段
- **退款铁律**：必须写两端累计值，否则飞书净GMV公式算错（见 CLAUDE.md 2.6）
- **验收标准**：`:30` cron 跑完后飞书表自动出现新行，退款/净GMV公式数字正确
- **待确认**：飞书表列名（先 GET `/v1/apps/{app_token}/tables/{table_id}/fields` 拿列结构）

---

## 四、架构方向（本会话确认）

### 四数据源 + 频率设计（已写入 ARCHITECTURE.md v1.2）

| 数据源 | 工具 | 频率 | 状态 |
|---|---|---|---|
| 百应罗盘（直播详情） | Playwright | 每小时 | ✅ |
| 直播大屏 | Route B HTTP | 每5分钟 | ✅ 告警已有，存档待升级 |
| 巨量千川 | Route B statQuery | 每5分钟 | ✅ |
| 乘方素材（63条视频） | CloakBrowser | 每小时（目标15分钟） | ✅ |

### 用户已确认决策
- 素材 Bitable 看板：**不做**（乘方后台已有）
- 素材 spike 告警：**做**，仅在 cost/ROI 突增时发飞书（P2，compare prev vs current promover_summary）
- AI 场次总结：**做**，凌晨1点下播触发，输入 = 全场快照 + 千川曲线 + 63条素材消耗，输出 = Opus 综合报告（P3）
- n8n promover 集成：**暂缓**

---

## 五、服务器关键路径速查
腾讯云服务器【ip:118.25.83.180密码z+5Lc~]Fh3?】ssh -p 22 root@118.25.83.180
```
采集脚本:       /opt/douyin-fetcher/*.js
归档数据:       /opt/douyin-fetcher/data/YYYY-MM-DD_HH.json
乘方归档:       /opt/douyin-fetcher/data/promover_YYYY-MM-DD_HH.json
乘方摘要:       /opt/douyin-fetcher/data/promover_summary.json（29字段，63条视频）
清洗结果:       /opt/douyin-fetcher/data/live_clean.json（78字段）
Cookie文件:     /opt/douyin-fetcher/full_storage_state.json
fxg Cookie:     /opt/douyin-fetcher/fxg_storage_state.json
菜单监听:       /opt/douyin-fetcher/feishu_menu_listener.mjs（PM2: feishu-menu）
菜单Secret:     /opt/douyin-fetcher/.feishu_menu.env（600, gitignore）
菜单触发日志:   /tmp/qr_login_trigger.log
Cron日志:       /tmp/luopan_cron.log | /tmp/promover_cron.log
CloakBrowser:   /root/.cloakbrowser/chromium-146.0.7680.177.3/
n8n容器:        docker ps | grep n8n
```

---

## 六、Cron 完整配置（2026-05-12）

```
:00  live_capture_v3.js → n8n webhook
:00  screen_capture.js → extract_screen_summary.js
:05/:10/... quick_check.js（每5分钟，告警）
:15/:30/:45 creative_check.js（每15分钟，素材起量告警）
:30  route_b_pull.js → extract_screen_summary.js → n8n webhook → hourly_report.js
:35  promover_capture.js → extract_promover_summary.js
```

---

## 七、promover_capture.js 关键实现备忘（v1.2）

**采集路径（必须顺序，否则表格不渲染）：**
1. qianchuan home → 点导航「乘方」→ `/uni-prom/overall`（不能直跳）
2. 关防诈弹窗（最多6轮，覆盖 ant-modal-close + 文字按钮）
3. 点计划行 `[class*="live-adinfo-material"]` 的「素材」按钮
4. 关弹窗 → 点「视频」子tab → **等 `material/list-required` API 计数增加**（非 DOM waitForSelector）
5. JS TreeWalker 找 `ovui-option__content` 分页器 → 设100条/页
6. 等 4-6s 全量加载 → 存档

**分页器关键**（v1.2修复核心）：
- 不用 Playwright locator（isVisible 有视口限制）
- 用 `document.createTreeWalker` 匹配 `/\d+\s*条\s*[/／]\s*页/` 文字节点，直接 `.click()`
- 等待策略：监测 `allAPIs` 里 `material/list-required` 调用次数增加，而非 DOM 选择器

**11个 statQuery reqFrom：**
`data-summary` / `data-summary-overall` / `total-trend`(×2) / `content_overall_data` / `estimated_saving_service_fee` / `uniDataOverview_trend_today` / `uniDataOverview_trend_yestoday` / `uniDataOverview` / `approxOverview` / `approxOverviewTrend`

---

## 八、参考源码

| 路径 | 用途 |
|---|---|
| `/opt/douyin-fetcher/refs/juliang-qianchuan-auto-ads-v1` | 千川自动投放参考（Phase 6 开发时读） |
| 重点文件 | `workspace-template/cdp_qc_batch_loop.js`（监控循环）、`qc_monitor_state_validate.js`（状态校验）、`references/live-heating-sop.md`（完整SOP） |

---

## 九、可用数据字段清单（Bitable 建表参考）

> 来源三路：罗盘直播详情（live_clean.json）+ 大屏/千川（Route B）+ 乘方（promover_summary.json）
> 实测时间：2026-05-12

### ① 场次基本信息

| 字段 | 样例值 |
|---|---|
| 日期小时 | 2026-05-12_16 |
| 直播标题 | 2026-05-12 16:00生活星球官方旗舰店 |
| 开播时间 | 2026/05/12 07:33 |
| 直播时长 | 8小时27分钟 |
| 是否在播（1=直播中 0=已下播）| 1 |

### ② 核心业绩

| 字段 | 样例值 |
|---|---|
| GMV（元）| 14668 |
| 退款金额（元）| 1821 |
| 净GMV = GMV - 退款（元）| 12847 |
| 退款率 = 退款额/GMV | 12.4% |
| 退款订单数 | 17 |
| 大屏成交订单数 | 152 |
| 成交人数 | 149 |
| 客单价（元）| 98.44 |
| 涨粉数 | 26 |

### ③ 转化漏斗

| 字段 | 样例值 |
|---|---|
| 直播间曝光人数 | 30517 |
| 直播间观看人数（进入）| 3448 |
| 商品曝光人数 | 3045 |
| 商品点击人数 | 1089 |
| 观看成交转化率 | 4.32% |
| 成交粉丝占比 | 1.3% |

### ④ 观众行为

| 字段 | 样例值 |
|---|---|
| 平均在线（人）| 9 |
| 最高在线（人）| 27 |
| screen_avg_watch_dur（平均看播时长，秒）| 57 |

### ⑤ 渠道来源（成交额，元）

| 字段 | 样例值 |
|---|---|
| 渠道_推荐feed | 1511 |
| 渠道_短视频引流 | 5965 |
| 渠道_搜索 | 475 |
| 渠道_商城推荐 | 1415 |
| 渠道_主页橱窗 | 898 |
| 渠道_其他 | 4300 |

### ⑥ 投流盈亏

| 字段 | 样例值 |
|---|---|
| 千川消耗（元）| 6986 |
| qc_cost（千川口径消耗，元）| 7256 |
| qc_ROI（净GMV/消耗）| 2.19 |
| qc_GPM（千次观看成交额）| 2950 |
| qc_order_cnt（订单数）| 159 |
| qc_cpo（每单成本，元）| 45.64 |
| qc_watch_pay_rate（看播成交率）| 4.37% |

### ⑦ 乘方素材汇总

| 字段 | 样例值 |
|---|---|
| prom_cost（素材总消耗，元）| 8025 |
| prom_roi | 2.23 |
| prom_settle_gmv（结算GMV，元）| 17917 |
| prom_gross_gmv（毛GMV，元）| 20037 |
| prom_order_cnt（总订单数）| 161 |
| prom_cpo（每单成本，元）| 49.85 |
| prom_refund_rate（退款率）| 10.58% |
| prom_fee_saving（省佣，元）| 529 |
| prom_latest_hour（最新统计小时）| 16:00 |
| prom_latest_roi（最新小时ROI）| 1.61 |
| prom_video_cnt（在投素材数）| 64 |

---

## 十、Phase 6 方向决策（第四段确认）

### 架构方向：Claude Code + CDP 直连可见浏览器

**原方案（已砍）**：服务器规则引擎 → HTTP → 桌面执行层
**新方案（已定）**：Claude Code (VS Code) 直接读服务器数据 + CDP连接已有浏览器 操作千川

```
Claude Code (VS Code, Windows)
  ├── SSH 读 live_clean.json / promover_summary.json（服务器数据）
  ├── 自己分析决策（Claude = 决策引擎，不需要 qc_decision.js）
  ├── CDP 连接 oba-live-tool 已开的可见浏览器
  └── 执行操作（调价/删除/创建），操作员全程可见
```

**砍掉的复杂度**：~~qc_decision.js~~ ~~command JSON schema~~ ~~pending_commands.json~~ ~~HTTP轮询~~

**参考项目**：`juliang-qianchuan-auto-ads-v1`（/opt/douyin-fetcher/refs/）
**桌面工具**：`oba-live-tool`（C:\Users\wu\Desktop\oba-live-tool\）已开，登录巨量百应

### 当前进展（Windows端）✅ CDP连接已验证
- oba-live-tool asar 已修改：`--remote-debugging-port=9224` 加入 Playwright launch args
- CDP 地址：`http://127.0.0.1:9224`
- 页面 WebSocket：`ws://127.0.0.1:9224/devtools/page/06832110B141A37EFD038EEE77ACDCCA`
- 连接测试脚本：`D:\Claude_code_openspec_codex\connect_test.js`
- 截图验证：巨量百应直播中控台完整可见（在线人数/弹幕/商品列表），登录态正常
- PT1报告已完成（`PT1_report_qianchuan_20260512.md`，因context中断未写入磁盘）
- **下一步**：navigate 到千川页面，开始写调价核心逻辑

### PT1关键结论（Phase 6架构压力测试）
- P0：指令持久化+幂等性 → Claude Code 自身管理，不需要额外机制
- P0：执行结果回流 → Claude Code 直接知道结果
- P1：调研千川开放API（可能比Playwright更稳）→ 待做
- P1：信任梯度红/黄/绿灯 → Claude判断后弹确认，操作员点确认
- 安全护栏复用 juliang 源码：24项校验、跨分页完整性、台账去重

---

## 十一、历史会话摘要

| 日期 | 主要完成 |
|---|---|
| 2026-06-26 第七段 | 飞书菜单自助扫码上线：`feishu_menu_listener.mjs`（node-sdk WSClient长连接订阅menu_v6）→点菜单触发qr_login_cloak；踩坑修复(event_key前导空格→trim/pgrep自匹配→方括号)；两道闸(60s冷却+进行中跳过)；隐患修复(qr启动不再删生产cookie，扫码成功才原子覆盖) |
| 2026-06-15 第六段 | 千川截图三修：右侧列被切(视口1440×900)/STEP10点歪#crowd→精确#ad/KPI标签Vue组件不渲染→DOM读坐标+PIL叠字(overlay_qc_labels.py)；磁盘清理(npm/puppeteer释放2G)；WORKFLOW v1.3 |
| 2026-06-14 第五段 | 修Step7未命中(waitForResponse提前注册)；screen_capture新增三图截图发飞书；磁盘满+OOM事故处理；WORKFLOW v1.2写入截图SOP |
| 2026-05-12 第四段 | Phase 6架构PT1压力测试；砍掉规则引擎方案→Claude Code+CDP直连；Windows端oba-live-tool已开 |
| 2026-05-12 第三段 | 架构哲学写入七文档；Phase 6 千川自动投放规划落 STEPS v1.5；参考源码下载至服务器 |
| 2026-05-12 第二段 | promover v1.2分页器修复（10→63条）；四数据源架构确认写入ARCHITECTURE v1.2 |
| 2026-05-12 第一段 | promover_capture.js + extract_promover_summary.js + :35 cron 初版 |
| 2026-05-11 第二段 | qr_login_cloak.mjs v2.0 修复（API拦截方案），screen_ null字段验证 |
| 2026-05-11 第一段 | 全量迁移 CloakBrowser，删除旧脚本43个 |
