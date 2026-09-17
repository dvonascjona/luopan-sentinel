"use strict";
// ASK JUNIOR 半小时指标表：仅写 B:L；大屏图片由 screen_capture.js 直接发群。
const fs = require('fs');
const { execSync } = require('child_process');
const URL = 'https://kcnp128qdtga.feishu.cn/wiki/XoY3whYZDi4pc9k22XPcfAyxnAh';
const SHEET = '96175c';
const DATA = '/opt/douyin-fetcher/data/live_clean.json';
function run(cmd) { const out = execSync(cmd, { encoding:'utf8', timeout:30000, stdio:'pipe' }); return JSON.parse(out.slice(out.indexOf('{'))); }
function fail(s) { throw new Error('[ASK自动填表] ' + s); }
const d = JSON.parse(fs.readFileSync(DATA, 'utf8'));
const hour = /_(\d{1,2})$/.exec(d['日期小时'] || '');
if (!hour) fail('日期小时缺失');
// 快照小时直接写同名整点行。例：20 点快照 → 表内 20:00。
// 简化: 目前 cron 每小时只产出一个完整快照；若改为半小时采集，再改成
// 从采集时间直接计算 00/30 槽位。
const time = String(+hour[1]).padStart(2, '0') + ':00';
const gmv = d.screen_GMV == null ? null : Math.round(d.screen_GMV) / 100;
const cost = d.qc_overall_cost;
const watch = d.screen_watch_ucnt;
const combos = d.screen_pay_combo_cnt;
if ([gmv,cost,watch,combos].some(v => v == null)) fail('缺少 GMV/全域消耗/场观/成交件数');
const read = run(`lark-cli sheets +cells-get --url "${URL}" --sheet-id ${SHEET} --range "A3:L200" --include value --as bot`);
const rows = read.data.ranges[0].cells || [];
const matches = rows.map((r,i)=>({r,i})).filter(x => String(x.r[0]?.value || '').trim() === time);
if (matches.length !== 1) fail(`时间 ${time} 匹配行数=${matches.length}`);
const index = matches[0].i, row = index + 3;
const prev = rows[index - 1] || [];
const n = (cell) => { const x = Number(cell?.value); return Number.isFinite(x) ? x : null; };
const prevCost=n(prev[1]), prevGmv=n(prev[2]), prevWatch=n(prev[3]);
const halfGmv = prevGmv == null ? gmv : gmv - prevGmv;
const halfCost = prevCost == null ? cost : cost - prevCost;
const halfWatch = prevWatch == null ? watch : watch - prevWatch;
const roi = halfCost > 0 ? halfGmv / halfCost : null;
const gpm = halfWatch > 0 ? halfGmv / halfWatch * 1000 : null;
const click = d['商品点击人数'];
const conversion = click > 0 ? d.screen_pay_ucnt / click : null;
const overallRoi = cost > 0 ? gmv / cost : null;
const vals = [cost,gmv,watch,halfGmv,halfCost,roi,halfWatch,gpm,conversion,overallRoi,combos];
const cells = [vals.map(value => ({ value: value == null ? '' : Math.round(value * 10000) / 10000 }))];
const wrote = run(`lark-cli sheets +cells-set --url "${URL}" --sheet-id ${SHEET} --range "B${row}:L${row}" --cells '${JSON.stringify(cells)}' --as bot`);
if (!wrote.ok) fail(JSON.stringify(wrote.error || wrote));
const check = run(`lark-cli sheets +cells-get --url "${URL}" --sheet-id ${SHEET} --range "B${row}:L${row}" --include value --as bot`);
console.log(`[OK] ${d['日期小时']}（是否在播=${d['是否在播']}）→ ${time} 第${row}行`, JSON.stringify(check.data.ranges[0].cells[0]));
