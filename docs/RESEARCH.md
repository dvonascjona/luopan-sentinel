<!-- TAG: 规则文档 | 用途: 罗盘哨兵API调研与技术验证结论 | 生成: 2026-05-10 -->
# 罗盘哨兵 — 调研记录（RESEARCH.md）

> 版本：v1.1 | 更新：2026-05-10
>
> v1.1 (2026-05-10) [新增] 风险分层分析、指纹策略验证、大屏API详细字段、千川Route B完整DataSetKey映射、安全缺口评估

---

## 一、API 直连可行性验证（2026-05-09）

### 测试方法
从 Playwright 拦截到的 API 请求中提取 URL + headers + cookies，用 curl/HTTP 直连测试。

### 结论总表

| API | 直连 | HTTP 状态 | 业务状态 | 根因 |
|---|---|---|---|---|
| `today_live_room` | ✅ | 200 | 完整数据 | 列表级 API，无会话要求 |
| `live_screen/core_data` | ✅ | 200 | st:0 | 大屏公开接口 |
| `live_screen/five_min_data` | ✅ | 200 | st:0 | 大屏公开接口 |
| `千川 statQuery` | ✅ | 200 | 有数据 | Route B 复用 POST body |
| `live_room/ad` | ⚠️ | 200 | 全部 0 | **DOU+ 端点**，非千川 |
| `core_group_info` | ❌ | 200 | code:11001 | 需 compass 页面会话上下文 |
| `trade_info` | ❌ | 200 | code:11001 | 同上 |
| `channel_flow` | ❌ | 500 | — | 同上 |
| `basic_info` | ❌ | 200 | code:11001 | 同上 |

### 11001 根因分析

Detail 类 API 检查"是否经过 compass live-statement 页面加载"的会话序列。直连跳过了 React handler 的 session 初始化步骤，平台软拒绝（返回空/错误而不是 401）。

**尝试过的绕过方式**：
- 从 `today_live_room` 响应头提取 `x-ms-token` 带入 → 依然 11001
- 结论：11001 不是 token 问题，是会话上下文问题，无法绕过

---

## 二、live_room/ad 真相（2026-05-09）

- `business_api/author/live_detail/live_room/ad` 是 **DOU+（抖加）** 端点
- `index_tip: "DOU+订单数"` 暴露了真相
- 千川商家没有 DOU+ 消耗，所以全部返回 0
- **千川消耗无法通过任何直连 API 获取**，只能通过 Playwright 完整 compass 会话

---

## 三、Route B 机制验证（2026-05-09）

### 原理
`screen_capture.js` 运行时拦截请求，保存 `{ reqFrom, url, postData }` 到 `screen_clean.json`。
Route B = 读取 POST body 模板 + 从 `full_storage_state.json` 读 cookies → HTTP POST 复用。

### 可行端点

| 端点 | 结果 | 备注 |
|---|---|---|
| materialVideo（素材数据） | ✅ 200 | Limit 改 100 可拿全部 48 条 |
| material_trend_video（素材趋势） | ✅ 200 | 去掉 material_id filter 后返回全聚合时序 |
| 千川 room 级 statQuery | ✅ 200 | 18 个 qc_ 字段 |

### 关键注意
- URL 去掉 `msToken` 和 `a_bogus`（Playwright session 动态签名），去掉后仍 200
- Cookies 来源：`full_storage_state.json`，过滤 `domain.includes('jinritemai')`（~66 条）
- Cookie 有效期：每次 `screen_capture.js` 跑后刷新，当日内有效

---

## 四、风险分层分析 [v1.1新增]

### 三类风险评估

| 风险 | 级别 | 分析 |
|---|---|---|
| 直播间被限流 | ✅ 极低 | 推流/限流走 CDN 内容分发层，compass 走数据仓库层，代码不同团队维护，系统完全隔离 |
| 账号被识别异常 | ⚠️ 中等可控 | 检测点是登录 IP（数据中心） + headless 设备，不是数据读取。Cookie 快速失效的根因就在这里 |
| 账号被封 | ✅ 极低 | 封号针对刷量/批量操控/作弊，我们只用自己账号读自己数据 |

### 关键认知
- **读分析数据 ≠ 触碰直播间**。compass_api 返回的是历史统计，不是实时流控通道
- 访问路径：`浏览器 → buyin.jinritemai.com → compass_api`，与直播间路径（`主播设备 → 推流服务器 → 观众`）完全独立
- 每小时 1 次访问频率远低于正常人工刷新

---

## 五、指纹策略验证 [v1.1新增]

### 核心结论：同 IP + 同设备指纹 = 最安全

| 情况 | 风险 | 原因 |
|---|---|---|
| 同 IP + 同设备指纹（家庭宽带） | 最低 | 看起来就是一台专用电脑 |
| 同 IP + 同设备指纹（机房 IP） | 中等 | IP 可疑但行为一致 |
| 同 IP + 每次换指纹 | **高** | 设备频繁切换 = 群控特征 |
| 不同 IP + 每次换指纹 | 最高 | 完全像黑产 |

### 正确做法
```
QR扫码登录（cookie失效时）
  → getProfile(true) 生成新指纹 → 保存 current_profile.json → 保存新cookie

每小时自动抓取
  → getProfile(false) 读同一套指纹 → 用旧cookie
  → 对平台来说：同一台机器在正常访问后台
```

### 安全缺口评估

| 缺口 | 描述 | 风险 | 处理 |
|---|---|---|---|
| Linux 字体库 | 服务器字体集与 Windows/Mac 差异大，Canvas 指纹会暴露 | 中 | 暂不处理，机房 IP 已是主要风险点 |
| 鼠标轨迹瞬移 | headless 下 `scrollIntoView + click` 无移动路径 | 低 | 平台主要检测 mousemove 事件，headless 不渲染 |
| Cron 整点节律 | `live_capture_v3` 和 `screen_capture` 固定 :00 触发 | 低 | 已在 quick_check 加 jitter，深度采集待加 |

---

## 六、人性化改动评估（2026-05-09）

### 已采纳

| 技术 | 效果 |
|---|---|
| 随机等待区间 `rnd(min,max)` | 消除固定间隔节律（13 处） |
| `humanBrowse()` 闲逛行为 | 模拟人工浏览仪表盘 |
| `checkAbnormal()` 异常检测 | URL 跳转 / 验证码检测 → 飞书报警 |

### 已放弃（对商家账号场景无价值）

| 技术 | 放弃原因 |
|---|---|
| 动态切换 User-Agent | 有真实 storageState 历史，换 UA 反而是异常信号 |
| Canvas/WebGL 指纹注入 | 商家真实账号已有历史指纹档案，注入假值触发异常 |
| 鼠标曲线轨迹算法 | headless 不渲染鼠标轨迹，平台检测 mousemove 事件，收益极低 |
| 页面访问顺序随机 | Step7 API 触发依赖固定导航顺序，随机化会漏掉关键 API |

### slider 误判教训
初版 `checkAbnormal` 加了 `[class*="slider"]` 和 `[class*="verify"]`，
罗盘图表组件含 slider 元素导致误判，exit(1) 且无 FATAL 日志（静默退出）。
**已移除宽泛选择器，仅保留 `captcha` / `challenge` 明确选择器**。

---

## 五、衍生指标体系（2026-05-09）

仅用 6 个基础数据（GMV / 观看 / 订单 / 涨粉 / 时长 / 千川消耗）可算出 14 个指标：

### 100% 准确
- GPM = GMV / 观看 × 1000
- 转粉率 = 涨粉 / 观看
- 客单价 = GMV / 订单
- 千川 ROI = GMV / 千川消耗
- 流速环比 = (本期观看 - 上期观看) / 上期观看
- 连续无出单 = 订单增量 = 0 的连续周期数
- 投流占 GMV 比 = 千川消耗 / GMV

### 趋势准确
- 近似 UV 价值 = GMV / 观看（PV 近似 UV）
- 整体转化率 = 订单 / 观看

### 投流效率
- 涨粉成本 = 千川消耗 / 涨粉
- 获客成本 = 千川消耗 / 订单
- 千次观看投流成本 = 千川消耗 / 观看 × 1000

### 直播效率
- 小时 GMV 产出 = GMV / 直播时长(h)
- 小时涨粉效率 = 涨粉 / 直播时长(h)

---

## 八、大屏 API 端点详细字段映射 [v1.1更新]

### Screen APIs 详细字段

| API 端点 | 状态 | 实际可取字段 |
|---|---|---|
| **live_base_info** | ✅ st:0 | `live_status`、`live_start_time/ts`、`nickname`、`app_platform`、`is_ecom_room`、服务器时间 |
| **core_data** | ✅ st:0 | 成交金额 `pay_amt`、实收 `real_pay_amt`；**9 大核心**：GPM、成交人数、成交件数、观看成交率、商品点击成交率、实时在线、曝光观看率、人均观看时长、新增粉丝 |
| **core_data.index_groups** | ✅ st:0 | **流量组**：在线/曝光观看率/累计观看/曝光次数；**互动组**：均观看时长/评论/互动率/涨粉/关注率/加团率；**交易组**：成交人数/GPM/观看成交率/退款金额/千川消耗 |
| **five_min_data** | ✅ st:0 | 近 5 分钟成交金额增量+环比、观看增量+环比（平台已预计算，无需 diff） |
| **portrait_five_min_data** | ✅ st:0 | 近 5 分钟成交用户画像（年龄/性别/手机价位/地区）、只看不买画像 |
| **product** | ✅ st:0 | 商品列表（`pay_gmv` / `product_id` / `product_img`） |
| **product_explain_detail** | ✅ st:0 | 当前讲解商品：近 5 分钟点击/成交金额/件数、到手价、库存、讲解时长 |
| **blend_trend_v2** | ✅ st:0 | 综合趋势时序（成交金额+在线人数按整点切片）、`key_points` 事件标记 |
| **live_stream** | ✅ st:0 | 直播流地址 `flv_url` / `hls_url` |
| **search_warn** | ✅ st:0 | 搜索预警配置 |
| **flow_diagnosis_realtime_warn** | ✅ st:0 | 流量诊断实时预警（`warn_data` 数组） |
| **violation_warning_v2** | ✅ st:0 | 违规预警（`punish_cnt` / `warning_infos`） |
| **ad_ecp_info** | ⚠️ st:0 | `available_amount=0`（DOU+ 预算，千川下无意义） |
| **flow_support** | ⚠️ st:0 | `is_support=False`（流量扶持状态） |
| **live_order** | ❌ 621000601 | 逐单列表，参数校验失败 |

### 千川 Route B 完整 DataSetKey 映射 [v1.1新增]

| reqFrom | DataSetKey | 数据内容 | 验证 |
|---|---|---|---|
| **commonMetricCard** | `board_roi2_overview_conf_next` | 千川看板总览：订单数/GPM/观看成交率/客单价/在线/消耗/净成交额 | ⏳ 待验证 |
| **totalTrend** | `board_roi2_total_trend_next` | **5 分钟粒度时序**：千川消耗 `stat_real_cost` + 净成交额 | ⏳ 待验证 |
| **funnelModule** | `board_roi2_funnel_core` | **完整漏斗**：曝光→观看→商品点击→成交（含各层转化率） | ⏳ 待验证 |
| **sourceChannel** | `board_roi2_source` | 渠道分流：按来源分类的观看人数与成交金额 | ⏳ 待验证 |
| **materialLive** | `board_roi2_material_performance` | 主播维度追投状态 | ⏳ 待验证 |
| **materialVideo** | `board_roi2_material_performance_video` | 视频素材详情：追投状态/消耗/GMV/ROI/成交件数 | ✅ 已验证 |
| **materialCarousel** | `board_roi2_material_performance_video` | 轮播图素材：同上字段 | ✅ 已验证 |
| **material_trend_video** | `board_roi2_material_performance_video` | 素材 5 分钟趋势：消耗+净成交额时序 | ✅ 已验证 |

**技术要点**：
- 直接捕获的千川 API 返回 `status_code: 997`（多直客账户），主要为前端 UI 配置
- **核心业务数据**隐藏在 `creative_requests`（27 条 POST 模板）中，通过 Route B 获取
- `997` 错误不影响 Route B，该路径可绕过校验
- 大屏 `core_data` 的千川消耗仅为当场累计值；若需 5 分钟粒度时序，必须调千川 `totalTrend`

---

## 九、Changelog

| 日期 | 变更 |
|---|---|
| 2026-05-10 | v1.1 — [新增] 风险分层、指纹策略、大屏API详细字段、千川DataSetKey完整映射 |
| 2026-05-10 | v1.0 — 从 `luopan_agent_progress.md` 拆分建档 |
