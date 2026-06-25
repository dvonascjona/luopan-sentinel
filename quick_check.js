'use strict';
/**
 * quick_check.js v2 — 直连大屏API，无 Playwright
 *
 * 三个直连接口：
 *   1. today_live_room  → room_id + 累计GMV/watch/orders（用于算增量）
 *   2. core_data        → GPM / 在线人数 / 转化率（平台实时值）
 *   3. five_min_data    → 近5分钟各指标 + change_value（平台算好的环比）
 *
 * 正常消息：4行基础增量
 * 预警消息：基础摘要 + 富文本信号行（带emoji + 当前←上期）
 */
const fs   = require('fs');
const https = require('https');
const { execSync } = require('child_process');

const STORAGE_FILE  = '/opt/douyin-fetcher/full_storage_state.json';
const SNAPSHOT_FILE = '/opt/douyin-fetcher/data/snapshot_latest.json';
const CHAT_ID       = 'oc_af2b50b253a140dafe12c2d2a1acd9e9';

// 预警阈值（change_value 是小数，-0.60 = -60%）
const THR = {
  flow_drop:     -0.60,   // 在线人数环比下滑 60%
  flow_surge:     0.80,   // 在线人数环比飙升 80%
  gmv_drop:      -0.70,   // 近5min GMV 环比下滑 70%
  uv_drop:       -0.50,   // UV价值环比下滑 50%
  no_order_periods: 3,    // 连续 N 期无出单
  roi_min:        1.5,    // 小时ROI参考下限
};

// ── Cookie 提取 ───────────────────────────────────────────────────────────────
function loadCookies() {
  const state = JSON.parse(fs.readFileSync(STORAGE_FILE, 'utf8'));
  return (state.cookies || [])
    .filter(c => ['jinritemai', 'douyin', 'bytedance'].some(d => (c.domain || '').includes(d)))
    .map(c => `${c.name}=${c.value}`)
    .join('; ');
}

// ── HTTP GET（返回解析后的 JSON body）────────────────────────────────────────
function httpGet(url, cookieStr, referer) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: {
        Cookie: cookieStr,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36',
        Referer: referer || 'https://compass.jinritemai.com/',
        Origin: 'https://compass.jinritemai.com',
        Accept: 'application/json, */*',
        'Accept-Language': 'zh-CN,zh;q=0.9',
      },
    }, res => {
      let body = '';
      res.on('data', c => (body += c));
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch (e) { reject(new Error('JSON parse failed: ' + body.substring(0, 80))); }
      });
    }).on('error', reject);
  });
}

// ── Lark 通知 ─────────────────────────────────────────────────────────────────
function larkSend(msg) {
  try {
    execSync(
      `lark-cli im +messages-send --chat-id ${CHAT_ID} --text "${msg.replace(/"/g, "'")}"  --as bot`,
      { encoding: 'utf8', timeout: 10000, stdio: 'pipe' }
    );
  } catch (e) {
    console.log('lark err:', e.message.substring(0, 80));
  }
}

// ── 工具 ─────────────────────────────────────────────────────────────────────
const signed = (n, d = 0) => n == null ? '--' : (n >= 0 ? '+' : '') + n.toFixed(d);

// five_min_data card 按 index_display 建索引
function buildCardIndex(card) {
  const idx = {};
  for (const item of (card || [])) idx[item.index_display] = item;
  return idx;
}

// 从 core_data 数组按 index_name 取值
function coreVal(coreData, name) {
  const item = (coreData || []).find(i => i.index_name === name);
  return item ? item.value.value : null;
}

// ── 主逻辑 ────────────────────────────────────────────────────────────────────
async function main() {
  const now = new Date();
  const bjt = new Date(now.getTime() + 8 * 3600 * 1000);
  const label = bjt.toISOString().replace('T', ' ').substring(0, 16) + ' BJT';
  console.log(`\n[QUICK] ${label}`);

  const cookie = loadCookies();

  // ── 1. today_live_room → 直播状态 + 累计GMV/watch/orders ──
  const listRes = await httpGet(
    'https://compass.jinritemai.com/compass_api/author/live/live_detail/today_live_room',
    cookie
  );
  const cards   = listRes?.data?.card_list || [];
  const live    = cards.find(c => c.live_status) || cards[0];

  if (!live) { console.log('[QUICK] 无直播数据，跳过'); return; }
  if (!live.live_status) {
    // 检测刚下播：上次快照有 live_id 且未标记 ended → 发下播通知
    if (fs.existsSync(SNAPSHOT_FILE)) {
      try {
        const snap = JSON.parse(fs.readFileSync(SNAPSHOT_FILE, 'utf8'));
        if (snap.live_id && !snap.ended) {
          const finalGMV    = (live.pay_order_gmv?.value  || 0) / 100;
          const finalOrders = live.pay_order_cnt?.value   || 0;
          const finalWatch  = live.watch_ucnt?.value      || 0;
          const netGMV      = (live.real_pay_order_gmv?.value || live.pay_order_gmv?.value || 0) / 100;
          const refund      = (live.refund_order_gmv?.value || 0) / 100;
          const endMsg = [
            '🔴 直播已结束 ' + label,
            '',
            'GMV       ¥' + finalGMV.toFixed(0),
            '净GMV     ¥' + netGMV.toFixed(0),
            '退款      ¥' + refund.toFixed(0),
            '总订单    ' + finalOrders,
            '总观看    ' + finalWatch,
          ].join('\n');
          larkSend(endMsg);
          fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify({ ...snap, ended: true }, null, 2));
          console.log('[QUICK] 下播通知已发送');
        }
      } catch (e) { console.log('[WARN] 下播检测快照读取失败:', e.message); }
    }
    console.log('[QUICK] 直播已结束，跳过');
    return;
  }

  const roomId  = live.live_id;
  const cumGMV  = (live.pay_order_gmv?.value || 0) / 100;
  const cumWatch = live.watch_ucnt?.value  || 0;
  const cumOrders = live.pay_order_cnt?.value || 0;
  console.log(`[LIST] room=${roomId} GMV=¥${cumGMV} watch=${cumWatch} orders=${cumOrders}`);

  const screenRef = `https://compass.jinritemai.com/screen/live/talent/live_room_id=${roomId}`;

  // ── 2. core_data → 平台实时 GPM / 在线人数 / 转化率 ──
  const coreRes = await httpGet(
    `https://compass.jinritemai.com/compass_api/author/live/live_screen/core_data?room_id=${roomId}&index_selected=gpm,pay_ucnt,watch_pay_ucnt_ratio,online_user_cnt,follow_anchor_ucnt`,
    cookie, screenRef
  );
  const coreData = coreRes?.data?.core_data || [];
  const gpm        = coreVal(coreData, 'gpm');           // 千次观看成交金额（元）
  const onlineCnt  = coreVal(coreData, 'online_user_cnt');
  const convRate   = coreVal(coreData, 'watch_pay_ucnt_ratio'); // 观看→成交率
  const payUcnt    = coreVal(coreData, 'pay_ucnt');      // 累计成交人数
  console.log(`[CORE] GPM=${gpm?.toFixed(0)} online=${onlineCnt} conv=${convRate ? (convRate*100).toFixed(2)+'%' : '--'}`);

  // ── 3. five_min_data → 近5分钟增量 + 平台环比 ──
  const fiveRes = await httpGet(
    `https://compass.jinritemai.com/compass_api/content_live/author/live_screen/five_min_data?room_id=${roomId}`,
    cookie, screenRef
  );
  const card5 = buildCardIndex(fiveRes?.data?.card || []);

  const gmv5raw    = card5['成交金额']?.value?.value   ?? null;  // 近5min GMV（单位待确认，用于环比信号）
  const enter5     = card5['进入人数']?.value?.value   ?? null;  // 近5min 进入人数
  const fans5      = card5['新增粉丝数']?.value?.value ?? null;  // 近5min 涨粉
  const online5    = card5['在线人数']?.value?.value   ?? null;  // 近5min 在线
  const uvVal5     = card5['UV价值']?.value?.value     ?? null;  // 近5min UV价值

  // 平台算好的环比（-0.5 = -50%），直接用，不再手动算
  const flowChange = card5['在线人数']?.change_value?.value  ?? null;
  const gmvChange  = card5['成交金额']?.change_value?.value  ?? null;
  const uvChange   = card5['UV价值']?.change_value?.value    ?? null;
  const enterChange = card5['进入人数']?.change_value?.value ?? null;

  console.log(`[5MIN] enter=${enter5} online=${online5} fans=${fans5}`);
  console.log(`[CHANGE] flow=${flowChange !== null ? (flowChange*100).toFixed(0)+'%' : '--'} gmv=${gmvChange !== null ? (gmvChange*100).toFixed(0)+'%' : '--'} uv=${uvChange !== null ? (uvChange*100).toFixed(0)+'%' : '--'}`);

  // ── 快照：读上期累计值算增量 ──────────────────────────────────────────────
  let prev = null;
  let noOrderPeriods = 0;

  if (fs.existsSync(SNAPSHOT_FILE)) {
    try {
      const snap = JSON.parse(fs.readFileSync(SNAPSHOT_FILE, 'utf8'));
      if (snap.live_id === roomId) {
        prev           = snap;
        noOrderPeriods = snap.no_order_periods ?? 0;
      }
    } catch (e) { console.log('[WARN] 快照读取失败'); }
  }

  if (!prev) {
    fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify({
      ts: now.toISOString(), live_id: roomId,
      gmv: cumGMV, watch: cumWatch, orders: cumOrders,
      no_order_periods: 0,
    }, null, 2));
    console.log('[QUICK] 首次运行，快照已保存');
    return;
  }

  const dGMV   = cumGMV    - prev.gmv;
  const dWatch = cumWatch  - prev.watch;
  const dOrders = cumOrders - prev.orders;
  // 近5min涨粉优先用 five_min_data（更实时），回退用累计 delta
  const dFans  = fans5 !== null ? fans5 : 0;

  console.log(`[DELTA] GMV${signed(dGMV)} watch${signed(dWatch)} orders${signed(dOrders)} fans${signed(dFans)}`);

  noOrderPeriods = dOrders === 0 ? noOrderPeriods + 1 : 0;

  // ── 预警信号（平台 change_value + 我们的逻辑）────────────────────────────
  const richSignals = [];

  if (flowChange !== null && flowChange < THR.flow_drop)
    richSignals.push(`🌊 进人流速下滑 ${Math.abs(flowChange * 100).toFixed(0)}%，平台推流减弱`);

  if (flowChange !== null && flowChange > THR.flow_surge)
    richSignals.push(`🚀 进人流速飙升 ${(flowChange * 100).toFixed(0)}%，流量爆发`);

  if (gmvChange !== null && gmvChange < THR.gmv_drop)
    richSignals.push(`📉 近5min GMV 环比下滑 ${Math.abs(gmvChange * 100).toFixed(0)}%`);

  if (uvChange !== null && uvChange < THR.uv_drop)
    richSignals.push(`💲 UV价值环比下滑 ${Math.abs(uvChange * 100).toFixed(0)}%（当前 ¥${uvVal5?.toFixed(1) ?? '--'}）`);

  if (convRate !== null && cumWatch > 0 && convRate < 0.005)
    richSignals.push(`⚠️ 转化率偏低 ${(convRate * 100).toFixed(2)}%`);

  if (noOrderPeriods >= THR.no_order_periods)
    richSignals.push(`❌ 连续 ${noOrderPeriods} 期（${noOrderPeriods * 5}min）无出单`);

  // ── 近N期在线迷你趋势图 ──────────────────────────────────────────────────
  const SNAP_DIR_QC = '/opt/douyin-fetcher/data/snapshots';
  let recentOnlines = [];
  if (fs.existsSync(SNAP_DIR_QC)) {
    try {
      const files = fs.readdirSync(SNAP_DIR_QC).filter(f => f.endsWith('.json')).sort();
      for (const f of files.slice(-6)) {
        const s = JSON.parse(fs.readFileSync(SNAP_DIR_QC + '/' + f, 'utf8'));
        if (s.online_cnt != null) recentOnlines.push(s.online_cnt);
      }
    } catch(e) { /* ignore */ }
  }
  // 加入本期当前值
  const curOnline = online5 !== null ? online5 : (onlineCnt !== null ? onlineCnt : null);
  if (curOnline !== null) recentOnlines.push(curOnline);
  if (recentOnlines.length > 7) recentOnlines = recentOnlines.slice(-7);

  let miniChart = '';
  if (recentOnlines.length >= 2) {
    const BARS = '▁▂▃▄▅▆▇█';
    const maxO = Math.max(...recentOnlines);
    const barStr = recentOnlines.map(v => maxO === 0 ? '▁' : BARS[Math.min(7, Math.round((v / maxO) * 7))]).join('');
    miniChart = `在线▕${barStr}▏`;
  }

  // ── 消息组装 ─────────────────────────────────────────────────────────────
  const gmvStr = dGMV >= 0 ? `+¥${dGMV.toFixed(0)}` : `-¥${Math.abs(dGMV).toFixed(0)}`;

  let msg;
  if (richSignals.length === 0) {
    msg = [
      `🔔 罗盘哨兵 ${label}`,
      ``,
      `5min  GMV ${gmvStr}`,
      `观看  ${enter5 !== null ? '+' + enter5 : signed(dWatch)}`,
      miniChart || `在线  ${online5 !== null ? online5 : (onlineCnt !== null ? onlineCnt : '--')}`,
      `订单  ${signed(dOrders)}`,
      `涨粉  ${signed(dFans)}`,
    ].join('\n');
  } else {
    const basicLine = `GMV ${gmvStr}，观看 ${enter5 !== null ? '+' + enter5 : signed(dWatch)}，在线 ${online5 !== null ? online5 : (onlineCnt !== null ? onlineCnt : '--')}，订单 ${signed(dOrders)}，涨粉 ${signed(dFans)}`;
    msg = [
      `🚨 罗盘哨兵 ${label}`,
      ``,
      basicLine,
      ``,
      ...richSignals,
      ...(miniChart ? ['', miniChart] : []),
    ].join('\n');
  }

  larkSend(msg);
  console.log(`[SENT] ${richSignals.length > 0 ? '预警 ' + richSignals.length + '条' : '正常播报'}`);

  // ── 快照写入（含全量指标，供小时报告）────────────────────────────────────
  fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify({
    ts: now.toISOString(), live_id: roomId,
    gmv: cumGMV, watch: cumWatch, orders: cumOrders,
    no_order_periods: noOrderPeriods,
    gpm, online_cnt: onlineCnt, conv_rate: convRate, pay_ucnt: payUcnt,
    enter_5min: enter5, fans_5min: fans5,
    flow_change: flowChange, gmv_change: gmvChange, uv_change: uvChange,
  }, null, 2));

  // 带时间戳快照，供小时报告读取趋势序列
  const bjSnap = new Date(Date.now() + 8 * 3600 * 1000);
  const hhmm   = bjSnap.toISOString().substring(11, 16).replace(':', '-');
  const snapDir = '/opt/douyin-fetcher/data/snapshots';
  if (!fs.existsSync(snapDir)) fs.mkdirSync(snapDir, { recursive: true });
  fs.writeFileSync(`${snapDir}/${hhmm}.json`, JSON.stringify({
    ts: now.toISOString(), bjTime: hhmm.replace('-', ':'),
    live_id: roomId,
    d_gmv: dGMV, d_watch: dWatch, d_orders: dOrders, d_fans: dFans,
    gpm, online_cnt: onlineCnt, conv_rate: convRate,
    enter_5min: enter5, flow_change: flowChange, gmv_change: gmvChange,
  }, null, 2));
}

main().catch(err => {
  console.error('[FATAL]', err.message);
  process.exit(1);
});
