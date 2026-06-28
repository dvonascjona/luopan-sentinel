<!-- TAG: 进度跟踪 | 用途: 罗盘哨兵分步计划与当前进度 | 生成: 2026-05-10 -->
# 罗盘哨兵 — 步骤计划（STEPS.md）

> 版本：v1.8 | 更新：2026-06-28
>
> v1.8 (2026-06-28) [修复] 大屏截图白屏/¥0：screen_capture.js fallback URL `/live_room_id=`→`?live_room_id=`(根因A) + ensureScreenRoom 截图守卫跳过空图(B)；详见 TECH_DEBT TD-12
> v1.7 (2026-06-26) [新增] Phase 7 飞书菜单自助扫码（长连接监听+60s冷却+扫码成功才覆盖cookie），已完成上线
> v1.6 (2026-05-12) [修改] Phase 6 架构重大更新：砍服务器规则引擎→Claude Code+CDP直连可见浏览器；oba-live-tool已在Windows部署
> v1.5 (2026-05-12) [新增] Phase 6 千川自动投放模块规划，参考源码已下载至服务器
> v1.4 (2026-05-12) [修改] promover_capture.js v1.2分页器修复，视频数从10→63条全量
> v1.3 (2026-05-12) [新增] P1 hourly_report.js接入cron完成、promover_capture.js接入cron完成
> v1.2 (2026-05-11) [修改] P1 screen_ 7个null字段标注已验证通过

---

**v1.2变更** · 2026-05-11 · dv × Claude

变更内容：
- [修改] P1「修复 screen_ 中 7 个 null 字段」：标注 ✅ 验证通过，补充实测数据与根因说明

解决的问题：
- 现场验证 7 个字段全部有值，CloakBrowser 迁移后 API 全部正常捕获，历史 null 源于旧 Playwright 漏抓

---

## 一、已完成 ✅

### Phase 1：基础采集（2026-05-07 ~ 05-08）
- [x] Playwright 百应罗盘采集 — `live_capture_v3.js`
- [x] stealth-profile 浏览器指纹伪装
- [x] storageState 持久化（正常/异常双路径写回）
- [x] Cron 调度（跳过凌晨 2-7 点，失败 sleep 300 重试）
- [x] n8n 清洗工作流 — 39 字段 → `live_clean.json`
- [x] Memoh Bot 记忆写入（凌晨 1 点 timeout 规则）

### Phase 2：大屏 + 千川扩展（2026-05-09）
- [x] `screen_capture.js` — 大屏 172 API + 千川 46 API
- [x] 按钮精确匹配修复（`直播大屏` 文字匹配替代 `a.d1wcp`）
- [x] 千川 `roomId=undefined` 修复
- [x] `screenAPIs` filter 修正（`/screen/` → `live_screen`）
- [x] 素材数据 tab（Step 12b）+ 素材趋势 tab（Step 12c）

### Phase 3：高频监控（2026-05-09）
- [x] `quick_check.js` — 5 分钟快检，大屏 API 直连，仅预警发飞书
- [x] `creative_check.js` — Route B 素材起量 15 分钟告警
- [x] 预警阈值调优（流速 >60%、GPM/UV >70%、连续无出单 ≥3 周期）
- [x] 飞书消息精简（4 字段 + emoji 信号旗）

### Phase 4：数据合并（2026-05-09 ~ 05-10）
- [x] `extract_screen_summary.js` — 10MB → 1.1KB 精简
- [x] `route_b_pull.js` — Route B 直连千川 statQuery
- [x] n8n 78 字段合并（停机直改 SQLite 修复 versionId 不同步问题）
- [x] `:30` 二次触发 cron（route_b → extract → webhook）

### Phase 5：安全加固（2026-05-09）
- [x] 随机等待区间（13 处 `waitForTimeout` 改 `rnd(min,max)`）
- [x] `humanBrowse()` 闲逛行为（随机滚动+停留）
- [x] `checkAbnormal()` 异常检测（URL 跳转 + 验证码元素）
- [x] `qr_login_flow.js` 原子替换 + 超时修正 240s
- [x] 5 分钟快照时间戳存档

### Phase 7：飞书菜单自助扫码（2026-06-26）[v1.7新增]
- [x] `feishu_menu_listener.mjs` — `@larksuiteoapi/node-sdk` WSClient 长连接订阅 `application.bot.menu_v6`
- [x] 飞书后台：菜单「抖音扫码」响应动作=推送事件，事件ID=`refresh_douyin_cookie`，订阅方式=长连接
- [x] event_key `.trim()` 容错（后台填ID带前导空格踩坑修复）
- [x] 60s 冷却防抖（限制1）+ 进行中跳过（限制2，`pgrep` 方括号防自匹配修复）
- [x] `qr_login_cloak.mjs` 启动只清 .tmp 不删生产 cookie（扫码成功才原子覆盖，隔离采集/填表）
- [x] PM2 `feishu-menu` 常驻 + `pm2 save`；端到端验证通过（点菜单→二维码→扫码→48 cookies 更新）

---

## 二、当前进行中 ⏳

（无正在进行的任务）

---

## 三、下一步计划

### P0：飞书每小时表自动写入
- **表**：`tblnm0ENiM2ZtPF1`（app_token: `ArjAbDoyoaqoNWs1ogkcvOS2nlb`）
- **方案**：在 `:30` cron 末尾追加独立脚本，调飞书 Bitable upsert API
- **字段**：78 字段 → 飞书列映射（需先 GET 表结构确认）
- **upsert key**：日期_小时（如 `2026-05-10_17`）
- **验收**：下一个整点自动写入，退款/净 GMV 公式正确（两端值均有）

### P1：修复 screen_ 中 7 个 null 字段 [v1.2修改]

~~排查：确认 screen_capture.js 和 extract_screen_summary.js 是否正确提取~~ [已废弃，见v1.2]

**✅ 2026-05-11 验证通过（无需修改）**
- `screen_watch_ucnt`(2823) / `screen_refund_amt`(160245) / `screen_stat_cost`(590564) — 全有值
- `screen_5min_gmv`(0) / `screen_5min_gmv_change`(-1) / `screen_5min_watch`(35) / `screen_5min_watch_change`(-0.2) — 全有值
- 结论：脚本逻辑从未出错，历史 null 源于 CloakBrowser 迁移前 Playwright 漏抓部分 API
- `渠道_关注` null 属正常：无关注渠道流量时为 null，非 bug

### P1：hourly_report.js 接入 cron [v1.3新增 ✅ 完成]
- `:30` cron 末尾已追加 `&& sleep 10 && node hourly_report.js >> /tmp/hourly_report.log 2>&1`

### P1：promover_capture.js（乘方素材采集）[v1.3新增 ✅ 完成 | v1.4修改]
- `:35` cron 独立跑：`flock -xn /tmp/promover.lock node promover_capture.js >> /tmp/promover_cron.log 2>&1`
- 采集方案：qianchuan home → 点导航「乘方」→ 关防诈弹窗 → 点「素材」→ 点「视频」→ **设100条/页** → 存 `promover_YYYY-MM-DD_HH.json`
- [v1.4新增] 分页器修复：Step9c 改用 `material/list-required` API 计数等待 + JS TreeWalker 找分页器，视频数 **10→63条全量**
- extract：29字段，含 `prom_videos` 单视频级（status/show_status/cost/orders/roi），按 cost 降序
- 捕获：11 statQuery（含 approxOverview/uniDataOverview_trend_today/content_overall_data）+ material/ad list API
- 关键 reqFrom：`approxOverview`（今日总ROI/cost/settle）、`uniDataOverview_trend_today`（24小时趋势）、`ad/list-summary`（今日汇总）

### P2：素材 spike 告警 [v1.4新增]
- **触发条件**（任意一条）：单条视频 cost 相比上次采集增幅 >50%（且绝对值 >100元）；单条视频 ROI 突增 >30%
- **实现**：`creative_check.js` 或独立 `promover_alert.js` 对比 `prev_promover_summary.json` vs 当前
- **通知内容**：视频名 + 当前cost/ROI + 变化量 + 审核状态
- **不做**：飞书 Bitable 素材看板（乘方后台已有，无需重复）

### P2：飞书场次表写入
- 表 `tbl4M9bO67eFdw1K`
- 下播时写入完整场次数据

### P2：AI 场次总结（下播触发）[v1.4修改 — 加入素材分析]
- 触发：监测 `是否在播` 从 1 → 0（约凌晨1点）
- 输入数据：
  - 全场 5 分钟快照（hourly snapshots）
  - 千川 ROI 曲线（qc_ 字段小时趋势）
  - **promover 视频级消耗**（prom_videos：哪条视频、哪个时段拉动消耗，审核状态）
- 输出：Claude Opus 综合叙事报告
  - 哪段爆单 + 对应话术
  - 千川 ROI 曲线分析
  - **素材贡献拆解**：top 视频消耗占比 + 过审/未过审分布
- 前置：需素材数据在 n8n 清洗后写入服务器（promover_summary.json 已就绪）

### P3：blend_trend_v2 / live_order 修复
- `blend_trend_v2` 返回 st:11001（次要）
- `live_order` 返回 st:621000601（逐单列表，core_data 已有聚合）

### P4：验证 Route B 待验证端点 [v1.1新增]
- 测试 `commonMetricCard`（千川看板总览）、`totalTrend`（**5 分钟千川消耗时序**）
- 测试 `funnelModule`（完整漏斗）、`sourceChannel`（渠道分流）
- `totalTrend` 若通过 → 可在 `quick_check.js` 加入千川消耗实时预警
- 详见 TECH_DEBT.md TD-11

### P5：长期看板与人员评估 [v1.1新增]
- 主播能力指标：GPM、转化率、涨粉效率、互动率
- 对比维度：本场 vs 上周同时段 vs 历史最优场
- **前置条件**：需 2-3 周连续数据沉淀
- 输出：飞书看板 + 周期性评估报告

### Phase 6：千川自动投放模块 [v1.6修改 🔜 待开发]

> **前置条件**：P0 飞书填表完成 + 2-3周数据沉淀

#### [v1.5旧方案，已废弃，见v1.6]
~~技术路线：服务器规则引擎(qc_decision.js) → HTTP → 桌面执行~~
~~原因：架构过重，非技术人员看不到过程，服务器IP风控风险~~

#### [v1.6新架构] Claude Code + CDP 直连可见浏览器

```
Claude Code (VS Code, Windows)
  ├── SSH 读服务器数据（live_clean.json / promover_summary.json）
  ├── Claude 自身分析决策（不需要独立规则引擎脚本）
  ├── CDP 连接 oba-live-tool 已开的可见浏览器
  └── 执行操作，操作员全程可见
```

**参考源码**：`/opt/douyin-fetcher/refs/juliang-qianchuan-auto-ads-v1`
**桌面工具**：`C:\Users\wu\Desktop\oba-live-tool\` 已安装，已登录巨量百应

#### 6.0 前置验证（当前步骤）🔜
- [ ] Claude Code 通过 CDP 连接 oba-live-tool 的浏览器（试端口9222）
- [ ] 调研千川开放 API 覆盖范围（API优先于Playwright）

#### 6.1 只读监控（看不动）
- Claude Code SSH 读服务器数据 → CDP 读千川计划状态
- 输出分析到 VS Code 终端，不执行任何操作

#### 6.2 半自动调价（人工确认）
- Claude 列出建议操作 → 操作员输入"确认" → 浏览器执行
- 复用 juliang 安全护栏：硬停/校验/跨分页完整性

#### 6.3 自动创建计划
- 10模块填写 + 24项校验（juliang SOP）
- 命名：`直播加热_行为{词}_兴趣{词}` | 台账去重（服务器端）
- **必排除人群**：高取消/高关注/高活跃/粉丝

---

## 四、里程碑

| 里程碑 | 状态 | 达成条件 |
|---|---|---|
| M1 基础采集 | ✅ 完成 | live_capture_v3 每小时跑通 + n8n 清洗 |
| M2 全量数据 | ✅ 完成 | 78 字段合并，screen + 千川数据到位 |
| M3 实时监控 | ✅ 完成 | quick_check + creative_check 飞书通知 |
| M4 飞书看板 | ⏳ 进行中 | 每小时表 + 场次表自动写入飞书 Bitable |
| M5 智能分析 | 🔜 计划 | AI 场次总结 + 小时动态报告 |
| M6 数据驱动运营 | 🔜 远期 | 长期看板 + 主播评估（需 2-3 周数据） |
| M7 千川自动投放 | 🔜 远期 | 监控→告警→半自动调价→自动创建（前置M4完成+2周数据）|

---

## 五、Changelog

| 日期 | 变更 |
|---|---|
| 2026-06-26 | v1.7 — [新增] Phase 7 飞书菜单自助扫码上线（长连接监听+60s冷却+cookie隔离）|
| 2026-05-12 | v1.6 — [修改] Phase 6 架构重大更新：Claude Code+CDP直连，砍服务器规则引擎；oba-live-tool Windows已部署 |
| 2026-05-12 | v1.5 — [新增] Phase 6 千川自动投放三步规划（M7里程碑），参考源码已落服务器 |
| 2026-05-12 | v1.4 — [修改] promover v1.2分页器修复；[新增] P2 素材spike告警、AI场次总结加入素材拆解 |
| 2026-05-12 | v1.3 — [新增] P1 hourly_report接入cron完成、promover_capture.js接入cron完成 |
| 2026-05-11 | v1.2 — [修改] P1 screen_ 7个null字段标注已验证通过 |
| 2026-05-10 | v1.1 — [新增] P4 Route B验证、P5 长期看板、M6 里程碑 |
| 2026-05-10 | v1.0 — 从 `luopan_agent_progress.md` 拆分建档 |
