/**
 * hourly_report.js
 * 每小时触发：读 live_clean.json 全量 + data/snapshots/ 本小时5分钟快照
 * 计算精准衍生指标 + 动态趋势，发飞书小时报告
 */

const fs   = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const CLEAN_FILE   = '/opt/douyin-fetcher/data/live_clean.json';
const SNAP_DIR     = '/opt/douyin-fetcher/data/snapshots';
const SNAP_LATEST  = '/opt/douyin-fetcher/data/snapshot_latest.json';
const CHAT_ID      = 'oc_af2b50b253a140dafe12c2d2a1acd9e9';

// ── 工具函数 ──────────────────────────────────────────────────────────────
function n(v, digits = 0) {
  if (v == null || isNaN(v) || !isFinite(v)) return '--';
  return Number(v).toFixed(digits);
}
function pct(v, digits = 1) {
  if (v == null || isNaN(v) || !isFinite(v)) return '--';
  const s = (v * 100).toFixed(digits);
  return s + '%';
}
function trend(v) {
  if (v == null || isNaN(v) || !isFinite(v)) return '--';
  const s = (v * 100).toFixed(1);
  return (v >= 0 ? '+' : '') + s + '%';
}
function flag(v, badDir = 'down', warnThr = 0.2, goodThr = null) {
  if (v == null || isNaN(v) || !isFinite(v)) return '';
  if (badDir === 'down' && v < -warnThr) return '🔴';
  if (badDir === 'up'   && v >  warnThr) return '🔴';
  if (goodThr != null) {
    if (badDir === 'down' && v > goodThr) return '✅';
    if (badDir === 'up'   && v < goodThr) return '✅';
  }
  return '';
}
function larkSend(msg) {
  const safe = msg.replace(/"/g, "'");
  execSync(`lark-cli im +messages-send --chat-id ${CHAT_ID} --text "${safe}" --as bot`,
    { encoding: 'utf8', timeout: 15000, stdio: 'pipe' });
}

// ── 主逻辑 ────────────────────────────────────────────────────────────────
function main() {
  // 1. 读全量数据
  const d = JSON.parse(fs.readFileSync(CLEAN_FILE, 'utf8'));

  const GMV          = parseFloat(d['GMV'])                    || 0;
  const PV           = parseFloat(d['大屏观看人数'])             || 0;
  const UV           = parseFloat(d['直播间观看人数'])           || PV;
  const buyers       = parseFloat(d['成交人数'])                 || 0;
  const orders       = parseFloat(d['大屏成交订单数'])           || 0;
  const fans         = parseFloat(d['涨粉数'])                   || 0;
  const fanRatio     = parseFloat(d['成交粉丝占比'])             || 0;
  const refundAmt    = parseFloat(d['退款金额'])                 || 0;
  const refundOrders = parseFloat(d['退款订单数'])               || 0;
  const qianch       = parseFloat(d['千川消耗'])                 || 0;
  const adCost       = parseFloat(d['直播间消耗_广告口径'])      || 0;
  const expose       = parseFloat(d['直播间曝光人数'])           || 0;
  const prodExpose   = parseFloat(d['商品曝光人数'])             || 0;
  const prodClick    = parseFloat(d['商品点击人数'])             || 0;
  const bjHour       = d['日期小时']  || '';
  const title        = d['直播标题']  || '';
  const duration     = d['直播时长']  || '';
  const isLive       = d['是否在播'];

  const totalAdCost  = qianch + adCost;
  const netGMV       = GMV - refundAmt;

  // 2. 转化漏斗
  const ct           = expose   > 0 ? UV / expose        : null;
  const prodCtr      = UV       > 0 ? prodClick / UV     : null;
  const clickConv    = prodClick > 0 ? buyers / prodClick : null;
  const fullConv     = expose   > 0 ? buyers / expose    : null;
  const uvConv       = UV       > 0 ? buyers / UV        : null;

  // 3. 变现指标
  const uvValue      = UV       > 0 ? netGMV / UV        : null;
  const gpm          = PV       > 0 ? (GMV / PV) * 1000  : null;
  const avgOrder     = buyers   > 0 ? netGMV / buyers    : null;
  const fanRate      = UV       > 0 ? fans / UV           : null;

  // 4. 退款/盈亏
  const refundOrderR = orders   > 0 ? refundOrders / orders  : null;
  const refundAmtR   = GMV      > 0 ? refundAmt / GMV        : null;
  const roiQianch    = qianch   > 0 ? netGMV / qianch        : null;
  const roiTotal     = totalAdCost > 0 ? netGMV / totalAdCost : null;

  // 5. 用户结构
  const newBuyerR    = 1 - fanRatio;
  const adRatio      = netGMV > 0 ? totalAdCost / netGMV : null;

  // 6. 投流效率
  const fanCost      = fans    > 0 ? totalAdCost / fans    : null;
  const buyCost      = buyers  > 0 ? totalAdCost / buyers  : null;
  const cpm          = expose  > 0 ? totalAdCost / expose * 1000 : null;

  // ── 读5分钟快照序列 ─────────────────────────────────────────────────────
  const hourPrefix = bjHour.substring(11, 13); // "14" from "2026-05-09_14"
  let snapshots = [];

  if (fs.existsSync(SNAP_DIR)) {
    const files = fs.readdirSync(SNAP_DIR)
      .filter(f => f.endsWith('.json') && f.startsWith(hourPrefix + '-'))
      .sort();
    snapshots = files.map(f => {
      try { return JSON.parse(fs.readFileSync(path.join(SNAP_DIR, f), 'utf8')); }
      catch(e) { return null; }
    }).filter(Boolean);
  }

  // 如果 snapshots 为空但有 snapshot_latest.json，用它作单点
  if (snapshots.length === 0 && fs.existsSync(SNAP_LATEST)) {
    try {
      const s = JSON.parse(fs.readFileSync(SNAP_LATEST, 'utf8'));
      snapshots = [s]; // 单点快照，显示最新状态
    } catch(e) {}
  }

  // ── 计算增量序列 ─────────────────────────────────────────────────────────
  const deltas = [];
  // 快照文件已存 d_gmv 等增量，直接读（不再 diff 相邻快照）
  for (let i = 0; i < snapshots.length; i++) {
    const cur = snapshots[i];
    const dGMV    = cur.d_gmv    ?? 0;
    const dWatch  = cur.d_watch  ?? 0;
    const dOrders = cur.d_orders ?? 0;
    const dFans   = cur.d_fans   ?? 0;
    const dGPM    = dWatch > 0 ? (dGMV / dWatch) * 1000 : null;
    const online  = cur.online_cnt ?? null;
    deltas.push({ time: cur.bjTime || cur.ts?.substring(11,16), dGMV, dWatch, dOrders, dFans, dGPM, online });
  }

  // ── 趋势分析 ─────────────────────────────────────────────────────────────
  let peakGMV = null, peakWatch = null;
  let noOrderStreak = 0, maxNoOrder = 0, curNoOrder = 0;
  let totalDGMV = 0;

  for (const dt of deltas) {
    if (dt.dGMV > (peakGMV?.dGMV ?? -Infinity)) peakGMV = dt;
    if (dt.dWatch > (peakWatch?.dWatch ?? -Infinity)) peakWatch = dt;
    totalDGMV += dt.dGMV;
    if (dt.dOrders === 0) {
      curNoOrder++;
      if (curNoOrder > maxNoOrder) maxNoOrder = curNoOrder;
    } else {
      curNoOrder = 0;
    }
  }

  // ── 组装飞书消息 ─────────────────────────────────────────────────────────
  const hh = bjHour.substring(11, 13);
  const dateStr = bjHour.substring(0, 10).replace(/_/g, '-');
  const liveStatus = isLive == 1 ? '🟢 直播中' : '⚫ 已下播';

  let msg = `📊 罗盘哨兵 · ${dateStr} ${hh}:00 小时报告 ${liveStatus}\n`;
  msg += `${title}  时长 ${duration}\n`;
  msg += `\n`;

  msg += `━━ 截至本小时 · 本场累计 ━━\n`;
  msg += `净GMV    ¥${n(netGMV)}    GMV ¥${n(GMV)}\n`;
  msg += `退款率   ${pct(refundAmtR)} ${flag(refundAmtR,'up',0.15)}   退款 ¥${n(refundAmt)}\n`;
  msg += `\n`;

  msg += `━━ 转化漏斗 ━━\n`;
  msg += `曝光→点击  ${pct(ct)}   ${flag(ct,'down',0.0,0.08)}\n`;
  msg += `点击→商品  ${pct(prodCtr)}   ${flag(prodCtr,'down',0.0,0.05)}\n`;
  msg += `商品→成交  ${pct(clickConv)}   ${flag(clickConv,'down',0.0,0.10)}\n`;
  msg += `全链路     ${pct(fullConv)}   ${flag(fullConv,'down',0.0,0.008)}\n`;
  msg += `\n`;

  msg += `━━ 变现效率 ━━\n`;
  msg += `GPM      ${n(gpm)}   ${gpm == null ? '' : gpm < 800 ? '🔴' : gpm > 6000 ? '✅' : ''}\n`;
  msg += `UV价值   ¥${n(uvValue,2)}\n`;
  msg += `整体转化  ${pct(uvConv)}\n`;
  msg += `客单价   ¥${n(avgOrder)}\n`;
  msg += `转粉率   ${pct(fanRate)}   ${fanRate != null && fanRate >= 0.03 ? '✅' : fanRate != null && fanRate < 0.02 ? '🔴' : ''}\n`;
  msg += `\n`;

  msg += `━━ 投流盈亏 ━━\n`;
  msg += `千川ROI  ${n(roiQianch,2)}   ${roiQianch != null ? (roiQianch < 1.5 ? '🔴' : roiQianch > 2.5 ? '✅' : '') : ''}\n`;
  msg += `千川消耗 ¥${n(qianch)}\n`;
  msg += `付费占比 ${pct(adRatio)}   ${flag(adRatio,'up',0.30)}\n`;
  msg += `新客占比 ${pct(newBuyerR)}   ${newBuyerR < 0.4 ? '🔴' : newBuyerR > 0.6 ? '✅' : ''}\n`;
  msg += `\n`;

  // ── 5分钟趋势部分 ────────────────────────────────────────────────────────
  if (deltas.length > 0) {
    msg += `━━ 本小时5分钟节奏（${deltas.length}个周期）━━\n`;
    for (const dt of deltas) {
      const bar = dt.dGMV > 0 ? '▇'.repeat(Math.min(Math.round(dt.dGMV / 200), 8)) : '▁';
      const onStr = dt.online != null ? ' 在线' + dt.online : '';
      msg += `${dt.time}  GMV+${n(dt.dGMV)} 观看+${dt.dWatch} 订单+${dt.dOrders}${onStr} ${bar}\n`;
    }
    if (peakGMV) msg += `峰值: ${peakGMV.time} GMV+¥${n(peakGMV.dGMV)}\n`;
    if (maxNoOrder > 0) msg += `⚠️  连续无出单最长: ${maxNoOrder * 5}分钟\n`;
    const onlines = deltas.map(d => d.online).filter(v => v != null);
    if (onlines.length > 0) {
      const avgOnline = Math.round(onlines.reduce((a,b)=>a+b,0) / onlines.length);
      const peakOnline = Math.max(...onlines);
      const peakOnlineTime = deltas.find(d => d.online === peakOnline)?.time || '--';
      msg += `均值在线 ${avgOnline}  峰值在线 ${peakOnline}（${peakOnlineTime}）\n`;
      // ASCII 竖条趋势图（8级）
      const BARS = '▁▂▃▄▅▆▇█';
      const maxO = Math.max(...onlines);
      const barStr = onlines.map(v => {
        if (maxO === 0) return '▁';
        return BARS[Math.min(7, Math.round((v / maxO) * 7))];
      }).join('');
      const firstTime = deltas.find(d => d.online != null)?.time || '--';
      const lastTime  = [...deltas].reverse().find(d => d.online != null)?.time || '--';
      msg += `在线▕${barStr}▏\n`;
      msg += `     ${firstTime.padEnd(barStr.length - lastTime.length, ' ')}${lastTime}\n`;
    }
  } else if (snapshots.length === 1) {
    const s = snapshots[0];
    msg += `━━ 最新快照（${s.bjTime || '--'}）━━\n`;
    msg += `累计 GMV ¥${n(s.gmv)}  观看 ${s.watch}  订单 ${s.orders}  涨粉 ${s.fans}\n`;
    msg += `GPM ${n(s.last_gpm)}  UV价值 ¥${n(s.last_uv_value,2)}\n`;
    msg += `（5分钟快照数据不足，下小时起将有完整趋势）\n`;
  } else {
    msg += `（本小时暂无5分钟快照数据）\n`;
  }

  console.log('========== 飞书消息预览 ==========');
  console.log(msg);
  console.log('==================================');

  larkSend(msg);
  console.log('[DONE] 小时报告已发送');
}

main();
