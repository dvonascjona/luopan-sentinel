# 5 分钟快照按日期归档实施计划

> 日期：2026-09-17（北京时间）
> 状态：已完成
> 目标：将 `data/snapshots/HH-MM.json` 改为 `data/snapshots/YYYY-MM-DD/HH-MM.json`，避免不同日期互相覆盖。

## 现状与根因

- `quick_check.js` 当前只用北京时间 `HH-MM` 命名快照，同一时刻每天覆盖同名文件。
- `quick_check.js` 的在线趋势会读取 `data/snapshots/` 最后 6 个文件，可能混入历史日期。
- `hourly_report.js` 直接从 `data/snapshots/` 按小时筛选，切换到日期目录时必须同步迁移读取路径。
- 本地真源与服务器上的 `quick_check.js`、`hourly_report.js` SHA256 一致，可以从 GitHub 真源修改后部署。

## 最小改动范围

1. `quick_check.js`
   - 用北京时间同时生成 `YYYY-MM-DD` 与 `HH-MM`。
   - 自动创建 `data/snapshots/YYYY-MM-DD/`。
   - 写入 `data/snapshots/YYYY-MM-DD/HH-MM.json`。
   - 在线迷你趋势只读取当天目录，禁止跨天混读。
   - `snapshot_latest.json` 保持原路径，用于连续增量计算和下播判断。

2. `hourly_report.js`
   - 从 `日期小时` 提取日期和小时。
   - 只读取对应的 `data/snapshots/YYYY-MM-DD/`，再按 `HH-` 前缀筛选。
   - 日期目录不存在时输出“本小时暂无5分钟快照数据”，不回退读取旧扁平目录，避免把历史数据伪装成当天数据。

3. 文档同步
   - 更新 `docs/CLAUDE.md` 的命名规范。
   - 更新 `docs/ARCHITECTURE.md` 的数据文件路径与旧技术债描述。
   - 更新 `docs/WORKFLOW.md` 的快照路径、cron 中已修复的随机延迟表达式与验收命令。
   - 更新 `docs/HANDOFF.md` 当前状态与计划完成记录。

## 明确不做

- 不移动或删除现有扁平目录中的旧快照；它们保留为历史证据。
- 不修改快照字段、告警阈值、飞书消息内容或采集频率。
- 不改 `route_b_pull.js`，半点接口故障另案处理。

## 验收标准

1. 语法：
   - `node --check quick_check.js`
   - `node --check hourly_report.js`
2. 真实采集：手动运行一次 `quick_check.js`，退出码必须为 `0`。
3. 新产物：当天目录出现，例如 `data/snapshots/2026-09-17/21-xx.json`。
4. 内容：新文件中的 `ts`、`bjTime`、`live_id`、`d_gmv`、`d_watch`、`d_orders` 均可读取。
5. 隔离：当天趋势读取文件数只来自当天目录；旧的 `data/snapshots/20-30.json` 不被读取。
6. 报告：`hourly_report.js` 能识别当天当前小时的新目录快照；为避免真实发群，验收时先增加或复用只输出预览的安全路径，不以 mock 代替最终真实采集验收。
7. 版本控制：只提交本任务文件，不纳入现有无关删除 `qr_login_cloak.py`；commit 后 push 私有 GitHub，再部署腾讯云并复核 SHA256。

## 回滚

- 代码：`git revert <本任务提交>` 后重新部署两个脚本。
- 服务器部署前分别保留带北京时间戳的 `.bak` 文件。
- 新日期目录不删除；回滚代码后不会再读取它，不影响恢复。

## 实施结果

- GitHub 实现提交：`99303fa`。
- 腾讯云生产脚本已部署，并保留 `.bak.20260917_213016` 备份。
- 真实运行 `quick_check.js` 退出码为 `0`。
- 已生成 `data/snapshots/2026-09-17/21-30.json`，必需字段完整。
- `hourly_report.js --dry-run` 只读取当天目录的 1 个周期，并输出 `[DRY RUN] 未发送飞书消息`。
