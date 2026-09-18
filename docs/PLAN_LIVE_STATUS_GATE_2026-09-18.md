# 非直播状态停止采集实施计划

> 日期：2026-09-18（北京时间）
> 状态：已完成

## 目标

即使处于 cron 规定时段，只要百应 `today_live_room` 明确显示当前没有直播，便跳过本轮所有直播相关采集；下一个 cron 周期重新检测，开播后自动恢复，不需要人工重新开启 cron。

## 设计

新增轻量门控脚本 `live_gate_exec.js`：

1. 使用 `full_storage_state.json` 中的现有 Cookie 请求 `today_live_room`。
2. 接口结构、HTTP 状态、JSON 或登录态异常：输出真实原因并 `exit 1`，不得伪装成“未直播”。
3. 明确存在 `live_status=true`：输出直播间 ID 与判断依据，然后执行传入的生产命令。
4. 明确不存在直播：输出 `[SKIP_NOT_LIVE]`、北京时间、接口判断依据并 `exit 0`，不启动浏览器或后续清洗/报告。
5. 每个 cron 周期都会重新检测，因此开播后自动恢复。

## 接入范围

- `live_capture_v3.js` 及其清洗链
- `screen_capture.js` 及其摘要链
- `quick_check.js`
- `creative_check.js`
- `route_b_pull.js` 及其摘要、清洗、小时报告链
- `promover_capture.js` 及其摘要链

ASK JUNIOR 自动填表目前已经熔断，保持禁用，不在本次恢复。

## 明确不做

- 不删除或动态改写 cron；避免第二天无法自动恢复。
- 不把接口超时、403、登录失效、字段缺失当成“未直播”。
- 不修改各采集脚本的业务逻辑与采集字段。
- 不依赖 `live_clean.json` 判断，因为它可能是旧文件；门控必须查询实时接口。

## 验收标准

1. `node --check live_gate_exec.js` 通过。
2. 真实直播状态下：门控输出 `[LIVE]`，测试命令被执行，退出码 `0`。
3. 使用固定离线响应做门控单元验证：输出 `[SKIP_NOT_LIVE]`，测试命令不执行，退出码 `0`。
4. 使用异常响应验证：输出具体错误，测试命令不执行，退出码 `1`。
5. crontab 中 6 类采集任务全部经过门控；直接调用生产脚本的活动 cron 数量为 `0`。
6. 真实 cron 路径至少完成一次可观察验证：日志中有 `[LIVE]` 或 `[SKIP_NOT_LIVE]`，且行为与状态一致。
7. 代码先提交并推送私有 GitHub，再部署腾讯云；不纳入现有无关删除 `qr_login_cloak.py`。

## 回滚

- 部署前备份 root crontab 与新增脚本。
- 回滚 crontab 后删除或停用门控脚本即可恢复原调度方式。
- GitHub 使用 `git revert <本任务提交>`。

## 实施结果

- GitHub 实现提交：`d1fc363`。
- 腾讯云 root crontab 已备份至 `/root/crontab.before_live_gate_20260918_010929.bak`。
- 13 条活动采集任务全部接入门控，未经过门控的活动采集任务为 0。
- ASK JUNIOR 自动填表继续保持禁用。
- 真实下播验证：01:15–06:00 多轮 cron 均记录 `[SKIP_NOT_LIVE] statuses=[]`，未启动采集进程。
- 真实自动恢复验证：06:15 起检测到 `live_id=7686627151357037362`，后续 cron 自动记录 `[LIVE]` 并恢复任务，无需人工启用。
