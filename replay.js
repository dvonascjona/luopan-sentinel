const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ARCHIVE_DIR = '/opt/douyin-fetcher/data';
const REPLAY_LOG  = '/opt/douyin-fetcher/data/replay_log.json';
const CHAT_ID     = 'oc_af2b50b253a140dafe12c2d2a1acd9e9';

const FEISHU_APP_TOKEN  = process.env.FEISHU_APP_TOKEN  || '';
const FEISHU_TABLE_ID   = process.env.FEISHU_TABLE_ID   || '';
const FEISHU_UPSERT_KEY = process.env.FEISHU_UPSERT_KEY || '日期小时';

function loadReplayLog() {
  try { return JSON.parse(fs.readFileSync(REPLAY_LOG, 'utf8')); }
  catch(e) { return { written: [] }; }
}
function saveReplayLog(log) {
  fs.writeFileSync(REPLAY_LOG, JSON.stringify(log, null, 2));
}
function larkSend(msg) {
  try {
    execSync('lark-cli im +messages-send --chat-id '+CHAT_ID+' --text "'+msg.replace(/"/g,"'")+'" --as bot',
      { encoding:'utf8', timeout:10000, stdio:'pipe' });
  } catch(e) { console.log('lark err:', e.message.substring(0,60)); }
}

// 从归档里找第一个匹配 API，返回 body.data（或 body 本身）
function findApi(apis, keyword) {
  const a = apis.find(a => a.url && a.url.includes(keyword));
  if (!a) return null;
  const body = a.body || {};
  return (body.data !== undefined) ? body.data : body;
}

// 从 core_group_info.flow_index_list 按名称取值
function coreVal(list, name) {
  const item = (list||[]).find(i => i.index_display === name);
  return item ? (item.value || {}).value : null;
}

// 从 channel_flow 按渠道名取某字段的 value
function chanVal(rows, chanName, field) {
  if (!Array.isArray(rows)) return null;
  const row = rows.find(r => {
    const v = (r.cell_info||{}).channel_name?.channel_name_value?.value?.value_str;
    return v === chanName;
  });
  if (!row) return null;
  const node = (row.cell_info||{})[field];
  if (!node) return null;
  const inner = Object.values(node)[0];
  return inner?.index_values?.value?.value ?? null;
}

function extractFields(archiveData) {
  const allApis = [...(archiveData.step6_apis||[]), ...(archiveData.step7_apis||[])];

  // ── 基础 (today_live_room) ──
  const todayData = findApi(allApis, 'today_live_room');
  const cards = (todayData||{}).card_list || [];
  const live  = cards.find(c => c.live_status) || cards[0];
  if (!live) return null;

  // ── 核心总览 (core_group_info) ──
  const coreData = findApi(allApis, 'core_group_info') || {};
  const coreList = coreData.flow_index_list || [];

  // ── 流量漏斗 (flow_analysis，只取 st=0 的) ──
  const flowApi  = allApis.find(a => a.url && a.url.includes('flow_analysis') && (a.body||{}).st === 0);
  const flowData = flowApi ? (flowApi.body.data||{}) : {};
  const gmvChange = flowData.gmv_change || [];
  function flowVal(name) {
    const item = gmvChange.find(i => i.index_name === name);
    return item ? item.value.value : null;
  }
  const payItem = gmvChange.find(i => i.index_name === '成交人数');
  const kdcItem = (payItem?.sub_index||[]).find(i => i.index_name === '客单价');
  const gmvItem = (payItem?.sub_index||[]).find(i => i.index_name === '成交金额');

  // ── 渠道分析 (channel_flow) ──
  const chanRows = findApi(allApis, 'channel_flow');
  function cPay(ch) {
    const v = chanVal(chanRows, ch, 'pay_amt');
    return v != null ? +(v/100).toFixed(2) : null;
  }
  function cOrd(ch) { return chanVal(chanRows, ch, 'pay_cnt'); }
  const adCost = chanVal(chanRows, '整体', 'stat_cost');

  // ── 商品 top_product（7日结算） ──
  const topProd = findApi(allApis, 'top_product');
  const prod0 = (Array.isArray(topProd) ? topProd : [])[0] || {};
  function prodIdx(name) {
    return ((prod0.index_list||[]).find(i => i.index_name === name)||{}).value?.value ?? null;
  }

  // GMV 优先取 flow_analysis，回退 today_live_room
  const gmvRaw = gmvItem ? gmvItem.value.value : (live.pay_order_gmv?.value||0);

  return {
    日期小时:        archiveData.bjHour,
    更新时间:        archiveData.capturedAt,

    // 基础
    直播标题:        live.live_title || '',
    开播时间:        live.start_time || '',
    直播时长:        live.live_duration || '',
    是否在播:        live.live_status ? 1 : 0,

    // 核心总览（带7日中位对比）
    曝光次数:        coreVal(coreList, '直播间曝光次数'),
    曝光人数:        coreVal(coreList, '直播间曝光人数'),
    进入直播间人数:   coreVal(coreList, '进入直播间人数'),
    成交人数:        coreVal(coreList, '直播间成交人数'),
    平均在线:        coreVal(coreList, '平均在线人数'),
    最高在线:        coreVal(coreList, '最高在线人数'),
    观看成交转化率:   +(coreVal(coreList, '直播间观看-成交转化率(人数)')||0).toFixed(4),

    // 流量漏斗
    漏斗_曝光人数:   flowVal('直播间曝光人数'),
    漏斗_观看人数:   flowVal('直播间观看人数'),
    漏斗_商品曝光:   flowVal('商品曝光人数'),
    漏斗_商品点击:   flowVal('商品点击人数'),
    漏斗_成交人数:   flowVal('成交人数'),
    客单价:         kdcItem ? +(kdcItem.value.value/100).toFixed(2) : null,
    GMV:            +(gmvRaw/100).toFixed(2),

    // today_live_room 字段
    成交订单数:      live.pay_order_cnt?.value ?? null,
    涨粉:           live.incr_fans_cnt?.value  ?? null,

    // 渠道成交分解
    渠道_整体成交:   cPay('整体'),
    渠道_整体订单:   cOrd('整体'),
    渠道_推荐feed:   cPay('推荐feed'),
    渠道_短视频引流:  cPay('短视频引流'),
    渠道_搜索:       cPay('搜索'),
    渠道_商城推荐:   cPay('抖音商城推荐'),
    渠道_关注:       cPay('关注'),
    渠道_主页橱窗:   cPay('个人主页&店铺&橱窗'),
    渠道_其他:       cPay('其他'),
    广告消耗:        adCost != null ? +(adCost/100).toFixed(2) : null,

    // 商品（7日结算维度）
    商品结算成交额:   prodIdx('结算有效成交金额') != null ? +(prodIdx('结算有效成交金额')/100).toFixed(2) : null,
    商品退款额:      prodIdx('退款金额')          != null ? +(prodIdx('退款金额')/100).toFixed(2)         : null,
    商品结算成交人数: prodIdx('结算有效成交人数'),
  };
}

function writeToFeishu(fields) {
  if (!FEISHU_APP_TOKEN || !FEISHU_TABLE_ID) {
    console.log('[FEISHU] Config not set. Dry-run:');
    console.log(JSON.stringify(fields, null, 2));
    return false;
  }
  const record = JSON.stringify(fields);
  try {
    execSync(
      'lark-cli base +record-upsert --app-token '+FEISHU_APP_TOKEN+
      ' --table-id '+FEISHU_TABLE_ID+
      ' --key-field "'+FEISHU_UPSERT_KEY+'" --record \''+record.replace(/'/g, String.fromCharCode(39)+'\\'+String.fromCharCode(39)+String.fromCharCode(39))+'\'',
      { encoding:'utf8', timeout:30000, stdio:'pipe' }
    );
    console.log('[FEISHU] Written:', fields['日期小时']);
    return true;
  } catch(e) {
    console.error('[FEISHU] Write failed:', e.message.substring(0,100));
    return false;
  }
}

async function main() {
  const log     = loadReplayLog();
  const written = new Set(log.written);
  const files   = fs.readdirSync(ARCHIVE_DIR)
    .filter(f => /^\d{4}-\d{2}-\d{2}_\d{2}\.json$/.test(f))
    .sort();

  console.log('[REPLAY] Found', files.length, 'archive files');
  const missing = files.filter(f => !written.has(f.replace('.json', '')));
  console.log('[REPLAY]', missing.length, 'not yet written to Feishu');
  if (!missing.length) { console.log('[REPLAY] Nothing to replay.'); return; }

  let okCount = 0;
  const results = [];
  for (const file of missing) {
    const bjHour = file.replace('.json', '');
    try {
      const data   = JSON.parse(fs.readFileSync(path.join(ARCHIVE_DIR, file), 'utf8'));
      const fields = extractFields(data);
      if (!fields) { console.log('[REPLAY]', file, ': no live data, skip'); continue; }
      console.log('[REPLAY]', file, 'GMV='+fields.GMV, '曝光='+fields.曝光人数, '进入='+fields.进入直播间人数);
      const wrote = writeToFeishu(fields);
      if (wrote) { written.add(bjHour); okCount++; }
      results.push({ bjHour, fields, wrote });
    } catch(e) {
      console.error('[REPLAY]', file, 'error:', e.message);
    }
  }

  log.written = Array.from(written);
  log.lastReplay = new Date().toISOString();
  saveReplayLog(log);

  console.log('[REPLAY] Done:', okCount+'/'+missing.length, 'written');
  const feishuMsg = FEISHU_APP_TOKEN
    ? '📥 补录完成：'+okCount+'/'+missing.length+' 条写入飞书'
    : '📋 Dry-run：'+results.length+' 条\n'
      + results.map(r => '  '+r.bjHour+' GMV='+r.fields.GMV+' 曝光='+r.fields.曝光人数).join('\n');
  larkSend(feishuMsg);
}

main().catch(e => { console.error('[FATAL]', e.message); process.exit(1); });
