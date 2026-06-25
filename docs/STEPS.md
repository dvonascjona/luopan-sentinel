<!-- TAG: 进度跟踪 | 用途: 罗盘哨兵分步计划与当前进度 | 生成: 2026-05-10 -->
# 罗盘哨兵 — 步骤计划（STEPS.md）

> 版本：v1.2 | 更新：2026-06-15
>
> v1.1 (2026-05-10) [新增] P4 Route B待验证端点、P5 长期看板与人员评估、M6 里程碑

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

---

## 二、当前进行中 ⏳

（无正在进行的任务）

---

## 三、下一步计划

### P0a：杭州业绩飞书 Sheet 自动填表 ✅ 已上线+自动验证 [v1.2 2026-06-15]
- 脚本 `auto_fill_hangzhou_sheet.js` + cron `8 20-23,0,1`（中控20:00→01:00值班6小时，每小时:08）
- 8数据列+3截图全自动 upsert；数据全程序提取（千川整体成交=commonMetricCard）；行匹配=下播整点
- 件单价=直播间成交÷成交件数(screen_pay_combo_cnt)真公式，件数缺回退客单价
- **自动验证**：21:08/22:08/23:08 三整点无人干预自动填第31/32/33行，件单价真公式+三图+回读一致 ✅
- 详见 docs/CLAUDE.md 4b；日志 /tmp/autofill.log
- 注：hourly_report.js 已接 :30 cron、promover 已接 :35 cron（修正旧文档"未接cron"漂移）

### P0：飞书每小时 Bitable 表自动写入（tblnm0ENiM2ZtPF1，仍未实现）
- **表**：`tblnm0ENiM2ZtPF1`（app_token: `ArjAbDoyoaqoNWs1ogkcvOS2nlb`）
- **方案**：在 `:30` cron 末尾追加独立脚本，调飞书 Bitable upsert API
- **字段**：78 字段 → 飞书列映射（需先 GET 表结构确认）
- **upsert key**：日期_小时（如 `2026-05-10_17`）
- **验收**：下一个整点自动写入，退款/净 GMV 公式正确（两端值均有）

### P1：修复 screen_ 中 7 个 null 字段
- `screen_watch_ucnt`, `screen_refund_amt`, `screen_stat_cost`
- `screen_5min_gmv`, `screen_5min_gmv_change`, `screen_5min_watch`, `screen_5min_watch_change`
- **排查**：确认 `screen_capture.js` 和 `extract_screen_summary.js` 是否正确提取

### P1：hourly_report.js 接入 cron
- 脚本已写好，等飞书每小时表字段定稿后接入
- 接入位置：`:30` cron 末尾 `&& sleep 10 && node hourly_report.js`

### P2：飞书场次表写入
- 表 `tbl4M9bO67eFdw1K`
- 下播时写入完整场次数据

### P2：AI 场次总结（下播触发）
- 监测 `是否在播` 从 1 → 0
- 调 Claude Opus 读取当场所有 5 分钟快照
- 生成叙事报告：哪段爆单、话术效果、千川 ROI 曲线

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

---

## 五、Changelog

| 日期 | 变更 |
|---|---|
| 2026-06-15 | v1.2 — [新增] P0a 杭州业绩Sheet自动填表已上线；[修正] hourly_report/promover 已接cron的文档漂移 |
| 2026-05-10 | v1.1 — [新增] P4 Route B验证、P5 长期看板、M6 里程碑 |
| 2026-05-10 | v1.0 — 从 `luopan_agent_progress.md` 拆分建档 |
