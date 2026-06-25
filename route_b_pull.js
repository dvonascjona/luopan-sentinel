'use strict';
const fs   = require('fs');
const path = require('path');
const https = require('https');

const STORAGE     = '/opt/douyin-fetcher/full_storage_state.json';
const SCREEN_CLEAN = '/opt/douyin-fetcher/data/screen_clean.json';
const OUT_FILE    = '/opt/douyin-fetcher/data/route_b_clean.json';
const AAVID       = '1845951364198153';
const BASE        = 'qianchuan.jinritemai.com';
const PATH_QC     = '/ad/api/data/v1/common/statQuery';

// cookie 从 storageState 读
const state   = JSON.parse(fs.readFileSync(STORAGE, 'utf8'));
const cookies = state.cookies
  .filter(c => c.domain && c.domain.includes('jinritemai'))
  .map(c => `${c.name}=${c.value}`)
  .join('; ');

// postData 模板从 screen_clean.json 读
const sc = JSON.parse(fs.readFileSync(SCREEN_CLEAN, 'utf8'));
const TARGETS = ['commonMetricCard', 'totalTrend', 'funnelModule'];
const templates = {};
for (const req of (sc.creative_requests || [])) {
  const rf = req.reqFrom;
  if (TARGETS.includes(rf) && !templates[rf]) {
    templates[rf] = JSON.parse(req.postData);
  }
}

function postJSON(reqFrom, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const opts = {
      hostname: BASE,
      path: `${PATH_QC}?reqFrom=${reqFrom}&aavid=${AAVID}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        'Cookie': cookies,
        'Referer': 'https://qianchuan.jinritemai.com/',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Origin': 'https://qianchuan.jinritemai.com',
      },
    };
    const req = https.request(opts, res => {
      let buf = '';
      res.on('data', d => buf += d);
      res.on('end', () => {
        try { resolve(JSON.parse(buf)); }
        catch(e) { reject(new Error(`parse fail: ${buf.slice(0,100)}`)); }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('timeout')); });
    req.write(payload);
    req.end();
  });
}

// 解析 Rows → 扁平对象
function parseRows(rows) {
  if (!Array.isArray(rows) || !rows.length) return null;
  // 无 Dimensions → 单行汇总
  if (!rows[0].Dimensions || !Object.keys(rows[0].Dimensions).length) {
    const out = {};
    for (const [k, v] of Object.entries(rows[0].Metrics || {})) {
      out[k] = v.ValueStr ?? v.Value;
    }
    return out;
  }
  // 有 Dimensions → 时序数组
  return rows.map(r => {
    const dim = Object.fromEntries(
      Object.entries(r.Dimensions || {}).map(([k, v]) => [k, v.ValueStr ?? v.Value])
    );
    const met = Object.fromEntries(
      Object.entries(r.Metrics || {}).map(([k, v]) => [k, v.ValueStr ?? v.Value])
    );
    return { ...dim, ...met };
  });
}

async function main() {
  const bjNow = new Date(Date.now() + 8 * 3600 * 1000);
  const bjTime = bjNow.toISOString().replace('T', ' ').substring(0, 19);
  const result = { capturedAt: new Date().toISOString(), bjTime };

  for (const rf of TARGETS) {
    if (!templates[rf]) { console.log(`[SKIP] ${rf}: no template`); continue; }
    try {
      const resp = await postJSON(rf, templates[rf]);
      const rows = resp?.data?.StatsData?.Rows;
      if (!rows) {
        console.log(`[FAIL] ${rf}: no Rows, code=${resp?.code}, msg=${resp?.message}`);
        result[rf] = { error: resp?.message || 'no data' };
        continue;
      }
      result[rf] = parseRows(rows);
      const count = Array.isArray(result[rf]) ? `${result[rf].length} rows` : 'summary';
      console.log(`[OK] ${rf}: ${count}`);
    } catch(e) {
      console.log(`[ERR] ${rf}: ${e.message}`);
      result[rf] = { error: e.message };
    }
  }

  fs.writeFileSync(OUT_FILE, JSON.stringify(result, null, 2));
  console.log(`[SAVED] ${OUT_FILE}`);
}

main().catch(e => { console.error('[FATAL]', e.message); process.exit(1); });
