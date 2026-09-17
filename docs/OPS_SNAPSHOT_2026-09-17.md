<!-- TAG: 现场快照 | 用途: 2026-09-17 腾讯云只读审计证据；后续修复以本文件为基线 -->
# 罗盘哨兵 — 现场审计快照

> 审计时间：2026-09-17 北京时间
>
> 范围：腾讯云 `118.25.83.180` 的 `/opt/douyin-fetcher`、cron、PM2、飞书 CLI 与运行日志；全程只读。

## 结论

飞书身份链路健康，但抖音侧登录态/采集链路已失效。当前 cron 仍会触发脚本，却不能产生可用的主罗盘数据、截图或杭州业绩表更新。

## 可用组件

| 组件 | 现场结果 |
|---|---|
| `lark-cli` | 已从 `1.0.24` 升级到 `1.0.96`。 |
| 飞书 bot | `ready`、`verified`；用 bot 成功读取杭州 Sheet 的 `A1`。 |
| 飞书用户身份 | 已重新授权，`ready`、`valid`、`verified`。 |
| 飞书菜单 | PM2 `feishu-menu` 为 `online`，无 unstable restart；菜单事件曾成功触发 `qr_login_cloak.mjs`。 |
| Cron | 主采集、截图、快检、素材、Route B、乘方、杭州填表和磁盘清理任务都仍存在。 |

## 故障证据

| 严重度 | 组件 | 证据 | 后果 |
|---|---|---|---|
| P0 | 主罗盘数据 | `data/live_clean.json` 的修改时间为 2026-07-01 08:30（北京） | 后续报告无法反映当前直播。 |
| P0 | 大屏截图 | `screen_cron.log` 多次显示导航至 `https://www.douyinec.com/`，或 `a.d1wcp not found`。 | 无 `sc_pro.png` / `sc_basic.png`，失去截图与屏幕数据来源。 |
| P0 | 杭州表填表 | `/tmp/autofill.log` 持续报 `[FAIL] 截图缺失: /tmp/sc_pro.png`。 | 脚本在飞书写入之前失败；不是飞书权限问题。 |
| P1 | 乘方采集 | `/tmp/promover_cron.log` 重复出现 `home redirect to login — fxg cookies failed`。 | `promover_clean.json` 虽持续被摘要脚本写入，但来源不是成功的新采集，不能用于决策。 |
| P1 | 素材告警 | `/tmp/creative_check.log` 每 15 分钟报 `HTTP 403: Forbidden`。 | 素材起量告警失效。 |
| P2 | 文档真源 | 服务器 `docs/` 仅有 `.bak`；旧 `/root/luopan_agent_progress.md` 最后更新于 6 月且描述 n8n/39 字段旧架构。 | 新接手者会按错误链路排障。 |

## 已确认的非问题

- 飞书 bot 对杭州 Sheet 仍有实际读取权限，不能把填表失败归因为飞书授权。
- 用户 OAuth token 曾在 5 月失效，现已于本次审计完成重新授权；bot 与 user 均通过服务器端验证。
- `feishu-menu` 的历史重启计数为 6，但当前在线、`unstable_restarts=0`；日志中的 WebSocket reconnect 不单独判为故障。

## 后续验收顺序

1. 刷新主百应 cookie 后，执行真实直播时段的一次 `screen_capture.js`：必须生成 `sc_pro.png`、`sc_basic.png`、`sc_qc.png`，且日志没有回落到登录主页。
2. 刷新 fxg cookie 后，执行一次 `promover_capture.js`：必须写出新的 `promover_YYYY-MM-DD_HH.json`，日志不得含 `fxg cookies failed`。
3. 用上述真实截图运行一次 `auto_fill_hangzhou_sheet.js`：日志必须出现唯一目标行与成功回读，而不是图片缺失。
4. 重新检查 `creative_check.js` 的 403；连续两次同类错误前不再改代码，先保存完整响应证据并定位授权/接口变更。

## 维护规则

- 本地仓库 `luopan-sentinel/docs/` 是文档真源；服务器仅留运行脚本、密钥和数据归档。
- 不覆盖 `/root/luopan_agent_progress.md` 历史文件；新现场快照以日期命名，避免丢失审计证据。
- 旧进度文件含明文服务器密码，后续安全维护应移除该字段并轮换密码。
