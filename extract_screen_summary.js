"use strict";
const fs = require('fs');

const SCREEN_CLEAN  = '/opt/douyin-fetcher/data/screen_clean.json';
const ROUTE_B_CLEAN = '/opt/douyin-fetcher/data/route_b_clean.json';
const SUMMARY_FILE  = '/opt/douyin-fetcher/data/screen_summary.json';

const sc = JSON.parse(fs.readFileSync(SCREEN_CLEAN, 'utf8'));
const rb = fs.existsSync(ROUTE_B_CLEAN)
  ? JSON.parse(fs.readFileSync(ROUTE_B_CLEAN, 'utf8'))
  : {};

function endpointName(url) {
  try {
    return new URL(url).pathname.split('/').pop();
  } catch {
    return (url || '').split('?')[0].split('/').pop();
  }
}

function findScreenBodies(apis, endpoint) {
  return (apis || [])
    .filter(a => endpointName(a.url) === endpoint)
    .map(a => a.body)
    .filter(Boolean);
}

function coreMetricValue(bodies, name) {
  for (const body of (bodies || [])) {
    const items = body?.data?.core_data || [];
    const hit = items.find(item => item.index_name === name);
    const value = hit?.value?.value;
    if (value != null) return value;
  }
  return null;
}

function fiveCardValue(cards, names) {
  for (const name of names) {
    const hit = (cards || []).find(item => item.index_display === name || item.index_name === name);
    if (!hit) continue;
    return {
      value: hit?.value?.value ?? hit?.index_value?.value ?? null,
      change: hit?.change_value?.value ?? null,
    };
  }
  return null;
}

const sApis = sc.screen_apis || [];
const summary = { bjHour: sc.bjHour, capturedAt: sc.capturedAt };

const lbi = findScreenBodies(sApis, 'live_base_info').slice(-1)[0] || {};
if (lbi.st === 0 && lbi.data) {
  summary.screen_live_status = lbi.data.live_status;
  summary.screen_start_time  = lbi.data.live_start_time;
  summary.screen_is_ecom     = lbi.data.is_ecom_room;
}

const coreBodies = findScreenBodies(sApis, 'core_data');
const coreMain = coreBodies.find(body => body?.st === 0 && body?.data?.pay_amt) || coreBodies[0] || {};
if (coreMain.st === 0 && coreMain.data) {
  const d = coreMain.data;
  summary.screen_GMV      = d.pay_amt?.value      != null ? Math.round(d.pay_amt.value * 100) / 100 : null;
  summary.screen_real_GMV = d.real_pay_amt?.value != null ? Math.round(d.real_pay_amt.value * 100) / 100 : null;
}
summary.screen_GPM            = coreMetricValue(coreBodies, 'gpm');
summary.screen_pay_ucnt       = coreMetricValue(coreBodies, 'pay_ucnt');
summary.screen_pay_combo_cnt  = coreMetricValue(coreBodies, 'pay_combo_cnt');
summary.screen_watch_pay_rate = coreMetricValue(coreBodies, 'watch_pay_ucnt_ratio');
summary.screen_online_cnt     = coreMetricValue(coreBodies, 'online_user_cnt');
summary.screen_avg_watch_dur  = coreMetricValue(coreBodies, 'avg_watch_duration');
summary.screen_follow_cnt     = coreMetricValue(coreBodies, 'follow_anchor_ucnt');
summary.screen_watch_ucnt     = coreMetricValue(coreBodies, 'watch_ucnt');
summary.screen_refund_amt     = coreMetricValue(coreBodies, 'real_refund_amt');
summary.screen_stat_cost      = coreMetricValue(coreBodies, 'stat_cost');

const fmd = findScreenBodies(sApis, 'five_min_data').slice(-1)[0] || {};
if (fmd.st === 0 && fmd.data) {
  const cards = fmd.data.card || [];
  const g5 = fiveCardValue(cards, ['成交金额', 'pay_amt']);
  const w5 = fiveCardValue(cards, ['进入人数', '观看人数', 'watch_cnt']);
  summary.screen_5min_gmv          = g5 ? g5.value  : null;
  summary.screen_5min_gmv_change   = g5 ? g5.change : null;
  summary.screen_5min_watch        = w5 ? w5.value  : null;
  summary.screen_5min_watch_change = w5 ? w5.change : null;
}

const mc = rb.commonMetricCard || {};
const fn = rb.funnelModule    || {};
summary.qc_bjTime          = rb.bjTime || null;
summary.qc_GMV_settle      = mc['total_order_settle_amount_realtime_for_overall_roi2_1h'] || null;
summary.qc_ROI             = mc['total_prepay_and_pay_settle_realtime_overall_roi2_1h']   || null;
summary.qc_cost            = mc['stat_cost_for_overall_roi2']                              || null;
summary.qc_order_cnt       = mc['total_pay_order_count_realtime_for_roi2']                 || null;
summary.qc_GPM             = mc['total_live_pay_order_gpm_realtime_for_roi2']              || null;
summary.qc_watch_pay_rate  = mc['live_watch_to_pay_rate_for_roi2']                         || null;
summary.qc_cpo             = mc['total_cost_per_pay_order_realtime_for_roi2']              || null;
summary.qc_watch_ucnt      = mc['live_watch_ucount_for_roi2']                              || null;
summary.qc_show_watch_rate = mc['total_show_to_watch_rate_for_roi2']                       || null;
summary.qc_funnel_show     = fn['live_show_count_for_roi2']                                || null;
summary.qc_funnel_watch    = fn['live_watch_count_for_roi2']                               || null;
summary.qc_funnel_click    = fn['live_product_click_count_for_roi2']                       || null;
summary.qc_funnel_order    = fn['total_pay_order_count_for_roi2']                          || null;
summary.qc_show_watch_pct  = fn['total_show_to_watch_rate_for_roi2']                       || null;
summary.qc_watch_click_pct = fn['total_watch_to_product_click_rate_for_roi2']              || null;
summary.qc_watch_pay_pct   = fn['total_watch_to_pay_rate_realtime_for_roi2']               || null;
summary.qc_click_pay_pct   = fn['total_product_click_to_pay_rate_realtime_for_roi2']       || null;

// 千川总览卡片（reqFrom=commonMetricCard）— 大屏顶部"整体成交金额/整体消耗"
// 程序提取，替代视觉读图（视觉读数有看错风险+与程序数据不同源）
function qcOverviewTotals(apis) {
  const hits = (apis || []).filter(a => (a.url || '').includes('reqFrom=commonMetricCard'));
  for (let i = hits.length - 1; i >= 0; i--) {        // 取最新一条 commonMetricCard
    const tot = hits[i] && hits[i].body && hits[i].body.data
      && hits[i].body.data.StatsData && hits[i].body.data.StatsData.Totals;
    if (tot && (tot.total_pay_order_gmv_include_coupon_realtime_for_roi2 || tot.stat_cost_for_roi2)) {
      return tot;
    }
  }
  return {};
}
const qcOv = qcOverviewTotals(sc.qianchuan_apis);
const ovGmv  = qcOv.total_pay_order_gmv_include_coupon_realtime_for_roi2;
const ovCost = qcOv.stat_cost_for_roi2;
summary.qc_overall_gmv  = (ovGmv  && ovGmv.Value  != null) ? ovGmv.Value  : null;   // 整体成交（飞书表 K列）
summary.qc_overall_cost = (ovCost && ovCost.Value != null) ? ovCost.Value : null;   // 整体消耗（飞书表 L列）

fs.writeFileSync(SUMMARY_FILE, JSON.stringify(summary, null, 2));
const keys = Object.keys(summary).length;
const size = Buffer.byteLength(JSON.stringify(summary));
console.log(`[SUMMARY] Saved ${keys} fields, ${size} bytes → ${SUMMARY_FILE}`);
