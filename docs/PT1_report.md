<!-- TAG: 验收存档 | 用途: 罗盘哨兵全部踩坑记录与防重踩清单 | 生成: 2026-05-10 -->
# 罗盘哨兵 — 踩坑报告（PT1_report.md）

> 版本：v1.0 | 更新：2026-05-10
> 累计 27 个坑，全部已解决

---

## 一、n8n / 工作流（5 坑）

| # | 坑 | 结论 |
|---|---|---|
| 1 | n8n execution success 不等于跑的是最新草稿 | 必须核对 `activeVersionId` |
| 2 | 更新 n8n 工作流时不能改 versionId | 只改 nodes 内容，同步更新 `workflow_history` |
| 24 | REST API PATCH 只更新 `workflow_entity`，执行时读 `workflow_history` | 修改必须停机直改 SQLite 两张表 |
| 25 | 在线 cp SQLite 主文件不含 WAL → `SQLITE_CORRUPT` | 必须 stop → rm WAL/SHM → 操作 → start |
| 27 | `activate` POST 需要 body 中带 `versionId` | 正确格式：`POST /activate body={"versionId":"..."}` |

---

## 二、飞书 Bitable（4 坑）

| # | 坑 | 结论 |
|---|---|---|
| 3 | 飞书文档 URL 中的 token ≠ Bitable `app_token` | 通过 wiki node API 获取真实 `obj_token` |
| 14 | lark-cli 标志名：`--app-token` 错，`--base-token` 对 | 不存在 `--key-field` 标志 |
| 17 | 飞书每小时表结束时间设为整点 | 应设为实际捕获时刻，否则时长=1分钟 |
| 18 | 退款只写结束值不写起始值 | 净 GMV 公式算错，两端值必须同时写入 |

---

## 三、Cookie / Session（4 坑）

| # | 坑 | 结论 |
|---|---|---|
| 5 | 凌晨 1 点 timeout | 正常现象（下播），加重试逻辑 |
| 6 | storageState 不写回 → token 越跑越旧 | 每次成功后必须持久化 |
| 7 | 百应 24h 常驻浏览器会被踢 | 正确做法：按需启动 + 保存 state |
| 16 | `getProfile(true)` 启动即删 cookie | 保活用 `getProfile(false)` + 原子替换 |

---

## 四、qr_login 扫码（3 坑）

| # | 坑 | 结论 |
|---|---|---|
| 14 | 超时写 60000 但注释说 4 分钟 | 改 240000，注释和代码必须一致 |
| 15 | 多实例同时跑 → 多张二维码 | 跑前先 `pkill`，或加 flock 互斥 |
| 4 | Memoh 登录端点是 `/api/auth/login`，不是 `/auth/login` | POST 405 时先检查路径前缀 |

---

## 五、API 直连与 Route B（5 坑）

| # | 坑 | 结论 |
|---|---|---|
| 9 | `live_room/ad` 全部 0 以为被屏蔽 | 这是 DOU+ 端点，千川商家本来没数据 |
| 10 | 带 `x-ms-token` 还是 11001 | token 不是问题，缺的是 compass 页面导航序列 |
| 11 | 11001 不代表签名失败 | 平台"未建立页面会话"软拒绝，无法绕过 |
| 19 | `screen_clean.json` 没存 cookies 字段 | Route B 读 `full_storage_state.json` |
| 20 | Route B 403：URL 带 `msToken`/`a_bogus` | 去掉动态参数只保留 `reqFrom`+`aavid` |

---

## 六、大屏 Playwright 采集（4 坑）

| # | 坑 | 结论 |
|---|---|---|
| 19 | 千川 `roomId=undefined` | 千川 JS 没传 live_room_id，检测后替换正确 ID |
| 20 | `screenAPIs` filter 写 `/screen/` 但路径是 `live_screen/` | 改为 `url.includes('live_screen')` |
| 21 | 全场累计用户画像找不到 | 平台限制（非电商直播间），非脚本问题 |
| slider | `[class*="slider"]` 误判验证码 | 图表组件含 slider → 移除宽泛选择器 |

---

## 七、飞书消息 / 脚本 Bug（2 坑）

| # | 坑 | 结论 |
|---|---|---|
| 12 | `larkSend` 加了 `\n`→`\\n` 替换 → 消息乱排 | bash double-quoted string 支持内嵌真实换行 |
| 18 | `substring(8,10)` 取到天数 "09" 不是小时 "14" | 正确：`substring(11,13)` |

---

## 八、开发方法（2 坑）

| # | 坑 | 结论 |
|---|---|---|
| 15 | heredoc 写入含 JS 代码的 bash 脚本 | 反引号和 `$` 被 bash 解析 → 写 .py 文件 scp 执行 |
| 16 | `patch_qc.py` 插入位置错误 | 必须 assert 关键行内容再 insert |

---

## 九、首次运行行为（1 坑）

| # | 坑 | 结论 |
|---|---|---|
| 22 | `creative_check` 首次运行检测到 10 条新起量 | 正常：`creative_status.json` 为空时全量为新 |
| 23 | `material_trend_video` 模板依赖 Step 12c | `screen_capture.js` 必须先跑过一次 |

---

## 十、防重踩速查

### 改 n8n？
→ **停机直改 SQLite**，永远不用 REST API PATCH，永远不改 `versionId`

### Cookie 过期？
→ `pkill -f qr_login_flow` → `node qr_login_flow.js` → 扫码 → 验证 `ls -la full_storage_state.json`

### 飞书 API 报错？
→ 先确认用的是 `app_token`（`ArjAb...`）不是 wiki node token

### API 返回 11001？
→ 正常，会话上下文问题，用 Playwright 完整流程替代直连

### 全部返回 0？
→ 检查是不是 DOU+ 端点（`live_room/ad`），千川商家没有 DOU+ 数据

---

## 十一、Changelog

| 日期 | 变更 |
|---|---|
| 2026-05-10 | v1.0 — 从 `luopan_agent_progress.md` 累计 27 坑整理入档 |
