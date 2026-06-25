"use strict";
// extract_promover_summary.js — 从 promover_clean.json 提取关键乘方指标
// 输出: data/promover_summary.json
// 字段前缀: prom_ (区分 qc_ 千川字段)
// v1.1: 新增第5节 prom_videos（单视频性能+审核状态），分离主播级/视频级 matRows

const fs = require('fs');

const IN_FILE  = '/opt/douyin-fetcher/data/promover_clean.json';
const OUT_FILE = '/opt/douyin-fetcher/data/promover_summary.json';

if (!fs.existsSync(IN_FILE)) {
  console.error('[ERROR] promover_clean.json not found — run promover_capture.js first');
  process.exit(1);
}

const raw = JSON.parse(fs.readFileSync(IN_FILE, 'utf8'));
const summary = {
  bjHour:      raw.bjHour,
  capturedAt:  raw.capturedAt,
  promover_url: raw.promover_url,
};

// ── 辅助 ─────────────────────────────────────────────────────────────

function statRows(statRequests, statResps, reqFrom) {
  // 找所有匹配 reqFrom 的 statQuery 响应 rows
  const result = [];
  for (let i = 0; i < Math.min(statRequests.length, statResps.length); i++) {
    if (statRequests[i].reqFrom === reqFrom) {
      const rows = statResps[i]?.body?.data?.StatsData?.Rows || [];
      result.push(...rows);
    }
  }
  return result;
}

function metricVal(row, key) {
  const m = row?.Metrics?.[key];
  return m?.Value ?? null;
}

function metricStr(row, key) {
  const m = row?.Metrics?.[key];
  return m?.ValueStr ?? null;
}

function parseNum(str) {
  if (str == null) return null;
  const n = parseFloat(String(str).replace(/[,%]/g, ''));
  return isNaN(n) ? null : n;
}

function findPromAPI(apis, urlFragment) {
  return apis.find(a => a.url && a.url.includes(urlFragment));
}

function findAllPromAPIs(apis, urlFragment) {
  return apis.filter(a => a.url && a.url.includes(urlFragment));
}

// ── statQuery 匹配 ─────────────────────────────────────────────────────
const statRequests = raw.stat_requests || [];
const statResps    = (raw.all_apis || []).filter(a => a.url?.includes('statQuery'));

// ── 1. 今日汇总（从 ad/list-summary）─────────────────────────────────
const adSummaryAPI = findPromAPI(raw.promover_apis, 'ad/list-summary');
const adTotals = adSummaryAPI?.body?.data?.totalMetrics?.metrics || {};

function adMetric(key) {
  return parseNum(adTotals[key]?.valueStr ?? null);
}

summary.prom_cost           = adMetric('statCostForOverallRoi2');      // 综合成本（元）
summary.prom_roi            = adMetric('totalPrepayAndPaySettleOverallRoi21H'); // 综合ROI
summary.prom_settle_gmv     = adMetric('totalOrderSettleAmountForRoi21H');  // 净成交金额（含佣金）
summary.prom_real_settle    = adMetric('totalOrderRealSettleAmountForRoi21H'); // 实际结算（退款后）
summary.prom_gross_gmv      = adMetric('totalPayOrderGmvIncludeCouponForRoi2'); // 含券成交GMV
summary.prom_order_cnt      = adMetric('totalOrderSettleCountForRoi21H');  // 结算订单数
summary.prom_cpo            = adMetric('totalCostPerPayOrderSettleForOverallRoi21H'); // 综合订单成本
summary.prom_refund_rate    = parseNum(adTotals['totalRefundOrderGmvForRoi21HRate']?.valueStr); // 退款率 %
summary.prom_total_orders_paid = adMetric('totalPayOrderCountForRoi2');   // 成交订单数

// ── 2. 预估电商技术服务费减免 ─────────────────────────────────────────
const feeRows = statRows(statRequests, statResps, 'estimated_saving_service_fee');
if (feeRows.length > 0) {
  summary.prom_fee_saving = metricVal(feeRows[0], 'estimated_savings_in_platform_service_fee');
}

// ── 3. 今日小时趋势（uniDataOverview_trend_today — 按小时）───────────
const trendRows = statRows(statRequests, statResps, 'uniDataOverview_trend_today');
if (trendRows.length > 0) {
  // 每小时数据数组（供 n8n 归档）
  summary.prom_hourly_trend = trendRows.map(row => {
    const hour = row?.Dimensions?.stat_time_hour?.ValueStr || null;
    return {
      hour,
      cost:         metricVal(row, 'stat_cost_for_overall_roi2'),
      roi:          metricVal(row, 'total_prepay_and_pay_settle_overall_roi2_1h'),
      settle_gmv:   metricVal(row, 'total_order_settle_amount_for_roi2_1h'),
      real_settle:  metricVal(row, 'total_order_real_settle_amount_for_roi2_1h'),
      order_cnt:    metricVal(row, 'total_order_settle_count_for_roi2_1h'),
      refund_rate:  metricStr(row, 'total_refund_order_gmv_for_roi2_1h_rate'),
      cpo:          metricVal(row, 'total_cost_per_pay_order_settle_for_overall_roi2_1h'),
    };
  });
  // 最新一小时（最后 row）
  const latest = summary.prom_hourly_trend[summary.prom_hourly_trend.length - 1];
  summary.prom_latest_hour      = latest?.hour;
  summary.prom_latest_cost      = latest?.cost;
  summary.prom_latest_roi       = latest?.roi;
  summary.prom_latest_settle    = latest?.settle_gmv;
  summary.prom_latest_order_cnt = latest?.order_cnt;
}

// ── 4. 主播级素材列表（material/list-required，主播维度）─────────────
// 注意：同一 API 路径有两种 rows：主播级(anchorId维度) 和 视频级(materialId维度)
// 此节只取主播级；视频级见第5节
const matAPIs = findAllPromAPIs(raw.promover_apis, 'material/list-required');
let matRows = [];  // 主播级
let vidRows = [];  // 视频级

for (const api of matAPIs) {
  const rows = api?.body?.data?.statsData?.rows || [];
  for (const row of rows) {
    const dims = row.dimensions || {};
    if (dims.roi2MaterialAnchorName || dims.anchorId) {
      matRows.push(row);  // 主播聚合行
    } else if (dims.materialId) {
      vidRows.push(row);  // 单视频行
    }
  }
}

if (matRows.length > 0) {
  summary.prom_materials = matRows.map(row => {
    const dims = row.dimensions || {};
    const mets = row.metrics    || {};
    function mval(k) { return parseNum(mets[k]?.valueStr); }
    return {
      anchor_name: dims.roi2MaterialAnchorName?.valueStr || null,
      anchor_id:   dims.anchorId?.valueStr              || null,
      cid:         dims.roi2304Cid?.valueStr             || null,
      cost:        mval('statCostForOverallRoi2'),
      roi:         mval('totalPrepayAndPaySettleOverallRoi21H'),
      settle_gmv:  mval('totalOrderSettleAmountForRoi21H'),
      real_settle: mval('totalOrderRealSettleAmountForRoi21H'),
      gross_gmv:   mval('totalPayOrderGmvIncludeCouponForRoi2Fork'),
      order_cnt:   mval('totalOrderSettleCountForRoi21H'),
      cpo:         mval('totalCostPerPayOrderSettleForOverallRoi21H'),
      refund_rate: mets['totalRefundOrderGmvForRoi21HRate']?.valueStr || null,
      settle_rate: mets['totalOrderSettleAmountRateForRoi21H']?.valueStr || null,
    };
  });
  // 单主播快捷字段（主播只有1个时）
  if (summary.prom_materials.length === 1) {
    const m = summary.prom_materials[0];
    summary.prom_mat_anchor   = m.anchor_name;
    summary.prom_mat_cost     = m.cost;
    summary.prom_mat_roi      = m.roi;
    summary.prom_mat_settle   = m.settle_gmv;
    summary.prom_mat_orders   = m.order_cnt;
    summary.prom_mat_cpo      = m.cpo;
    summary.prom_mat_refund   = m.refund_rate;
  }
}

// ── 5. 单视频性能+审核状态（video-level，来自 Step9c 视频tab）─────────
// dimensions: materialId / roi2MaterialVideoName / roi2MaterialStatus / roi2MaterialShowStatus
// roi2MaterialShowStatus: 1=审核通过并投放 / 其他值=未过审或暂停
// metrics: value (小写) — 注意与 statQuery 的 Value(大写) 不同
if (vidRows.length > 0) {
  summary.prom_videos = vidRows.map(row => {
    const dims = row.dimensions || {};
    const mets = row.metrics    || {};
    function dv(k) { return dims[k]?.valueStr ?? null; }
    function mv(k) { return mets[k]?.value ?? null; }  // 注意：小写 value
    return {
      material_id:    dv('materialId'),
      video_name:     dv('roi2MaterialVideoName'),
      status:         dv('roi2MaterialStatus'),       // 投放中 / 暂停 / 审核中 等
      show_status:    dv('roi2MaterialShowStatus'),   // 1=审核通过+投放; 0/其他=未过审
      video_type:     dv('roi2MaterialVideoType'),    // 自选投放视频 / AIGC 等
      tags:           dv('materialTagList'),           // JSON string 如 ["1","bao"]
      upload_time:    dv('roi2MaterialUploadTime'),
      cost:           mv('statCostForOverallRoi2'),
      settle_gmv:     mv('totalOrderSettleAmountForRoi21H'),
      gross_gmv:      mv('totalPayOrderGmvIncludeCouponForRoi2'),
      orders:         mv('totalOrderSettleCountForRoi21H'),
      roi:            mv('totalPrepayAndPaySettleOverallRoi21H'),
      cpo:            mv('totalCostPerPayOrderSettleForOverallRoi21H'),
      watch_cnt:      mv('liveWatchCountForRoi2V2'),
      show_cnt:       mv('liveShowCountForRoi2V2'),
      convert_rate:   mv('liveConvertRateForRoi2V2'),
    };
  });
  // 按 cost 降序排列（跑得最好的排前面）
  summary.prom_videos.sort((a, b) => (b.cost || 0) - (a.cost || 0));
  summary.prom_video_cnt = vidRows.length;
}

// ── 存档 ──────────────────────────────────────────────────────────────
fs.writeFileSync(OUT_FILE, JSON.stringify(summary, null, 2));
const keys = Object.keys(summary).length;
const size = Buffer.byteLength(JSON.stringify(summary));
console.log(`[PROMOVER-SUMMARY] ${keys} fields, ${size} bytes → ${OUT_FILE}`);
if (summary.prom_cost != null)     console.log(`[PROMOVER-SUMMARY] cost=${summary.prom_cost} roi=${summary.prom_roi} settle=${summary.prom_settle_gmv} orders=${summary.prom_order_cnt}`);
if (summary.prom_fee_saving != null) console.log(`[PROMOVER-SUMMARY] fee_saving=${summary.prom_fee_saving}`);
if (summary.prom_materials?.length > 0) console.log(`[PROMOVER-SUMMARY] materials=${summary.prom_materials.length} anchor(s)`);
if (summary.prom_videos?.length > 0) {
  const top = summary.prom_videos[0];
  console.log(`[PROMOVER-SUMMARY] videos=${summary.prom_videos.length} | top: ${top.video_name} cost=${top.cost} orders=${top.orders} status=${top.status}`);
}
