<!-- TAG: 规则文档 | 用途: 罗盘哨兵系统架构与数据流设计 | 生成: 2026-05-10 -->
# 罗盘哨兵 — 系统架构（ARCHITECTURE.md）

> 版本：v1.3 | 更新：2026-06-26
>
> v1.3 (2026-06-26) [迁移] 层2 清洗层从 n8n webhook 改为独立脚本 clean_live_data.js（逻辑零改动，n8n 工作流停用作冷备份）
> v1.2 (2026-05-12) [新增] 零节：四数据源全景、频率设计、gap 分析、目标数据流
> v1.1 (2026-05-10) [新增] 四层职责边界、三层闭环愿景、P0-P5系统路线图

---

## 零、四数据源架构全景 [v1.2新增]

### 数据源定义

| # | 数据源 | 内容 | 采集工具 | 目标频率 | 当前状态 |
|---|---|---|---|---|---|
| 1 | **百应罗盘**（直播详情） | GMV/漏斗/涨粉/渠道分布 | Playwright 登录抓包 | 每小时（不做5分钟，识别风险高） | ✅ 已实现 |
| 2 | **直播大屏** | 实时 GMV/GPM/在线/5分钟趋势 | Route B HTTP 直连 | 每5分钟 | ⚠️ 告警已有，存档待升级 |
| 3 | **巨量千川** | 投流 ROI/成本/结算/漏斗 | Route B statQuery | 每5分钟 | ✅ 基本实现 |
| 4 | **乘方素材** | 单视频消耗/ROI/审核状态（63条） | CloakBrowser Playwright | 每小时（目标15分钟） | ✅ 已实现，待提频 |

> **关键设计原则**：数据源 2/3/4 均为 HTTP 直连或已建立 session 后的 API 调用，抖音后台无法区分正常用户与采集脚本，5分钟级安全。数据源 1 需要 Playwright 完整登录流程，频繁触发有识别风险，保持每小时。

### 目标数据流（v1.2目标状态）

```
每5分钟（数据源2/3）                    每小时（数据源1/4）
  quick_check.js                          live_capture_v3.js
  ├── 大屏 API → 告警 + 存 5min快照        ├── 百应罗盘 → 归档 JSON
  └── 千川 API → 告警 + 存 5min快照        ├── screen_capture.js → 大屏深度
                                           └── promover_capture.js → 63条素材
        ↓ node脚本清洗                             ↓ node脚本清洗
  5min_clean.json（累积）               live_clean.json（78字段）
                                         promover_summary.json（29字段）
        ↓                                          ↓
  ┌─────────────────────────────────────────────────┐
  │         飞书 Bitable（每小时 upsert）              │ ← P0 待实现
  │  每小时行：78字段 + 5分钟峰值 + 素材top3消耗       │
  └─────────────────────────────────────────────────┘
        ↓
  飞书实时告警（规则引擎，当前已有）

  凌晨1点：下播触发 AI 场次总结
  ├── 输入：全场小时快照 + 千川 ROI 曲线 + 乘方63条素材消耗
  └── 输出：Claude Opus 综合报告（哪段爆单/素材贡献/投流效率）
```

### 当前 Gap 清单

| Gap | 影响 | 优先级 |
|---|---|---|
| 飞书每小时表写入未实现 | 数据只在服务器，无法历史查询 | **P0** |
| quick_check 快照按日期隔离 | 已落地 `snapshots/YYYY-MM-DD/HH-MM.json`，避免跨日覆盖与混读 | ✅ |
| promover_capture 每小时一次 | 素材起量窗口可能错过 | P2（当前实际可接受） |
| AI 场次总结未实现 | 无自动复盘 | P3 |

---

## 一、系统全景

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Cron 调度层                                   │
│  :00 live_capture_v3    :00 screen_capture    :30 route_b_pull      │
│  */5 quick_check        */15 creative_check                         │
└────────┬──────────────────┬──────────────────┬──────────────────────┘
         │                  │                  │
         ▼                  ▼                  ▼
┌─────────────┐  ┌──────────────────┐  ┌──────────────┐
│ Playwright  │  │ Playwright       │  │ Route B      │
│ 百应罗盘    │  │ 大屏+千川        │  │ HTTP 直连    │
│ (Step1-7)   │  │ (Step1-13)       │  │ statQuery    │
└──────┬──────┘  └────────┬─────────┘  └──────┬───────┘
       │                  │                    │
       ▼                  ▼                    ▼
  data/YYYY-MM-DD_HH.json  screen_clean.json   route_b_clean.json
       │                  │                    │
       │           extract_screen_summary.js ◄─┘
       │                  │
       │                  ▼
       │           screen_summary.json (1.1KB)
       │                  │
       ▼                  ▼
  ┌──────────────────────────────┐
  │ node 脚本 clean_live_data.js   │
  │  合并 39+19+18 字段 [v1.3迁移]  │
  └──────────────┬───────────────┘
                 │
                 ▼
          live_clean.json (78字段)
                 │
        ┌────────┼──────────┐
        ▼        ▼          ▼
    本地存档   Memoh Bot   飞书 Bitable
                           (⏳ 未实现)
```

---

## 二、四层职责边界 [v1.1新增]

```
┌───────────────────────────────────────────────────────┐
│ 层1：采集层                                             │
│   Cron → Playwright / Route B / HTTP 直连              │
│   → data/*.json (原始归档)                              │
└──────────────────────┬────────────────────────────────┘
                       │
┌──────────────────────▼────────────────────────────────┐
│ 层2：清洗层（node 脚本 clean_live_data.js）[v1.3迁移]   │
│   读归档 + screen_summary → 合并 78 字段               │
│   → live_clean.json (唯一主输出)                        │
└──────────────────────┬────────────────────────────────┘
                       │
┌──────────────────────▼────────────────────────────────┐
│ 层3：记录层（Memoh Bot / 飞书 Bitable）                  │
│   读 live_clean.json → 写飞书多维表格（每小时 upsert）   │
│   → 历史数据全部落表                                     │
└──────────────────────┬────────────────────────────────┘
                       │
┌──────────────────────▼────────────────────────────────┐
│ 层4：查询层（Memoh Bot / AI）                            │
│   用户飞书问："最近直播卖得怎么样？"                       │
│   → bot 读飞书表 → AI 分析 → 回复                       │
└───────────────────────────────────────────────────────┘
```

| 层 | 做什么 | 不做什么 |
|---|---|---|
| 系统 cron | 爬取原始数据 | 不清洗、不分析 |
| n8n | 清洗 → 小文件 | 不记录、不分析 |
| Memoh bot（记录） | 写飞书表格 | 不爬取、不清洗 |
| Memoh bot（查询） | 读表格 + AI 分析 | 不碰原始数据 |

---

## 三、双层采集架构

所有直播相关 cron 先经过 `live_gate_exec.js`：实时接口明确下播时静默跳过整条任务链，不抓取、不清洗、不生成报告、不发群消息；接口异常 fail-fast；下一周期重新检测，开播后自动恢复。

### Layer 1：每小时深度采集（Playwright，~2分钟）
- `live_capture_v3.js`：百应罗盘 → 39 字段归档 JSON
- `screen_capture.js`：直播大屏 + 千川看板 → 172 Screen API + 46 千川 API

### Layer 2：高频轻量监控（HTTP 直连，~2秒）
- `quick_check.js`：每 5 分钟直连 `live_screen/core_data` + `five_min_data`，预警时发飞书
- `creative_check.js`：每 15 分钟 Route B 调 `materialVideo`，监控素材追投状态变化
- `route_b_pull.js`：每小时 :30 Route B 拉千川 statQuery，补全 qc_ 字段

### API 可直连性验证结论

| API | 直连 | 原因 |
|---|---|---|
| `today_live_room` | ✅ | 列表级 API，无会话要求 |
| `live_screen/core_data` | ✅ | 大屏公开接口 |
| `live_screen/five_min_data` | ✅ | 大屏公开接口 |
| `千川 statQuery` | ✅ | Route B 复用 POST body + cookies |
| `core_group_info` | ❌ | 需 compass 页面会话上下文（11001） |
| `trade_info` | ❌ | 同上 |
| `live_room/ad` | ⚠️ | DOU+ 端点，千川商家全部为 0 |

---

## 三、78 字段结构

### 基础字段（41 个）— 来自归档 JSON（live_capture_v3 step6/step7）

| 类别 | 字段 |
|---|---|
| 元数据 | 日期小时、更新时间、归档文件 |
| 场次信息 | 直播标题、开播时间、直播时长、是否在播 |
| 核心指标 | GMV、大屏观看人数、大屏成交人数、大屏成交订单数、涨粉数 |
| 流量漏斗 | 直播间曝光人数、直播间观看人数、商品曝光人数、商品点击人数、成交人数 |
| 转化效率 | 客单价、观看成交转化率 |
| 退款 | 退款金额、退款订单数 |
| 广告 | 千川消耗、直播间消耗_广告口径、成交粉丝占比 |
| 渠道分布 | 渠道_整体成交/订单 + 7 个渠道拆分 |
| 流量质量 | 曝光次数、平均在线、最高在线 |
| 商品结算 | 商品结算成交额、商品退款额、商品结算成交人数 |
| 时间戳 | bjHour、capturedAt |

### screen_ 字段（19 个）— 来自大屏实时数据

`screen_live_status`, `screen_start_time`, `screen_is_ecom`,
`screen_GMV`(分), `screen_real_GMV`, `screen_GPM`,
`screen_pay_ucnt`, `screen_pay_combo_cnt`, `screen_watch_pay_rate`,
`screen_online_cnt`, `screen_avg_watch_dur`, `screen_follow_cnt`,
`screen_watch_ucnt`(null), `screen_refund_amt`(null), `screen_stat_cost`(null),
`screen_5min_gmv`(null), `screen_5min_gmv_change`(null), `screen_5min_watch`(null), `screen_5min_watch_change`(null)

> 注：7 个 null 字段待修复（见 TECH_DEBT.md）

### qc_ 字段（18 个）— 来自千川 Route B

`qc_bjTime`, `qc_GMV_settle`, `qc_ROI`, `qc_cost`, `qc_order_cnt`, `qc_GPM`,
`qc_watch_pay_rate`, `qc_cpo`, `qc_watch_ucnt`, `qc_show_watch_rate`,
`qc_funnel_show/watch/click/order`,
`qc_show_watch_pct`, `qc_watch_click_pct`, `qc_watch_pay_pct`, `qc_click_pay_pct`

---

## 四、文件清单

### 生产脚本（6 个活跃）

| 文件 | 功能 | Cron |
|---|---|---|
| `live_capture_v3.js` | 百应罗盘 Playwright 采集 | `0 0,1,8-23 * * *` |
| `screen_capture.js` | 大屏+千川 Playwright 采集 | `0 8-23,0,1 * * *` |
| `quick_check.js` | 5 分钟快检预警 | `*/5 8-23,0,1 * * *` |
| `creative_check.js` | 素材起量 15 分钟告警 | `*/15 8-23,0,1 * * *` |
| `route_b_pull.js` | Route B 直连千川 | `30 8-23,0,1 * * *` |
| `extract_screen_summary.js` | 从 10MB screen_clean 提取 1KB 摘要 | 随 screen_capture / route_b 执行 |

### 辅助脚本

| 文件 | 功能 | 状态 |
|---|---|---|
| `hourly_report.js` | 小时动态分析报告 | ✅ 已写好，⏳ 未接 cron |
| `qr_login_flow.js` | Cookie 保活扫码 | ✅ 手动触发 |
| `stealth-profile.js` | 浏览器指纹伪装 | ✅ 被 live_capture / screen_capture 引用 |

### 数据文件

| 文件 | 说明 |
|---|---|
| `data/YYYY-MM-DD_HH.json` | 每小时归档（1-2MB） |
| `data/screen_YYYY-MM-DD_HH.json` | 大屏归档 |
| `data/live_clean.json` | 78 字段清洗结果（主输出） |
| `data/screen_clean.json` | 大屏原始 API 响应（~10MB） |
| `data/screen_summary.json` | 大屏精简摘要（1.1KB） |
| `data/route_b_clean.json` | Route B 千川数据 |
| `data/snapshot_latest.json` | 最新快照 |
| `data/snapshots/YYYY-MM-DD/HH-MM.json` | 按北京时间日期隔离的 5 分钟快照序列 |
| `data/creative_status.json` | 素材追投状态持久化 |
| `full_storage_state.json` | Playwright session（~500KB） |
| `fresh_cookies.json` | Cookie 文件 |

### 废弃脚本（可清理）

早期探索阶段的遗留文件，当前不参与任何 cron 或生产流程：
`api_capture.js`, `api_capture_v2.js`, `buyin_*.js`, `douyinec_flow.js`,
`find_dashboard.js`, `full_flow_*.js`, `intercept_*.js`, `mpa_fxg_probe.js`,
`probe_*.js`, `talent_intercept.js`, `test_*.js`, `verify_cookies.js`,
`live_capture_v2.js`, `live_capture_final.js`, `buyin_live_capture.js`,
`stealth_buyin.js`, `replay.js`, `debug_first_api.js`, `compare_req_headers.js`

---

## 五、Docker 容器

| 容器 | 用途 |
|---|---|
| n8n | 数据清洗工作流 |
| memoh-server | Memoh 后端 |
| memoh-web | Memoh 前端 |
| memoh-postgres | Memoh 数据库 |
| memoh-qdrant | Memoh 向量库 |

---

## 六、三层分工设计哲学 [v1.1新增 | v1.2修订]

### 核心原则：各层职责不可越界

```
采集层（固定脚本）  →  清洗层（node脚本）  →  分析层（AI）
     便宜/稳定/可重跑      确定性输出            只在这里用 AI
```

**为什么采集层不用 AI：**
- Token 消耗：AI 操作浏览器 = 50轮对话 + vision token；脚本 = 3秒 + 0成本
- 稳定性：模型输出有随机性，今天能点到按钮明天可能点错；脚本只要平台不改就永远稳
- 可调试性：脚本报错有 stack trace + 行号；AI 操作出错只知道"没成功"

**AI 的正确位置：接收已清洗的结构化数据，输出人可直接决策的洞察。**

> "AI 只负责接收清洗后的数据进行分析，数据爬取只需固定程序，不需要 AI 做这种脏活累活。" — 设计决策，2026-05-12

**AI 唯一可以介入采集的场景（探索期）：**
- 新平台首次逆向：AI 看截图 → 找 API 位置 → 生成脚本草稿
- 探索完成后立即固化为 .js 脚本，AI 退出采集流程，脚本接入 cron

### 三层闭环愿景（从"实时救火"到"长效复盘"）

| 层级 | 工具 | 核心功能 | 技术实现 |
|---|---|---|---|
| **采集层** | 固定脚本 | 每 5 分钟增量 + 每小时深度 | Playwright + Cookie 拦截 + Route B |
| **清洗层** | node 脚本 `clean_live_data.js` [v1.3] | 字段提取、格式标准化、预警判断 | 独立 JS 确定性逻辑（原 n8n Code 节点搬出） |
| **分析层** | Claude Opus | 下播复盘、素材贡献分析、主播评估 | 接收 clean.json → 叙述式报告 |

### 功能模块现状

- **规则引擎**（已实现）：确定性强、零成本、毫秒级。流量暴跌/断层出单/效率低于均值 → 即时告警
- **AI 场次总结**（P3 计划）：下播触发，读全场快照 + 千川曲线 + 素材63条消耗 → Opus 综合报告
- **千川联动**（已实现）：打通"流量端"与"成交端"，验证投流精准度
- **主播能力评估**（P5 远期）：本场 vs 上周同时段 vs 历史最优（需 2-3 周数据沉淀）

---

## 七、系统建设路线图 [v1.1新增]

按"先落地、后实时、再智能"推进：

| 阶段 | 内容 | 核心价值 | 状态 |
|---|---|---|---|
| **P0** | 飞书多维表格写入 | 数据落地，告别本地 JSON | ⏳ 待做 |
| **P1** | 5 分钟级采集 + Jitter | 提升数据精度，解决反爬抖动 | ✅ 已完成 |
| **P2** | 规则引擎 + 机器人预警 | 实现实时作战指挥 | ✅ 已完成 |
| **P3** | 下播触发 AI 总结 | 自动化复盘，沉淀运营经验 | 🔜 计划 |
| **P4** | 千川采集模块 | 优化投流策略，核算投放比 | ✅ 已完成 |
| **P5** | 长期看板与人员评估 | 数字化人力管理 | 🔜 需 2-3 周数据 |

---

## 八、Changelog

| 日期 | 变更 |
|---|---|
| 2026-05-12 | v1.2 — [新增] 零节四数据源全景；[修订] 六节三层分工设计哲学（AI只做分析不采集） |
| 2026-05-10 | v1.1 — [新增] 四层职责边界、三层闭环愿景、P0-P5路线图 |
| 2026-05-10 | v1.0 — 从 `luopan_agent_progress.md` 拆分建档 |
