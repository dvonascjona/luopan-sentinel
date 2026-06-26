#!/usr/bin/env node
// 直播数据清洗管线 — 从 n8n Code 节点迁出的独立脚本
// 用法: node clean_live_data.js [可选输出路径]
//   无参数  -> 写正式 live_clean.json + memoh 共享副本
//   带路径  -> dry-run，只写到指定路径，不碰 memoh（用于迁移前 diff 验证）
// 来源: n8n 工作流 5wha4FMrZzhOWyye「🔧 直播数据清洗管线」Code 节点，逻辑零改动

const fs   = require('fs');
const path = require('path');

const ARCHIVE_DIR    = '/opt/douyin-fetcher/data';
const SUMMARY_FILE   = '/opt/douyin-fetcher/data/screen_summary.json';
const MEMOH_FILE     = '/opt/1panel/apps/memoh-service-node/data/shared/live_clean.json';

const OUT_OVERRIDE = process.argv[2] || null;                 // dry-run 输出路径
const CLEAN_FILE   = OUT_OVERRIDE || '/opt/douyin-fetcher/data/live_clean.json';

const files = fs.readdirSync(ARCHIVE_DIR)
  .filter(f => /^\d{4}-\d{2}-\d{2}_\d{2}\.json$/.test(f)).sort();
if (!files.length) throw new Error('No archive files found');
const latestFile = files[files.length - 1];
const raw = JSON.parse(fs.readFileSync(path.join(ARCHIVE_DIR, latestFile), 'utf8'));

function findApi(apis, kw) {
  const a = (apis||[]).find(a => a.url && a.url.includes(kw));
  if (!a) return null;
  const b = a.body || {};
  return b.data !== undefined ? b.data : b;
}
function coreVal(list, name) {
  const i = (list||[]).find(i => i.index_display === name);
  return i ? (i.value||{}).value : null;
}
function chanVal(rows, ch, field) {
  if (!Array.isArray(rows)) return null;
  const row = rows.find(r =>
    (r.cell_info||{}).channel_name?.channel_name_value?.value?.value_str === ch
  );
  if (!row) return null;
  const n = (row.cell_info||{})[field];
  if (!n) return null;
  return Object.values(n)[0]?.index_values?.value?.value ?? null;
}
function portraitVal(list, name) {
  const i = (list||[]).find(i => i.index_display === name);
  return i ? (i.value||{}).value : null;
}
function nestedGroupVal(groups, name) {
  for (const g of (groups||[])) {
    for (const sub of (g.index_group||[])) {
      if (sub.index_display === name) return (sub.value||{}).value ?? null;
    }
  }
  return null;
}
function adCoreVal(list, name) {
  const i = (list||[]).find(i => i.index_display === name);
  return i ? (i.value||{}).value : null;
}
function tradeListVal(list, name) {
  const i = (list||[]).find(i => i.index_display === name);
  return i ? (i.value||{}).value : null;
}
function findAccountName(apis) {
  for (const api of (apis || [])) {
    const body = api?.body || {};
    const data = body.data !== undefined ? body.data : body;
    if (typeof data?.account_name === 'string' && data.account_name.trim()) return data.account_name.trim();
    const firstLogin = Array.isArray(data?.login_subject_list) ? data.login_subject_list[0] : null;
    if (typeof firstLogin?.account_name === 'string' && firstLogin.account_name.trim()) return firstLogin.account_name.trim();
  }
  return '';
}
function formatHourLabel(bjHour) {
  const m = /^(\d{4}-\d{2}-\d{2})_(\d{2})$/.exec(bjHour || '');
  return m ? m[1]+' '+m[2]+':00' : (bjHour || '');
}

const allApis = [...(raw.step6_apis||[]), ...(raw.step7_apis||[])];
const cards   = (findApi(allApis,'today_live_room')||{}).card_list || [];
const live    = cards.find(c => c.live_status) || cards[0];
if (!live) throw new Error('No live card in ' + latestFile);

const coreGroupData = findApi(allApis,'core_group_info') || {};
const coreList      = coreGroupData.flow_index_list || [];
const portraitList  = coreGroupData.portrait_index_list || [];
const indexGroups   = coreGroupData.index_group || [];

const flowApi   = allApis.find(a => a.url && a.url.includes('flow_analysis') && (a.body||{}).st===0);
const gmvChange = flowApi ? ((flowApi.body.data||{}).gmv_change||[]) : [];
const payItem   = gmvChange.find(i => i.index_name==='成交人数');
const kdcItem   = (payItem?.sub_index||[]).find(i => i.index_name==='客单价');
const gmvItem   = (payItem?.sub_index||[]).find(i => i.index_name==='成交金额');
const chanRows  = findApi(allApis,'channel_flow');
const tradeList = (findApi(allApis,'trade_info')||{}).trade_list || [];
const adApiBody  = (() => { const a = allApis.find(a => a.url && a.url.includes('live_room/ad')); return a ? (a.body?.data ?? a.body ?? {}) : {}; })();
const adCoreData = adApiBody.core_data || [];
const topList = (Array.isArray(findApi(allApis,'top_product')) ? findApi(allApis,'top_product') : [])[0]?.index_list || [];

function flowVal(n) { const i=gmvChange.find(i=>i.index_name===n); return i?i.value.value:null; }
function cPay(ch)   { const v=chanVal(chanRows,ch,'pay_amt'); return v!=null?Math.round(v)/100:null; }
function prodIdx(name) { return (topList.find(i=>i.index_name===name)||{}).value?.value??null; }

const gmvRaw = gmvItem ? gmvItem.value.value : (live.pay_order_gmv?.value||0);
const accountName = findAccountName(allApis);
const titleWithTime = formatHourLabel(raw.bjHour)+accountName;

const clean = {
  日期小时:raw.bjHour, 更新时间:raw.capturedAt, 归档文件:latestFile,
  直播标题:titleWithTime, 开播时间:live.start_time||'',
  直播时长:live.live_duration||'', 是否在播:live.live_status?1:0,

  GMV: Math.round(gmvRaw)/100,
  大屏观看人数: live.watch_ucnt?.value ?? null,
  大屏成交人数: coreVal(coreList,'直播间成交人数'),
  大屏成交订单数: live.pay_order_cnt?.value ?? null,
  涨粉数: live.incr_fans_cnt?.value ?? null,

  直播间曝光人数: coreVal(coreList,'直播间曝光人数'),
  直播间观看人数: flowVal('直播间观看人数'),
  商品曝光人数: flowVal('商品曝光人数'),
  商品点击人数: flowVal('商品点击人数'),
  成交人数: flowVal('成交人数'),
  客单价: kdcItem ? Math.round(kdcItem.value.value)/100 : null,
  观看成交转化率: parseFloat((coreVal(coreList,'直播间观看-成交转化率(人数)')||0).toFixed(4)),

  退款金额: tradeListVal(tradeList,'退款金额') != null ? Math.round(tradeListVal(tradeList,'退款金额'))/100 : null,
  退款订单数: nestedGroupVal(indexGroups,'退款订单数'),

  千川消耗: (()=>{ const v=chanVal(chanRows,'整体','stat_cost'); return v!=null?Math.round(v)/100:null; })(),
  直播间消耗_广告口径: adCoreVal(adCoreData,'直播间消耗') != null ? Math.round(adCoreVal(adCoreData,'直播间消耗'))/100 : null,

  成交粉丝占比: portraitVal(portraitList,'粉丝成交人数占比'),

  渠道_整体成交: cPay('整体'), 渠道_整体订单: chanVal(chanRows,'整体','pay_cnt'),
  渠道_推荐feed: cPay('推荐feed'), 渠道_短视频引流: cPay('短视频引流'),
  渠道_搜索: cPay('搜索'), 渠道_商城推荐: cPay('抖音商城推荐'),
  渠道_关注: cPay('关注'), 渠道_主页橱窗: cPay('个人主页&店铺&橱窗'), 渠道_其他: cPay('其他'),

  曝光次数: coreVal(coreList,'直播间曝光次数'),
  平均在线: coreVal(coreList,'平均在线人数'),
  最高在线: coreVal(coreList,'最高在线人数'),
  商品结算成交额: prodIdx('结算有效成交金额')!=null ? Math.round(prodIdx('结算有效成交金额'))/100 : null,
  商品退款额: prodIdx('退款金额')!=null ? Math.round(prodIdx('退款金额'))/100 : null,
  商品结算成交人数: prodIdx('结算有效成交人数'),
};

// screen_summary.json merge
let summaryExtra = {};
try {
  summaryExtra = JSON.parse(fs.readFileSync(SUMMARY_FILE, 'utf8'));
  console.log('[SUMMARY] loaded ' + Object.keys(summaryExtra).length + ' fields, bjHour=' + summaryExtra.bjHour);
} catch(e) {
  console.log('[SUMMARY] skip: ' + e.message);
}

const cleanFull = Object.assign({}, clean, summaryExtra);

fs.writeFileSync(CLEAN_FILE, JSON.stringify(cleanFull, null, 2));
console.log('[CLEAN] ' + Object.keys(cleanFull).length + ' fields -> ' + CLEAN_FILE + ' (archive=' + latestFile + ')');

if (!OUT_OVERRIDE) {
  // 正式运行才写 memoh 共享副本；dry-run 不污染
  try {
    fs.writeFileSync(MEMOH_FILE, JSON.stringify(cleanFull, null, 2));
    console.log('[CLEAN] Written to memoh shared');
  } catch(e) {
    console.log('[WARN] memoh write failed: ' + e.message);
  }
}
