// screen_capture.js — 直播大屏 + 千川数据采集
// 架构复用 live_capture_v3.js，Step 1-5 相同
// Step 6 改点「直播大屏」，Step 7-13 新增大屏/千川导航

const { execSync }  = require('child_process');
const fs            = require('fs');

const COOKIES_PATH  = '/opt/douyin-fetcher/fresh_cookies.json';
const SCREEN_OUT    = '/opt/douyin-fetcher/data/screen_clean.json';
const CHAT_ID       = 'oc_af2b50b253a140dafe12c2d2a1acd9e9';
const STORAGE_FILE  = '/opt/douyin-fetcher/full_storage_state.json';

const SS_MAP = { 'no_restriction':'None', 'lax':'Lax', 'strict':'Strict' };
const IS_RETRY = process.argv.includes("--retry");
function convertCookies(raw) {
  return raw.map(c => {
    const out = { name:c.name, value:c.value, domain:c.domain.replace(/^\./,''),
      path:c.path||'/', secure:!!c.secure, httpOnly:!!c.httpOnly };
    if (c.expirationDate && c.expirationDate > Date.now()/1000)
      out.expires = Math.floor(c.expirationDate);
    const ss = c.sameSite ? c.sameSite.toLowerCase() : null;
    if (ss && SS_MAP[ss]) out.sameSite = SS_MAP[ss];
    return out;
  });
}

async function dismissGuides(pg) {
  await pg.keyboard.press('Escape').catch(()=>{});
  await pg.waitForTimeout(300);

  // Step1: 先尝试点击所有关闭按钮
  for (let round = 0; round < 3; round++) {
    const clicked = await pg.evaluate(() => {
      let count = 0;
      const kw = ['知道了','我知道了','知道了！','好的','关闭','不再提示','确定','跳过'];
      const closeChars = ['×','✕','✖','✗'];

      Array.from(document.querySelectorAll('button,span,div,a,p,i')).forEach(el => {
        const r = el.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) return;
        const t = el.textContent.trim();
        if (kw.includes(t) || closeChars.includes(t)) { el.click(); count++; }
      });

      // 精准 close 选择器（含 alert-close、anticon-close 等）
      [
        '.alert-close', '.notice-close', '.notice-box .close', '.notice-box-close',
        '.ant-modal-close', '.ant-notification-notice-close', '.ant-alert-close-icon',
        '.ant-tour-close', '.anticon-close',
        '[class*="alert-close"]','[class*="notice-close"]',
        '[class*="close-btn"]','[class*="closeBtn"]','[class*="guide-close"]',
        '[class*="popup-close"]','[class*="tipClose"]','[class*="floatClose"]',
        '[aria-label="close"]','[aria-label="Close"]','[aria-label="关闭"]',
        'span[data-icon="close"]',
      ].forEach(sel => {
        try {
          document.querySelectorAll(sel).forEach(el => {
            const r = el.getBoundingClientRect();
            if (r.width > 0 || r.height > 0) { el.click(); count++; }
          });
        } catch(e) {}
      });
      return count;
    }).catch(() => 0);
    if (clicked === 0) break;
    await pg.waitForTimeout(400);
  }

  // Step2: 强制隐藏残留的引导/公告元素（点击无效时的兜底）
  await pg.evaluate(() => {
    const hideSelectors = [
      '.notice-box', '.ovui-alert', '.alert-box',
      '[class*="guide-mask"]', '[class*="guideMask"]',
      '[class*="tour-mask"]', '[class*="onboarding"]',
      '[class*="announcement"]', '[class*="Announcement"]',
      '[class*="notice-wrapper"]',
      '[class*="custom-text-tooltip"]',
      '[class*="tooltipWrapper"]','[class*="tooltip-wrapper"]',
    ];
    hideSelectors.forEach(sel => {
      try {
        document.querySelectorAll(sel).forEach(el => {
          el.style.setProperty('display', 'none', 'important');
        });
      } catch(e) {}
    });
  }).catch(()=>{});

  await pg.keyboard.press('Escape').catch(()=>{});
  await pg.waitForTimeout(300);
}

function larkSendImage(imgPath) {
  try {
    const _basename = require("path").basename(imgPath);
    const _dir = require("path").dirname(imgPath);
    execSync("cd \"" + _dir + "\" && lark-cli im +messages-send --chat-id " + CHAT_ID + " --image ./" + _basename + " --as bot",
      {encoding:"utf8", timeout:15000, stdio:"pipe"});
  } catch(e) { console.log("lark img err:", e.message.substring(0,60)); }
}

function larkSend(msg) {
  try {
    execSync(
      'lark-cli im +messages-send --chat-id ' + CHAT_ID +
      ' --text "' + msg.replace(/"/g,"'") + '"  --as bot',
      { encoding:'utf8', timeout:10000, stdio:'pipe' }
    );
  } catch(e) { console.log('lark err:', e.message.substring(0,60)); }
}

let _browser, _context;

async function main() {
  const rnd = (min, max) => Math.floor(min + Math.random() * (max - min));

  // ── 人性化滚动 ──
  async function humanBrowse(pg, label) {
    const scrolls = rnd(1, 3);
    for (let i = 0; i < scrolls; i++) {
      await pg.evaluate(() => window.scrollBy(0, Math.floor(Math.random()*350)+80)).catch(()=>{});
      await pg.waitForTimeout(rnd(800, 2500));
    }
    if (Math.random() > 0.5) {
      await pg.evaluate(() => window.scrollBy(0, -(Math.floor(Math.random()*150)+50))).catch(()=>{});
      await pg.waitForTimeout(rnd(500, 1500));
    }
    console.log('[HUMAN] Browse done:', label);
  }

  // ── 异常检测（允许 buyin / compass / qianchuan 三域）──
  async function checkAbnormal(pg, label) {
    const url = pg.url();
    const allowed = ['buyin.jinritemai.com','compass.jinritemai.com','qianchuan.jinritemai.com'];
    if (!allowed.some(d => url.includes(d))) {
      larkSend('⚠️ [SCREEN ' + label + '] 页面跳转异常，当前URL: ' + url.substring(0,80));
      return true;
    }
    const captchaFound = await pg.evaluate(() => {
      const sels = ['[class*="captcha"]','[id*="captcha"]','iframe[src*="captcha"]','[class*="challenge"]'];
      return sels.find(s => document.querySelector(s) !== null) || null;
    }).catch(() => null);
    if (captchaFound) {
      larkSend('⚠️ [SCREEN ' + label + '] 检测到验证码，需要人工处理');
      return true;
    }
    return false;
  }

  // ── 通用 JS 点击（文字匹配，React 兼容）──
  async function jsClickByText(pg, searchText, logLabel) {
    const handle = await pg.evaluateHandle((txt) => {
      const queries = [
        'div[role="tab"]','li[role="tab"]','.ant-tabs-tab',
        '[class*="tab-item"]','[class*="tabItem"]','[class*="tab_item"]',
        'button','span','div',
      ];
      for (const sel of queries) {
        const els = Array.from(document.querySelectorAll(sel));
        const match = els.find(el => {
          const t = el.textContent.trim();
          return t === txt || t.includes(txt);
        });
        if (match) return match;
      }
      return null;
    }, searchText);

    const el = handle.asElement ? handle.asElement() : null;
    if (!el) {
      console.log('[jsClick] "' + logLabel + '" not found in DOM');
      return false;
    }
    await pg.evaluate(elem => {
      elem.scrollIntoView({ block:'center', behavior:'smooth' });
    }, el);
    await pg.waitForTimeout(rnd(300, 700));
    await pg.evaluate(elem => {
      elem.click();
      ['mouseenter','mouseover','mousemove','mousedown','mouseup','click'].forEach(type => {
        elem.dispatchEvent(new MouseEvent(type, {
          bubbles:true, cancelable:true, view:window,
          clientX: elem.getBoundingClientRect().left + elem.getBoundingClientRect().width/2,
          clientY: elem.getBoundingClientRect().top  + elem.getBoundingClientRect().height/2,
        }));
      });
    }, el);
    return true;
  }

  // ── Init ──
  const { launch } = await import('/opt/douyin-fetcher/node_modules/cloakbrowser/dist/index.js');
  const raw      = JSON.parse(fs.readFileSync(COOKIES_PATH,'utf8'));
  const cookies  = (raw[0]&&raw[0].name) ? raw : convertCookies(raw);
  console.log('[INIT] Loaded', cookies.length, 'cookies');

  _browser = await launch({ headless: true, locale: 'zh-CN', timezone: 'Asia/Shanghai' });

  let context;
  if (fs.existsSync(STORAGE_FILE)) {
    console.log('[INIT] Restoring storageState');
    context = await _browser.newContext({ storageState: STORAGE_FILE, ignoreHTTPSErrors: true, extraHTTPHeaders: { 'Accept-Language': 'zh-CN,zh;q=0.9' } });
  } else {
    context = await _browser.newContext({ ignoreHTTPSErrors: true, extraHTTPHeaders: { 'Accept-Language': 'zh-CN,zh;q=0.9' } });
    await context.addCookies(cookies);
  }
  _context = context;

  // ── API 拦截（buyin / compass / qianchuan / zijieapi）──
  const allAPIs = [];
  const creativeRequests = [];
  context.on('request', req => {
    if (req.url().includes('statQuery') && req.method() === 'POST') {
      const body = req.postData() || "";
      const rf = (req.url().split("reqFrom=")[1] || "?").split("&")[0];
      creativeRequests.push({ reqFrom: rf, url: req.url(), postData: body });
      console.log("[REQ:POST] reqFrom=" + rf + " " + body.substring(0, 80));
    }
  });
  context.on('response', async resp => {
    const url = resp.url();
    const ct  = resp.headers()['content-type'] || '';
    if (!ct.includes('json')) return;
    const relevant =
      url.includes('jinritemai') ||
      url.includes('compass.jinrite') ||
      url.includes('zijieapi') ||
      url.includes('qianchuan');
    if (!relevant) return;
    const body = await resp.json().catch(() => null);
    if (!body) return;
    allAPIs.push({ url, status:resp.status(), body });
    if (url.includes('screen'))      console.log('[API:SCREEN]', resp.status(), url.split('?')[0]);
    else if (url.includes('qianchuan')) console.log('[API:QIANCH]', resp.status(), url.split('?')[0]);
    else if (url.includes('compass')) console.log('[API:COMPASS]', resp.status(), url.split('?')[0]);
  });

  const page = await context.newPage();

  // ═══════════════════════════════════════════════════
  // STEP 1 — 直接跳 live-list（复用已有 session，不走 dashboard→经营→导航）
  // ═══════════════════════════════════════════════════
  const LIVE_LIST_URL = 'https://buyin.jinritemai.com/dashboard/compass-home/live-list';
  console.log('\n[1] Navigating directly to live-list...');
  await page.goto(LIVE_LIST_URL, { waitUntil:'networkidle', timeout:30000 });
  await page.waitForTimeout(rnd(2500, 4500));
  const listUrl = page.url();
  console.log('[1] URL:', listUrl);

  if (!listUrl.includes('buyin.jinritemai.com')) {
    larkSend('❌ [SCREEN] Cookie已失效，请重新扫码');
    await _browser.close(); process.exit(1);
  }

  // 等 today_live_room API 触发（页面加载时自动发出）
  await page.waitForTimeout(rnd(1500, 3000));
  const todayApiData = allAPIs.find(a => a.url.includes('today_live_room'));
  let liveId = null;
  if (todayApiData?.body?.data?.card_list?.length > 0) {
    const card = todayApiData.body.data.card_list.find(c => c.live_status) ||
                 todayApiData.body.data.card_list[0];
    liveId = card?.live_id;
    console.log('[1] live_id from API:', liveId);
  }

  // ═══════════════════════════════════════════════════
  // STEP 2 — 点 live-list 表格中的「直播大屏」按钮（必须真实点击！）
  // 直接跳 URL 会跳过 JS click handler 的 session 初始化，
  // 导致 core_data / live_order / blend_trend_v2 返回 621000601 参数校验失败
  // ═══════════════════════════════════════════════════
  let screenPage = null;

  console.log('[2] Scrolling to reveal live-list table...');
  await page.evaluate(() => window.scrollTo(0, 300)).catch(() => {});
  await page.waitForTimeout(rnd(2000, 3500));

  // 额外等待 today_live_room API 确保表格已渲染
  if (allAPIs.filter(a => a.url.includes('today_live_room')).length === 0) {
    console.log('[2] Waiting for today_live_room API to fire...');
    await page.waitForTimeout(rnd(2000, 4000));
  }

  console.log('[2] Looking for a.d1wcp (直播大屏 button)...');
  try {
    const btnHandle = await page.evaluateHandle(() => {
      // 每行有3个 a.d1wcp：直播诊断 / 直播数据 / 直播大屏 — 必须按文字精确匹配
      const links = Array.from(document.querySelectorAll('a.d1wcp'));
      const screenBtn = links.find(el => el.textContent.trim() === '直播大屏');
      if (screenBtn) return screenBtn;
      // 备用：任意包含「直播大屏」文字的可点击元素，排除导航
      const all = Array.from(document.querySelectorAll('a, button'));
      return all.find(el =>
        el.textContent.includes('直播大屏') &&
        !el.closest('nav, [class*="nav"], [class*="header"], [class*="menu"], [class*="sider"]')
      ) || null;
    });

    const btn = btnHandle.asElement ? btnHandle.asElement() : null;
    if (btn) {
      console.log('[2] Button found, dispatching click...');
      const [newTab] = await Promise.all([
        context.waitForEvent('page', { timeout: 15000 }).catch(() => null),
        page.evaluate(el => {
          el.scrollIntoView({ block: 'center', behavior: 'smooth' });
          ['mouseenter', 'mouseover', 'mousedown', 'mouseup', 'click'].forEach(type => {
            el.dispatchEvent(new MouseEvent(type, {
              bubbles: true, cancelable: true, view: window,
              clientX: el.getBoundingClientRect().left + el.getBoundingClientRect().width / 2,
              clientY: el.getBoundingClientRect().top  + el.getBoundingClientRect().height / 2,
            }));
          });
          el.click();
        }, btn),
      ]);

      if (newTab) {
        await newTab.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
        screenPage = newTab;
        console.log('[2] Screen tab opened:', newTab.url().substring(0, 100));
      } else {
        // 同 tab 跳转
        await page.waitForTimeout(rnd(3000, 5000));
        if (page.url().includes('compass.jinritemai.com')) {
          screenPage = page;
          console.log('[2] Screen same-tab:', page.url().substring(0, 100));
        } else {
          console.log('[2] WARN: no new tab, page URL:', page.url().substring(0, 80));
        }
      }
    } else {
      console.log('[2] WARN: a.d1wcp not found in DOM');
    }
  } catch (e) {
    console.log('[2] Click error:', e.message.substring(0, 80));
  }

  // 备用：live_id 已知时直接构造 URL（core_data 可能受限，报 621000601）
  if (!screenPage && liveId) {
    const screenUrlFallback = 'https://compass.jinritemai.com/screen/live/talent/live_room_id=' + liveId;
    console.log('[2] Fallback: direct URL (core_data may be limited):', screenUrlFallback);
    larkSend('⚠️ [SCREEN] 按钮点击失败，改用直接 URL，core_data 可能受限');
    const sp = await context.newPage();
    await sp.goto(screenUrlFallback, { waitUntil: 'networkidle', timeout: 30000 });
    screenPage = sp;
  }

  if (!screenPage) {
    if (IS_RETRY) larkSend("❌ [SCREEN] 无法进入直播大屏，请检查直播状态和登录态（已重试仍失败）");
    await _browser.close(); process.exit(1);
  }

  // ═══════════════════════════════════════════════════
  // STEP 7 — 直播大屏主页
  // compass.jinritemai.com/screen/live/talent/live_room_id=XXXX
  // ═══════════════════════════════════════════════════
  await screenPage.waitForTimeout(rnd(5000, 8500));
  const screenUrl7 = screenPage.url();
  console.log('\n[7] Screen URL:', screenUrl7);
  if (await checkAbnormal(screenPage, 'Step7')) { await _browser.close(); process.exit(1); }

  // 提取 live_room_id（后续 hash 导航需要）
  const liveRoomIdMatch = screenUrl7.match(/live_room_id[=\/](\d+)/);
  const liveRoomId = liveRoomIdMatch ? liveRoomIdMatch[1] : liveId;
  console.log('[7] live_room_id:', liveRoomId);

  // 滚动让主页数据加载
  for (let i = 0; i < 3; i++) {
    await screenPage.evaluate(() => window.scrollBy(0, 400)).catch(()=>{});
    await screenPage.waitForTimeout(rnd(1000, 2000));
  }
  await screenPage.waitForTimeout(rnd(2000, 3500));
  console.log('[7] Main screen loaded');

  // ── 截图：直播大屏 专业版 ──
  try {
    await screenPage.evaluate(() => window.scrollTo(0,0)).catch(()=>{});
    await screenPage.waitForTimeout(1500);
    await dismissGuides(screenPage);
    await screenPage.waitForTimeout(500);
    await screenPage.screenshot({ path: '/tmp/sc_pro.png', fullPage: false });
    console.log('[7] Screenshot: 专业版 saved');
  } catch(e) { console.log('[7] Screenshot pro failed:', e.message.substring(0,60)); }

  // ── 基础版截图：监听新 tab + 点卡片，诊断真实跳转路径 ──
  try {
    const proPageUrl = screenPage.url();

    // Step1: 打开下拉
    const triggerHandle = await screenPage.evaluateHandle(() => {
      const all = Array.from(document.querySelectorAll('span, div, button'));
      return all.find(el => {
        const t = el.textContent.trim();
        return (t === '专业版' || t === '专业版▼') && el.offsetTop < 80;
      }) || null;
    });
    const triggerEl = triggerHandle.asElement ? triggerHandle.asElement() : null;
    if (triggerEl) await triggerEl.click();
    await screenPage.waitForTimeout(rnd(1000, 1600));
    console.log('[7] Step1: dropdown opened');

    // 监听是否开了新 tab
    const newTabPromise = context.waitForEvent('page', { timeout: 8000 }).catch(() => null);

    // Step2: 找「基础版」卡片坐标，mouse.click
    const basicEls = await screenPage.$$('text=基础版');
    console.log('[7] Found', basicEls.length, '基础版 elements');
    let clickCoords = null;
    for (const el of basicEls) {
      const visible = await el.isVisible().catch(() => false);
      const box = await el.boundingBox().catch(() => null);
      if (visible && box && box.y > 80) {
        const cardInfo = await screenPage.evaluateHandle((el) => {
          let node = el;
          for (let i = 0; i < 10; i++) {
            node = node.parentElement;
            if (!node) break;
            const rect = node.getBoundingClientRect();
            if (rect.width > 100 && rect.width < 600 && rect.height > 80 && rect.height < 500) {
              return { x: rect.left + rect.width/2, y: rect.top + rect.height/2, w: rect.width, h: rect.height };
            }
          }
          return null;
        }, el);
        clickCoords = await cardInfo.jsonValue().catch(() => null);
        break;
      }
    }

    if (clickCoords) {
      console.log('[7] Clicking at', JSON.stringify(clickCoords));
      await screenPage.mouse.click(clickCoords.x, clickCoords.y);
    }

    // 等一秒，看是否有新 tab
    const newTab = await newTabPromise;
    console.log('[7] New tab opened:', newTab ? newTab.url() : 'none');

    // 等待 URL 或新页面稳定
    await screenPage.waitForTimeout(3000);
    console.log('[7] screenPage URL after click:', screenPage.url());

    // 判断截图目标：新 tab 优先
    const targetPage = newTab || screenPage;
    await targetPage.waitForTimeout(rnd(3000, 5000));
    await dismissGuides(targetPage);
    await targetPage.waitForTimeout(500);
    await targetPage.evaluate(() => window.scrollTo(0,0)).catch(()=>{});
    await targetPage.waitForTimeout(800);
    await targetPage.screenshot({ path: '/tmp/sc_basic.png', fullPage: false });
    console.log('[7] Screenshot: 基础版 saved from', newTab ? 'new tab' : 'same tab', targetPage.url());

    if (newTab) await newTab.close().catch(()=>{});

    // 切回专业版
    if (screenPage.url() !== proPageUrl) {
      await screenPage.goto(proPageUrl, { waitUntil: 'networkidle', timeout: 30000 });
      await screenPage.waitForTimeout(rnd(2000, 3000));
    }
  } catch(e) { console.log('[7] Screenshot basic failed:', e.message.substring(0,60)); }


  // 主动补抓 exact core_data / five_min_data，避免摘要提取误命中 portrait_five_min_data，
  // 并补齐 watch_ucnt / refund / stat_cost 的 value。
  if (liveRoomId) {
    const exactCoreUrl = 'https://compass.jinritemai.com/compass_api/author/live/live_screen/core_data?room_id=' + liveRoomId + '&index_selected=watch_ucnt,real_refund_amt,stat_cost';
    const exactFiveUrl = 'https://compass.jinritemai.com/compass_api/content_live/author/live_screen/five_min_data?room_id=' + liveRoomId;
    try {
      const exactFetches = await screenPage.evaluate(async (payload) => {
        const urls = [payload.coreUrl, payload.fiveUrl];
        return Promise.all(urls.map(async url => {
          const resp = await fetch(url, { credentials: 'include' });
          await resp.clone().text().catch(() => '');
          return { url, ok: resp.ok, status: resp.status };
        }));
      }, { coreUrl: exactCoreUrl, fiveUrl: exactFiveUrl });
      console.log('[7] Exact supplemental fetch:', JSON.stringify(exactFetches));
      await screenPage.waitForTimeout(rnd(1200, 2200));
    } catch (e) {
      console.log('[7] WARN: exact supplemental fetch failed:', e.message.substring(0, 80));
    }
  }

  // ═══════════════════════════════════════════════════
  // STEP 8 — 商品 tab (#product) + 直播间订单 sub-tab
  // ═══════════════════════════════════════════════════
  console.log('\n[8] Navigating to #product tab...');
  if (liveRoomId) {
    await screenPage.goto(
      'https://compass.jinritemai.com/screen/live/talent/live_room_id=' + liveRoomId + '#product',
      { waitUntil:'networkidle', timeout:25000 }
    );
  } else {
    await jsClickByText(screenPage, '商品', '商品tab');
  }
  await screenPage.waitForTimeout(rnd(3000, 5000));
  console.log('[8] Product tab loaded');

  // 点「直播间订单」sub-tab
  console.log('[8] Clicking 直播间订单 sub-tab...');
  for (let retry = 0; retry < 3; retry++) {
    const ok = await jsClickByText(screenPage, '直播间订单', '直播间订单');
    if (ok) break;
    await screenPage.waitForTimeout(rnd(1000, 2000));
  }
  await screenPage.waitForTimeout(rnd(3000, 5000));
  // 滚动加载订单列表
  for (let i = 0; i < 3; i++) {
    await screenPage.evaluate(() => window.scrollBy(0, 500)).catch(()=>{});
    await screenPage.waitForTimeout(rnd(800, 1500));
  }
  console.log('[8] Order list loaded');

  // ═══════════════════════════════════════════════════
  // STEP 9 — 人群数据 (#crowd) → 检测是否可用，否则转抓流量分析
  // ═══════════════════════════════════════════════════
  console.log('\n[9] Navigating to #crowd tab...');
  if (liveRoomId) {
    await screenPage.goto(
      'https://compass.jinritemai.com/screen/live/talent/live_room_id=' + liveRoomId + '#crowd',
      { waitUntil:'networkidle', timeout:25000 }
    );
  }
  await screenPage.waitForTimeout(rnd(2500, 4000));

  // 检测平台是否开放人群画像
  const crowdBlocked = await screenPage.evaluate(() => {
    const t = document.body.innerText || '';
    return t.includes('非电商直播间无法查看用户画像') ||
           t.includes('暂无人群数据') ||
           t.includes('无法查看用户画像');
  }).catch(() => false);

  if (crowdBlocked) {
    console.log('[9] Crowd portrait blocked (非电商直播间)，转抓流量分析');
    for (let retry = 0; retry < 3; retry++) {
      const ok = await jsClickByText(screenPage, '流量分析', '流量分析');
      if (ok) { await screenPage.waitForTimeout(rnd(2500, 4000)); break; }
      await screenPage.waitForTimeout(rnd(800, 1500));
    }
    for (let retry = 0; retry < 2; retry++) {
      const ok = await jsClickByText(screenPage, '流量诊断', '流量诊断');
      if (ok) { await screenPage.waitForTimeout(rnd(2000, 3500)); break; }
      await screenPage.waitForTimeout(rnd(800, 1500));
    }
    console.log('[9] 流量分析/诊断 tabs clicked');
  } else {
    // 正常有画像数据：点「全场累计用户画像」
    console.log('[9] Crowd portrait available, clicking 全场累计...');
    for (let retry = 0; retry < 3; retry++) {
      const ok = await jsClickByText(screenPage, '全场累计', '全场累计用户画像');
      if (ok) break;
      await screenPage.waitForTimeout(rnd(1000, 2000));
    }
    await screenPage.waitForTimeout(rnd(3000, 5000));
    for (let i = 0; i < 3; i++) {
      await screenPage.evaluate(() => window.scrollBy(0, 400)).catch(()=>{});
      await screenPage.waitForTimeout(rnd(800, 1500));
    }
    console.log('[9] Crowd portrait loaded');
  }

  // ═══════════════════════════════════════════════════
  // STEP 10+11 — 千川 tab (#ad) → 点「查看数据」→ 跳转 qianchuan
  // ═══════════════════════════════════════════════════
  console.log('\n[10] Clicking 千川 nav item (左侧导航, href=#ad)...');
  await screenPage.evaluate(() => {
    // 优先找 a[href*="#ad"]（左侧栏千川入口），否则找文字严格等于"千川"且最短的元素
    const byHash = document.querySelector('a[href*="#ad"], [data-key="ad"], [data-tab="ad"]');
    if (byHash) { byHash.click(); return; }
    // fallback: 左侧 nav 区域里含"千川"且字符数≤4的叶子节点
    const all = Array.from(document.querySelectorAll('nav a, nav li, nav div, aside a, aside li, [class*="side"] a, [class*="side"] li, [class*="nav"] a, [class*="nav"] li'));
    const match = all.find(el => el.children.length === 0 && (el.textContent||'').trim() === '千川');
    if (match) { match.click(); return; }
    // last resort: 任何 a 或 button 文字严格=千川
    const any = Array.from(document.querySelectorAll('a,button')).find(el => (el.textContent||'').trim() === '千川');
    if (any) any.click();
  });
  await screenPage.waitForTimeout(rnd(4000, 6000));
  console.log('[10] 千川 nav clicked, URL:', screenPage.url());

  // 点「查看数据」按钮（会跳转或新开 qianchuan 页）
  console.log('[11] Clicking 查看数据...');
  let qcPage = null;
  try {
    const [newQcTab] = await Promise.all([
      context.waitForEvent('page', { timeout:12000 }).catch(() => null),
      jsClickByText(screenPage, '查看数据', '查看数据'),
    ]);
    if (newQcTab) {
      qcPage = newQcTab;
      console.log('[11] Qianchuan opened in new tab');
    }
  } catch(e) {
    console.log('[11] waitForEvent error:', e.message.substring(0,60));
  }

  // 备用：同标签跳转
  if (!qcPage) {
    await screenPage.waitForTimeout(rnd(3000, 5000));
    if (screenPage.url().includes('qianchuan.jinritemai.com')) {
      qcPage = screenPage;
      console.log('[11] Qianchuan same-tab redirect');
    }
  }

  // 若仍未到千川，尝试从 allAPIs 里找跳转 URL
  if (!qcPage) {
    const qcRedirectAPI = allAPIs.find(a =>
      a.url.includes('qianchuan') || (a.body?.data?.redirect_url||'').includes('qianchuan')
    );
    const qcRedirectUrl = qcRedirectAPI?.body?.data?.redirect_url;
    if (qcRedirectUrl) {
      console.log('[11] Fallback qianchuan URL from API:', qcRedirectUrl.substring(0,100));
      const qp = await context.newPage();
      await qp.goto(qcRedirectUrl, { waitUntil:'networkidle', timeout:30000 });
      qcPage = qp;
    }
  }

  // ═══════════════════════════════════════════════════
  // STEP 12 — 千川看板：点「全域支付数据」
  // ═══════════════════════════════════════════════════
  if (qcPage) {
    // 视口在KPI渲染前定为1440x900，避免后续mid-render resize导致tooltip标签(custom-text-tooltip)测量失败被隐藏
    await qcPage.setViewportSize({ width: 1440, height: 900 }).catch(()=>{});
    await qcPage.waitForTimeout(rnd(4000, 7000));
    let qcUrl = qcPage.url();
    console.log('\n[11] Qianchuan board URL:', qcUrl);

    // roomId=undefined 修复：check-login URL 带了 undefined，补正确的 live_room_id
    if (qcUrl.includes('roomId=undefined') && liveRoomId) {
      const fixedUrl = qcUrl.replace('roomId=undefined', 'roomId=' + liveRoomId);
      console.log('[11] Fixing roomId=undefined → navigating to:', fixedUrl);
      await qcPage.goto(fixedUrl, { waitUntil:'networkidle', timeout:30000 });
      await qcPage.waitForTimeout(rnd(3000, 5000));
      qcUrl = qcPage.url();
      console.log('[11] After fix, URL:', qcUrl);
    }

    // 兜底：roomId fix 后若仍在 compass 域（非 qianchuan），直接导航千川看板
    if (!qcPage.url().includes('qianchuan.jinritemai.com')) {
      const acctAPI = allAPIs.find(a => (a.url||'').includes('get-account-list') && (a.url||'').includes('roomId=' + liveRoomId));
      const ecpAdvs = (acctAPI && acctAPI.body && acctAPI.body.data && acctAPI.body.data.ecpAdvs) || [];
      const targetAdv = ecpAdvs.find(a => a.name === '\u751f\u6d3b\u661f\u7403\u81ea\u8425\u4e13\u7528') || ecpAdvs[0];
      if (targetAdv && liveRoomId) {
        const directUrl = 'https://qianchuan.jinritemai.com/ad/live/liveroom?room_id=' + liveRoomId + '&aavid=' + targetAdv.id;
        console.log('[11b] Still on compass, direct nav to qianchuan:', directUrl);
        await qcPage.goto(directUrl, { waitUntil:'networkidle', timeout:35000 });
        await qcPage.waitForTimeout(rnd(5000, 7000));
        console.log('[11b] After direct nav, URL:', qcPage.url());
      } else {
        console.log('[11b] WARN: cannot extract aavid, skipping direct nav');
      }
    }

    // 等浏览器真正 paint 一帧（双层 rAF），让 Vue tooltip 组件宽度测量拿到真实值
    // networkidle 只等网络，layout 未稳定时 getBoundingClientRect()=0，组件会把标签判成"放不下"永久 display:none
    await qcPage.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))).catch(()=>{});
    await qcPage.waitForTimeout(rnd(2000, 3000));
    await qcPage.evaluate(() => window.dispatchEvent(new Event('resize'))).catch(()=>{});
    await qcPage.waitForTimeout(rnd(1500, 2000));
    console.log('[11] rAF+resize done, triggering component re-measure');

    // 滚动加载看板主数据
    for (let i = 0; i < 3; i++) {
      await qcPage.evaluate(() => window.scrollBy(0, 400)).catch(()=>{});
      await qcPage.waitForTimeout(rnd(800, 1500));
    }
    await qcPage.evaluate(() => window.scrollTo(0, 0)).catch(()=>{});
    await qcPage.waitForTimeout(rnd(1000, 2000));

    console.log('\n[12] Clicking 全域支付数据...');
    for (let retry = 0; retry < 3; retry++) {
      const ok = await jsClickByText(qcPage, '全域支付数据', '全域支付数据');
      if (ok) break;
      await qcPage.waitForTimeout(rnd(1000, 2000));
    }
    await qcPage.waitForTimeout(rnd(3000, 5000));
    console.log('[12] 全域支付数据 clicked, APIs captured');

    // ── 截图：巨量千川 ──
    try {
      await qcPage.evaluate(() => window.scrollTo(0,0)).catch(()=>{});
      // 等图表完整渲染
      await qcPage.waitForTimeout(rnd(5000, 7000));

      // 关闭弹窗/引导
      await dismissGuides(qcPage);
      await qcPage.keyboard.press('Escape').catch(()=>{});
      await qcPage.waitForTimeout(600);

      // CSS 注入隐藏浮层：tippy tooltip（黄色公告条）+ 其他 overlay
      await qcPage.evaluate(() => {
        const style = document.createElement('style');
        style.id = '__hide_overlays__';
        style.textContent = [
          '[data-tippy-root]', '.tippy-box', '.tippy-content', '.tippy-popper',
          '.notice-box', '.ovui-alert', '.alert-box',
          '[class*="guide-mask"]',
        ].join(',') + '{ display:none!important; visibility:hidden!important; opacity:0!important; }';
        document.head.appendChild(style);
      }).catch(()=>{});
      await qcPage.waitForTimeout(400);

      // 额外停顿，确保图表/数字渲染完再截图
      await qcPage.waitForTimeout(rnd(2000, 3000));

      // DOM 原生标签注入（替代旧 PIL 叠字）：
      // 千川 KPI 标签文字锁在 .card-item > .metric-name 内的 oc-popover/.width-desc 里，
      // 无头下组件宽度测量=0 永久 display:none → 标签不可见（但文字在 DOM 里真实存在）。
      // 做法：把 .width-desc 真文字写进 .metric-name 容器并清掉坏组件，浏览器原生渲染后截图直接捕获。
      // ── 视觉可调常量（首轮按真实截图微调）──
      const LABEL_CSS = 'color:#c2cbdb;font-size:13px;line-height:18px;white-space:nowrap;font-weight:400;font-family:inherit;letter-spacing:0;text-align:left;';
      try {
        const injected = await qcPage.evaluate((css) => {
          let n = 0;
          document.querySelectorAll('.card-item').forEach(card => {
            const desc = card.querySelector('.width-desc');
            const nameBox = card.querySelector('.metric-name');
            if (!desc || !nameBox) return;
            const text = desc.textContent.trim();
            if (!text) return;
            const lbl = document.createElement('div');
            lbl.className = '__inj_metric_label';
            lbl.textContent = text;
            lbl.style.cssText = css;
            nameBox.innerHTML = '';        // 清掉坏掉的 oc-popover 占位
            nameBox.appendChild(lbl);
            n++;
          });
          return n;
        }, LABEL_CSS);
        console.log('[12] DOM 原生标签注入:', injected, '个 KPI');
      } catch(e) { console.log('[12] 标签注入失败:', e.message.slice(0,80)); }
      await qcPage.waitForTimeout(400);   // 让注入元素 paint 一帧
      await qcPage.screenshot({ path: '/tmp/sc_qc.png', fullPage: false });
      // 还原：移除注入 CSS
      await qcPage.evaluate(() => {
        const s = document.getElementById('__hide_overlays__');
        if (s) s.remove();
      }).catch(()=>{});
      console.log('[12] Screenshot: 千川 saved');
    } catch(e) { console.log('[12] Screenshot qc failed:', e.message.substring(0,60)); }


    // STEP 12b: 素材数据 tab
    console.log("[12b] Clicking 素材数据 tab...");
    let creativeTabClicked = false;
    const creativeTabEl = await qcPage.evaluate(() => {
      const tabs = Array.from(document.querySelectorAll(".ant-tabs-tab, div[role=tab], li[role=tab]"));
      const match = tabs.find(el => el.textContent.trim().includes("素材"));
      if (match) { match.click(); return match.textContent.trim(); }
      return null;
    }).catch(() => null);
    if (creativeTabEl) {
      console.log("[12b] Tab clicked: " + creativeTabEl);
      creativeTabClicked = true;
    } else {
      for (const lb of ["素材数据", "创意数据", "素材"]) {
        const ok = await jsClickByText(qcPage, lb, "素材tab");
        if (ok) { creativeTabClicked = true; console.log("[12b] jsClick: " + lb); break; }
      }
    }
    if (creativeTabClicked) {
      await qcPage.waitForTimeout(rnd(4000, 6000));
      for (let i = 0; i < 3; i++) {
        await qcPage.evaluate(() => window.scrollBy(0, 400)).catch(() => {});
        await qcPage.waitForTimeout(rnd(800, 1500));
      }
      console.log("[12b] creative_requests captured: " + creativeRequests.length);
    } else {
      console.log("[12b] WARN: 素材数据 tab not found");
    }

    // STEP 12c: 素材趋势 tab
    console.log("[12c] Clicking 素材趋势 tab...");
    const trendTabEl = await qcPage.evaluate(() => {
      const tabs = Array.from(document.querySelectorAll(".ant-tabs-tab, div[role=tab], li[role=tab]"));
      const match = tabs.find(el => el.textContent.trim().includes("素材趋势"));
      if (match) { match.click(); return match.textContent.trim(); }
      return null;
    }).catch(() => null);
    if (trendTabEl) {
      console.log("[12c] Tab clicked: " + trendTabEl);
      await qcPage.waitForTimeout(rnd(4000, 6000));
      console.log("[12c] creative_requests after trend: " + creativeRequests.length);
    } else {
      const trendOk = await jsClickByText(qcPage, "素材趋势", "素材趋势tab");
      if (trendOk) {
        console.log("[12c] jsClick: 素材趋势");
        await qcPage.waitForTimeout(rnd(4000, 6000));
        console.log("[12c] creative_requests after trend: " + creativeRequests.length);
      } else {
        console.log("[12c] WARN: 素材趋势 tab not found");
      }
    }

    // ═══════════════════════════════════════════════════
    // STEP 13 — 两次点击刷新：直播间核心漏斗区域
    // 第一步：点击左侧/核心漏斗区域触发素材/计划级数据
    // 第二步：重复一次确保所有计划数据加载
    // ═══════════════════════════════════════════════════
    console.log('\n[13] Step 1: clicking 直播间核心漏斗 area...');
    let step13Clicked = false;
    for (const label of ['智能投放', '素材数据', '直播间核心漏斗', '成交渠道构成']) {
      const ok = await jsClickByText(qcPage, label, label);
      if (ok) {
        await qcPage.waitForTimeout(rnd(2500, 4500));
        console.log('[13] Clicked:', label);
        step13Clicked = true;
        break;
      }
    }
    if (!step13Clicked) {
      // 备用：点击看板主内容区中间
      await qcPage.evaluate(() => window.scrollTo(0, 0)).catch(()=>{});
      await qcPage.waitForTimeout(rnd(800, 1500));
    }

    console.log('[13] Step 2: repeating click to refresh data...');
    for (const label of ['全域支付数据', '直播支付数据']) {
      const ok = await jsClickByText(qcPage, label, label + '_retry');
      if (ok) {
        await qcPage.waitForTimeout(rnd(2500, 4000));
        console.log('[13] Retry clicked:', label);
        break;
      }
    }
    // 最终滚动确保所有懒加载内容触发
    for (let i = 0; i < 4; i++) {
      await qcPage.evaluate(() => window.scrollBy(0, 300)).catch(()=>{});
      await qcPage.waitForTimeout(rnd(600, 1200));
    }
    console.log('[13] Done');
  } else {
    console.log('[11] WARN: Could not navigate to Qianchuan board');
  }

  // ═══════════════════════════════════════════════════
  // 汇总 & 存档
  // ═══════════════════════════════════════════════════
  const screenAPIs   = allAPIs.filter(a => a.url.includes('live_screen') || a.url.includes('/screen/live/'));
  const qcAPIs       = allAPIs.filter(a => a.url.includes('qianchuan') || a.url.includes('compass/jump-version') || a.url.includes('ad/api/data/compass'));
  const productAPIs  = allAPIs.filter(a => a.url.includes('product'));
  const crowdAPIs    = allAPIs.filter(a => a.url.includes('crowd') || a.url.includes('portrait'));

  console.log('\n=== API SUMMARY ===');
  console.log('Screen APIs:    ', screenAPIs.length);
  console.log('Qianchuan APIs: ', qcAPIs.length);
  console.log('Product APIs:   ', productAPIs.length);
  console.log('Crowd APIs:     ', crowdAPIs.length);
  console.log('All APIs:       ', allAPIs.length);
  allAPIs.forEach(a => console.log('  |', a.status, a.url.split('?')[0]));

  const bjNow   = new Date(Date.now() + 8*3600*1000);
  const bjStr   = bjNow.toISOString().replace('T','_').substring(0,13);
  const archivePath = '/opt/douyin-fetcher/data/screen_' + bjStr + '.json';

  const archiveData = {
    capturedAt: new Date().toISOString(),
    bjHour: bjStr,
    live_room_id: liveRoomId,
    screen_url: screenPage.url(),
    qianchuan_url: qcPage ? qcPage.url() : '',
    screen_api_count:    screenAPIs.length,
    qianchuan_api_count: qcAPIs.length,
    product_api_count:   productAPIs.length,
    crowd_api_count:     crowdAPIs.length,
    creative_requests: creativeRequests,
    screen_apis:    screenAPIs,
    qianchuan_apis: qcAPIs,
    product_apis:   productAPIs,
    crowd_apis:     crowdAPIs,
    all_apis:       allAPIs,
  };
  fs.mkdirSync('/opt/douyin-fetcher/data', { recursive:true });
  fs.writeFileSync(archivePath, JSON.stringify(archiveData, null, 2));
  console.log('[ARCHIVE] Saved to', archivePath);

  // screen_clean.json（供后续 n8n 清洗）
  fs.writeFileSync(SCREEN_OUT, JSON.stringify(archiveData, null, 2));

  const total = screenAPIs.length + qcAPIs.length;
  const msg = total > 0
    ? '✅ [大屏+千川] 数据服务器保存成功'
    : '⚠️ [大屏+千川] 本次抓取异常：未命中任何 API（screen=' + screenAPIs.length + ' qc=' + qcAPIs.length + ')';
  larkSend(msg);

  // ── 发飞书截图（专业版 + 基础版 + 千川）──
  try {
    const bjTimeStr = new Date(Date.now() + 8*3600*1000).toISOString().substring(0,16).replace('T',' ');
    const shots = [
      { path: '/tmp/sc_pro.png',   label: '📊 直播大屏 专业版' },
      { path: '/tmp/sc_basic.png', label: '📺 直播大屏 基础版' },
      { path: '/tmp/sc_qc.png',    label: '💰 巨量千川' },
    ];
    const exists = shots.filter(s => fs.existsSync(s.path));
    if (exists.length > 0) {
      larkSend('📸 ' + bjTimeStr + ' 直播大屏截图（共' + exists.length + '张）');
      for (const s of exists) {
        larkSend(s.label);
        larkSendImage(s.path);
      }
      console.log('[SHOT] Sent', exists.length, 'screenshots to Feishu');
    }
  } catch(e) { console.log('[SHOT] Send failed:', e.message.substring(0,60)); }

  await context.storageState({ path: STORAGE_FILE });
  console.log('[AUTH] storageState saved');
  await _browser.close();
}

main().catch(async err => {
  console.error('[FATAL]', err.message);
  larkSend('FATAL [SCREEN]: ' + err.message.substring(0,80));
  if (_context) await _context.storageState({ path: STORAGE_FILE }).catch(()=>{});
  if (_browser) await _browser.close().catch(()=>{});
  process.exit(1);
});
