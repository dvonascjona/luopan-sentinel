'use strict';

const fs = require('fs');
const https = require('https');
const { spawnSync } = require('child_process');

const STORAGE_FILE = '/opt/douyin-fetcher/full_storage_state.json';
const LIVE_URL = 'https://compass.jinritemai.com/compass_api/author/live/live_detail/today_live_room';

function loadCookies() {
  const state = JSON.parse(fs.readFileSync(STORAGE_FILE, 'utf8'));
  const cookies = (state.cookies || [])
    .filter(c => ['jinritemai', 'douyin', 'bytedance'].some(d => (c.domain || '').includes(d)))
    .map(c => `${c.name}=${c.value}`)
    .join('; ');
  if (!cookies) throw new Error('full_storage_state.json 中没有可用 Cookie');
  return cookies;
}

function fetchLiveStatus(cookie) {
  return new Promise((resolve, reject) => {
    const req = https.get(LIVE_URL, {
      headers: {
        Cookie: cookie,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36',
        Referer: 'https://compass.jinritemai.com/',
        Origin: 'https://compass.jinritemai.com',
        Accept: 'application/json, */*',
      },
    }, res => {
      let body = '';
      res.on('data', chunk => (body += chunk));
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`today_live_room HTTP ${res.statusCode}: ${body.substring(0, 120)}`));
          return;
        }
        try { resolve(JSON.parse(body)); }
        catch (_) { reject(new Error(`today_live_room JSON解析失败: ${body.substring(0, 120)}`)); }
      });
    });
    req.setTimeout(15000, () => req.destroy(new Error('today_live_room timeout 15000ms')));
    req.on('error', reject);
  });
}

function classifyLiveResponse(response) {
  const cards = response?.data?.card_list;
  if (!Array.isArray(cards)) {
    throw new Error(
      `today_live_room schema mismatch: code=${response?.code ?? 'missing'} ` +
      `message=${response?.message ?? 'missing'} card_list非数组`
    );
  }
  const live = cards.find(card => Boolean(card.live_status));
  return {
    isLive: Boolean(live),
    liveId: live?.live_id || null,
    statuses: cards.map(card => card.live_status ?? null),
  };
}

async function main() {
  const separator = process.argv.indexOf('--');
  const command = separator >= 0 ? process.argv[separator + 1] : null;
  const args = separator >= 0 ? process.argv.slice(separator + 2) : [];
  if (!command) throw new Error('用法: node live_gate_exec.js -- <command> [args...]');

  const status = classifyLiveResponse(await fetchLiveStatus(loadCookies()));
  const bjTime = new Date(Date.now() + 8 * 3600 * 1000)
    .toISOString().replace('T', ' ').substring(0, 19);

  if (!status.isLive) {
    console.log(`[SKIP_NOT_LIVE] ${bjTime} BJT statuses=${JSON.stringify(status.statuses)} command=${command}`);
    return;
  }

  console.log(`[LIVE] ${bjTime} BJT live_id=${status.liveId} command=${command}`);
  const child = spawnSync(command, args, {
    cwd: __dirname,
    env: process.env,
    stdio: 'inherit',
  });
  if (child.error) throw child.error;
  if (child.signal) throw new Error(`${command} terminated by signal ${child.signal}`);
  if (child.status !== 0) process.exit(child.status ?? 1);
}

if (require.main === module) {
  main().catch(error => {
    console.error(`[LIVE_GATE_FATAL] ${error.message}`);
    process.exit(1);
  });
}

module.exports = { classifyLiveResponse };
