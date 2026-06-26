"use strict";
/*
 * 杭州业绩飞书表 — 每小时自动填表
 * 数据源：live_clean.json（罗盘整点合并结果）+ /tmp/sc_*.png（同次采集截图）
 * 行匹配：表里每行存「下播时间」那一刻的累计值 → 目标行 = 下播整点 == 采集小时
 * 只写 K/L/M/N/O/P + Q/R/S，绝不碰 公式列(G/H/I/J) 和 主播排班列(A-E)
 * Fail-fast：行匹配失败/写入失败/截图缺失/数据 stale → 飞书报警 + exit 1
 *
 * 2026-06-23 freshness 守卫：
 *   minute-0 的 screen_capture 截图采集耗时约 8 分钟，可能晚于 minute-8 的本填表任务。
 *   若 clean 合并发生在新截图落盘前，live_clean.json 会出现「日期小时(live侧)已是新整点、
 *   但 bjHour、screen 与 qc(截图侧) 仍是上一整点」的错位 → 旧值被写进新行（两行数字一样）。
 *   守卫：写入前校验 bjHour 整点 == 日期小时整点，stale 则重跑 clean 脚本(clean_live_data.js)并重试，
 *   重试上限内仍 stale 即 die()（决不静默写旧值）。
 *   注：qc_bjTime 字段刷新不可靠（即便 qc 数据已更新也可能停在旧值），故只用 bjHour 判新鲜。
 */
const fs = require('fs');
const { execSync } = require('child_process');

const SHEET_URL  = 'https://tcn8a0whihnj.feishu.cn/sheets/PsAbsD9YNhVlowtmVZHcfXu9nIg';
const SHEET_ID   = '0UqBfV';
const CHAT_ID    = require('./feishu_config.cjs').CHAT_ID;
const LIVE_CLEAN = '/opt/douyin-fetcher/data/live_clean.json';
const RECLEAN    = 'node /opt/douyin-fetcher/clean_live_data.js';  // 2026-06-26 清洗从 n8n webhook 迁出为独立脚本
const IMG = { Q: '/tmp/sc_pro.png', R: '/tmp/sc_basic.png', S: '/tmp/sc_qc.png' };

function larkSend(msg) {
  try {
    execSync('lark-cli im +messages-send --chat-id ' + CHAT_ID +
      ' --text "' + String(msg).replace(/"/g, "'") + '" --as bot',
      { encoding: 'utf8', timeout: 10000, stdio: 'pipe' });
  } catch (e) { console.log('lark err:', e.message.substring(0, 60)); }
}

function die(reason) {
  console.error('[FAIL] ' + reason);
  larkSend('❌ [自动填表] ' + reason);
  process.exit(1);
}

// 运行 lark-cli 并解析 JSON（兼容 +write-image 前缀的 "Writing image:" 行）
function larkJSON(cmd) {
  let out;
  try {
    out = execSync(cmd, { encoding: 'utf8', timeout: 30000, stdio: 'pipe' });
  } catch (e) {
    out = (e.stdout || '') + (e.stderr || '');
  }
  const i = out.indexOf('{');
  if (i < 0) throw new Error('lark 无 JSON 输出: ' + out.substring(0, 120));
  return JSON.parse(out.slice(i));
}

// 下播时间格子 → 整点小时（兼容 fraction 0.8333 和字符串 "20：00"/"20:00"）
function endHour(cell) {
  if (cell == null || cell === '') return null;
  const v = parseFloat(cell);
  if (isNaN(v)) return null;
  if (v < 2) return Math.round(v * 24) % 24;   // day-fraction
  return Math.floor(v) % 24;                    // 直接是钟点
}

// "2026-06-23_15" → 15
function hourOf(s) {
  const mm = /_(\d{1,2})$/.exec(String(s || ''));
  return mm ? +mm[1] : null;
}

// ── 1. 读 live_clean（freshness 守卫 + stale 重试）──
let d, dh, year, month, day, captureHour;
const MAX_TRY = 3;
for (let attempt = 1; attempt <= MAX_TRY; attempt++) {
  if (!fs.existsSync(LIVE_CLEAN)) die('live_clean.json 不存在');
  d = JSON.parse(fs.readFileSync(LIVE_CLEAN, 'utf8'));

  dh = d['日期小时'];                              // e.g. 2026-06-15_20
  const m = /^(\d{4})-(\d{2})-(\d{2})_(\d{1,2})$/.exec(dh || '');
  if (!m) die('日期小时格式异常: ' + dh);
  year = +m[1]; month = +m[2]; day = +m[3]; captureHour = +m[4];

  // freshness 守卫：screen 侧 bjHour 必须与 live 侧 日期小时 同一整点
  const screenHour = hourOf(d['bjHour']);
  if (screenHour === captureHour) break;           // 新鲜，放行

  if (attempt >= MAX_TRY) {
    die('screen 数据 stale：日期小时=' + captureHour + '点 但 bjHour=' + screenHour +
        '点，重试 ' + MAX_TRY + ' 次后仍未刷新（minute-0 截图采集未完成，拒绝写旧值）');
  }
  console.log('[STALE] 第' + attempt + '次：bjHour=' + screenHour + ' ≠ 日期小时' + captureHour +
              '，重跑 clean 脚本后 25s 重试');
  try { execSync(RECLEAN, { timeout: 30000, stdio: 'pipe' }); } catch (e) {}
  execSync('sleep 25');
}

const K = d['qc_overall_gmv'];
const L = d['qc_overall_cost'];
const screenGmvCent = d['screen_GMV'];
const M = (screenGmvCent != null) ? Math.round(screenGmvCent) / 100 : null;
const N = d['最高在线'];
const O = d['平均在线'];
// 平均件单价 = 直播间成交金额 / 成交件数（真公式）；件数不可用时回退客单价
const combo = d['screen_pay_combo_cnt'];     // 成交件数
const kedanjia = d['客单价'];
let P, pSrc;
if (M != null && combo != null && combo > 0) { P = Math.round(M / combo * 100) / 100; pSrc = 'GMV/件数(' + combo + ')'; }
else { P = kedanjia; pSrc = '客单价回退'; }

const miss = [];
if (K == null) miss.push('整体成交(qc_overall_gmv)');
if (L == null) miss.push('整体消耗(qc_overall_cost)');
if (M == null) miss.push('直播间成交(screen_GMV)');
if (N == null) miss.push('最高在线'); if (O == null) miss.push('平均在线'); if (P == null) miss.push('件单价/客单价');
if (miss.length) die(dh + ' 缺字段: ' + miss.join('、') + '（screen_capture/采集可能失败）');

for (const k of ['Q', 'R', 'S']) if (!fs.existsSync(IMG[k])) die('截图缺失: ' + IMG[k]);

// 采集日期数值（M.D 口径：month + day/100，与表内 A 列一致）
const capDateNum = month + day / 100;
const yest = new Date(Date.UTC(year, month - 1, day) - 86400000);
const yestNum = (yest.getUTCMonth() + 1) + yest.getUTCDate() / 100;
const candDates = [capDateNum];
if (captureHour <= 1) candDates.push(yestNum);   // 仅凌晨才纳入前一天（24:00 续场行）

// ── 2. 读表匹配行 ──
const rd = larkJSON('lark-cli sheets +read --url "' + SHEET_URL + '" --sheet-id "' + SHEET_ID + '" --range "A1:F400"');
if (!rd.ok) die('读表失败: ' + JSON.stringify(rd.error || rd).substring(0, 120));
const rows = rd.data.valueRange.values || [];

const hits = [];
for (let i = 1; i < rows.length; i++) {            // 跳过表头第1行
  const a = parseFloat(rows[i][0]);                // A 日期
  const eh = endHour(rows[i][4]);                  // E 下播 → 整点
  if (isNaN(a) || eh == null) continue;
  if (eh !== captureHour) continue;
  if (candDates.some(cd => Math.abs(a - cd) < 0.001)) hits.push(i + 1);  // 1-based 行号
}

if (hits.length === 0) die('未找到 日期' + capDateNum + ' 下播' + captureHour + ':00 的行（主播排班行可能没排好）');
if (hits.length > 1) die('匹配到多行 ' + hits.join(',') + '（日期' + capDateNum + ' 下播' + captureHour + ':00），人工核对');
const r = hits[0];

// ── 3. 写入 ──
function writeVals(range, vals) {
  const res = larkJSON('lark-cli sheets +write --url "' + SHEET_URL + '" --sheet-id "' + SHEET_ID +
    '" --range "' + range + '" --values ' + "'" + JSON.stringify(vals) + "'");
  if (!res.ok) die('写入 ' + range + ' 失败: ' + JSON.stringify(res.error || res).substring(0, 120));
}
function writeImg(cell, path, name) {
  process.chdir('/tmp');
  const base = require('path').basename(path);
  const res = larkJSON('lark-cli sheets +write-image --url "' + SHEET_URL + '" --sheet-id "' + SHEET_ID +
    '" --range "' + cell + '" --image "./' + base + '" --name "' + name + '"');
  if (!res.ok) die('贴图 ' + cell + ' 失败: ' + JSON.stringify(res.error || res).substring(0, 120));
}

writeVals('K' + r + ':M' + r, [[K, L, M]]);
writeVals('N' + r + ':P' + r, [[N, O, P]]);
const hh = String(captureHour).padStart(2, '0');
writeImg('Q' + r, IMG.Q, '中控台专业版_' + dh + '.png');
writeImg('R' + r, IMG.R, '中控台基础版_' + dh + '.png');
writeImg('S' + r, IMG.S, '千川_' + dh + '.png');

// ── 4. 回读核对 ──
const chk = larkJSON('lark-cli sheets +read --url "' + SHEET_URL + '" --sheet-id "' + SHEET_ID + '" --range "K' + r + ':M' + r + '"');
const got = (chk.data && chk.data.valueRange.values && chk.data.valueRange.values[0]) || [];
console.log('[OK] ' + dh + ' → 第' + r + '行 | 整体成交' + K + ' 整体消耗' + L + ' 直播间成交' + M +
            ' 最高在线' + N + ' 平均在线' + O + ' 件单价' + P + '(' + pSrc + ') | 三图已贴');
console.log('[VERIFY] 回读 K/L/M =', got.join(' / '));
