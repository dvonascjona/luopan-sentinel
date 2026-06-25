'use strict';
const fs   = require('fs');
const path = require('path');
const https = require('https');
const http  = require('http');

const LARK_WEBHOOK  = 'https://open.feishu.cn/open-apis/bot/v2/hook/d01ec0f5-5fcf-4ee3-aab2-e9f60b0b7fe0';
const STORAGE_FILE  = '/opt/douyin-fetcher/full_storage_state.json';
const SCREEN_CLEAN  = '/opt/douyin-fetcher/data/screen_clean.json';
const STATUS_FILE   = '/opt/douyin-fetcher/data/creative_status.json';
const AAVID         = '1845951364198153';

function bjNow() {
  return new Date(Date.now() + 8*3600*1000).toISOString().replace('T',' ').substring(0,16);
}

function postJson(url, body, headers) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const bodyStr = JSON.stringify(body);
    const opts = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: { 'Content-Type':'application/json', 'Content-Length': Buffer.byteLength(bodyStr), ...headers }
    };
    const lib = parsed.protocol === 'https:' ? https : http;
    const req = lib.request(opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode}: ${data.substring(0,200)}`));
        } else {
          try { resolve(JSON.parse(data)); } catch(e) { resolve({ raw: data }); }
        }
      });
    });
    req.on('error', reject);
    req.write(bodyStr);
    req.end();
  });
}

function larkSend(text) {
  return postJson(LARK_WEBHOOK, { msg_type:'text', content:{ text } }).catch(e => console.error('[LARK ERR]', e.message));
}

function getCookieStr() {
  const ss = JSON.parse(fs.readFileSync(STORAGE_FILE, 'utf8'));
  const jc = (ss.cookies || []).filter(c => c.domain && (c.domain.includes('jinritemai') || c.domain.includes('qianchuan')));
  return jc.map(c => c.name + '=' + c.value).join('; ');
}

function getTemplate(reqFrom) {
  const d = JSON.parse(fs.readFileSync(SCREEN_CLEAN, 'utf8'));
  const cr = d.creative_requests || [];
  const t = cr.find(c => c.reqFrom === reqFrom);
  if (!t) throw new Error('No template for reqFrom=' + reqFrom);
  return JSON.parse(t.postData);
}

async function fetchCreatives(cookieStr) {
  const pb = getTemplate('materialVideo');
  pb.PageParams = { Offset: 0, Limit: 100 };
  const url = 'https://qianchuan.jinritemai.com/ad/api/data/v1/common/statQuery?reqFrom=materialVideo&aavid=' + AAVID;
  const headers = {
    Cookie: cookieStr,
    Referer: 'https://qianchuan.jinritemai.com/board-next',
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
    Accept: 'application/json, text/plain, */*',
    Origin: 'https://qianchuan.jinritemai.com',
  };
  const res = await postJson(url, pb, headers);
  return (res.data && res.data.StatsData && res.data.StatsData.Rows) || [];
}

async function fetchTrend(cookieStr, materialId) {
  const pb = getTemplate('material_trend_video');
  const now = Date.now() + 8*3600*1000;
  const endTs = new Date(now);
  const startTs = new Date(now - 30*60*1000);
  pb.StartTime = startTs.toISOString().replace('T',' ').substring(0,19);
  pb.EndTime   = endTs.toISOString().replace('T',' ').substring(0,19);
  const matFilter = pb.Filters.Conditions.find(c => c.Field === 'material_id');
  if (matFilter) {
    matFilter.Values = [materialId];
  } else {
    pb.Filters.Conditions.push({ Field: 'material_id', Operator: 7, Values: [materialId] });
  }
  const url = 'https://qianchuan.jinritemai.com/ad/api/data/v1/common/statQuery?reqFrom=material_trend_video&aavid=' + AAVID;
  const headers = {
    Cookie: cookieStr,
    Referer: 'https://qianchuan.jinritemai.com/board-next',
    'User-Agent': 'Mozilla/5.0 Chrome/136.0.0.0',
    Accept: 'application/json, text/plain, */*',
    Origin: 'https://qianchuan.jinritemai.com',
  };
  const res = await postJson(url, pb, headers);
  return (res.data && res.data.StatsData && res.data.StatsData.Rows) || [];
}

function parseCreative(r) {
  const dim = r.Dimensions;
  const met = r.Metrics;
  return {
    id:     dim.material_id.Value,
    name:   dim.roi2_material_video_name.ValueStr,
    status: dim.material_heat_status_v2.ValueStr,
    cost:   met.stat_cost_for_roi2.Value,
    gmv:    met.total_pay_order_gmv_include_coupon_realtime_for_roi2.Value,
    roi:    met.total_pay_order_gmv_include_coupon_rate_realtime_for_roi2.Value,
    orders: met.total_pay_order_count_realtime_for_roi2.Value,
  };
}

function trendArrow(rows) {
  if (rows.length < 2) return '';
  const last  = rows[rows.length - 1].Metrics.stat_real_cost_for_overall_roi2.Value;
  const prev  = rows[rows.length - 2].Metrics.stat_real_cost_for_overall_roi2.Value;
  if (last > prev * 1.3) return ' 消耗↑↑';
  if (last > prev * 1.05) return ' 消耗↑';
  if (last < prev * 0.7) return ' 消耗↓↓';
  if (last < prev * 0.95) return ' 消耗↓';
  return '';
}

async function main() {
  console.log('[creative_check] ' + bjNow() + ' start');

  let cookieStr;
  try { cookieStr = getCookieStr(); } catch(e) { console.error('[ERR] Cookie load failed:', e.message); process.exit(1); }

  let rows;
  try { rows = await fetchCreatives(cookieStr); } catch(e) { console.error('[ERR] fetchCreatives failed:', e.message); process.exit(1); }

  const creatives = rows.map(parseCreative);
  const byStatus = {};
  for (const c of creatives) {
    (byStatus[c.status] = byStatus[c.status] || []).push(c);
  }

  let prev = {};
  try {
    if (fs.existsSync(STATUS_FILE)) {
      prev = JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8'));
    }
  } catch(e) { prev = {}; }

  const prevActive = new Set(Object.keys(prev));
  const currActive = new Map();
  for (const c of (byStatus['追投中'] || [])) currActive.set(c.id, c);

  const newlyActive = [...currActive.values()].filter(c => !prevActive.has(c.id));
  const nowPaused   = [...prevActive].filter(id => !currActive.has(id)).map(id => prev[id]);

  const newPrev = {};
  for (const [id, c] of currActive) newPrev[id] = { name: c.name, cost: c.cost, gmv: c.gmv, roi: c.roi };
  fs.writeFileSync(STATUS_FILE, JSON.stringify(newPrev, null, 2));
  console.log('[creative_check] active=' + currActive.size + ' new=' + newlyActive.length + ' paused=' + nowPaused.length);

  const msgs = [];

  if (newlyActive.length > 0) {
    for (const c of newlyActive) {
      let trendStr = '';
      try {
        const trows = await fetchTrend(cookieStr, c.id);
        trendStr = trendArrow(trows);
      } catch(e) { /* trend optional */ }
      msgs.push('🚀 新素材起量\n' + c.name.substring(0,25) + '\n消耗\xa5' + c.cost.toFixed(0) + '  GMV\xa5' + c.gmv.toFixed(0) + '  ROI ' + c.roi.toFixed(2) + trendStr);
    }
  }

  if (nowPaused.length > 0) {
    for (const c of nowPaused) {
      msgs.push('⏸️ 追投素材已暂停\n' + c.name.substring(0,25) + '\n之前 消耗\xa5' + c.cost.toFixed(0) + '  GMV\xa5' + c.gmv.toFixed(0));
    }
  }

  const active = [...currActive.values()].sort((a,b) => b.gmv - a.gmv);
  const topStr = active.slice(0, 3).map((c,i) =>
    (i+1) + '. ' + c.name.substring(0,18) + ' \xa5' + c.gmv.toFixed(0) + ' ROI' + c.roi.toFixed(2)
  ).join('\n');

  if (msgs.length > 0) {
    const time = bjNow();
    let fullMsg = '🌟 罗盘哨兵·素材预警 ' + time + '\n\n' + msgs.join('\n\n');
    if (active.length > 0) fullMsg += '\n\n📊 当前追投中 (' + active.length + '条)\n' + topStr;
    await larkSend(fullMsg);
    console.log('[LARK] Sent alert');
  } else {
    console.log('[INFO] No changes. 追投中: ' + active.length);
    if (active.length > 0) console.log(topStr);
  }
}

main().catch(e => { console.error('[FATAL]', e.message); process.exit(1); });
