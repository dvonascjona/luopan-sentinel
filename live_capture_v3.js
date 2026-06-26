const { execSync } = require('child_process');
const fs = require('fs');

const COOKIES_PATH = '/opt/douyin-fetcher/fresh_cookies.json';
const DATA_OUT     = '/opt/1panel/apps/memoh-service-node/data/shared/live_data.json';
const CHAT_ID      = require('./feishu_config.cjs').CHAT_ID;

const SS_MAP = { 'no_restriction':'None', 'lax':'Lax', 'strict':'Strict' };
function convertCookies(raw) {
  return raw.map(c => {
    const out = { name:c.name, value:c.value, domain:c.domain.replace(/^\./,''),
      path:c.path||'/', secure:!!c.secure, httpOnly:!!c.httpOnly };
    if (c.expirationDate && c.expirationDate>Date.now()/1000) out.expires=Math.floor(c.expirationDate);
    const ss=c.sameSite?c.sameSite.toLowerCase():null;
    if (ss && SS_MAP[ss]) out.sameSite=SS_MAP[ss];
    return out;
  });
}

function larkSend(msg) {
  try { execSync("lark-cli im +messages-send --chat-id "+CHAT_ID+" --text \""+msg.replace(/"/g,"'")+'"  --as bot', {encoding:'utf8',timeout:10000,stdio:'pipe'}); }
  catch(e){ console.log('lark err:',e.message.substring(0,60)); }
}

let _browser, _context;
const _storageFile = '/opt/douyin-fetcher/full_storage_state.json';

async function main() {
  const { launch } = await import('/opt/douyin-fetcher/node_modules/cloakbrowser/dist/index.js');
  const raw = JSON.parse(fs.readFileSync(COOKIES_PATH,'utf8'));
  const cookies = (raw[0]&&raw[0].name)?raw:convertCookies(raw);
  console.log('[INIT] Loaded',cookies.length,'cookies');

  _browser = await launch({ headless: true, locale: 'zh-CN', timezone: 'Asia/Shanghai' });

  const storageFile = _storageFile;
  let context;
  if (fs.existsSync(storageFile)) {
    console.log('[INIT] Restoring storageState');
    context = await _browser.newContext({ storageState: storageFile, ignoreHTTPSErrors: true, extraHTTPHeaders: { 'Accept-Language': 'zh-CN,zh;q=0.9' } });
  } else {
    context = await _browser.newContext({ ignoreHTTPSErrors: true, extraHTTPHeaders: { 'Accept-Language': 'zh-CN,zh;q=0.9' } });
    await context.addCookies(cookies);
  }
  _context = context;

  const allAPIs = [];
  context.on('response', async resp => {
    const url = resp.url();
    const ct = resp.headers()['content-type']||'';
    if (ct.includes('json') && (url.includes('jinritemai')||url.includes('compass.jinrite')||url.includes('zijieapi'))) {
      const body = await resp.json().catch(()=>null);
      if (!body) return;
      allAPIs.push({url, status:resp.status(), body});
      if (url.includes('compass.jinritemai')||url.includes('live-statement')||url.includes('live_detail'))
        console.log('[API:COMPASS7]', resp.status(), url.split('?')[0]);
      else if (url.includes('compass_api'))
        console.log('[API:COMPASS6]', resp.status(), url.split('?')[0]);
    }
  });

  const page = await context.newPage();

  // ── 人性化辅助函数 ──
  const rnd = (min, max) => Math.floor(min + Math.random() * (max - min));

  async function humanBrowse(pg, label) {
    const scrolls = rnd(1, 3);
    for (let i = 0; i < scrolls; i++) {
      await pg.evaluate(() => window.scrollBy(0, Math.floor(Math.random() * 350) + 80)).catch(() => {});
      await pg.waitForTimeout(rnd(800, 2500));
    }
    if (Math.random() > 0.5) {
      await pg.evaluate(() => window.scrollBy(0, -(Math.floor(Math.random() * 150) + 50))).catch(() => {});
      await pg.waitForTimeout(rnd(500, 1500));
    }
    console.log('[HUMAN] Browse done:', label);
  }

  async function checkAbnormal(pg, label) {
    const url = pg.url();
    if (!url.includes('buyin.jinritemai.com') && !url.includes('compass.jinritemai.com')) {
      larkSend('⚠️ [' + label + '] 页面跳转异常，当前URL: ' + url.substring(0, 80));
      return true;
    }
    const captchaFound = await pg.evaluate(() => {
      const sels = [
        '[class*="captcha"]', '[id*="captcha"]',
        'iframe[src*="captcha"]', '[class*="challenge"]',
      ];
      return sels.find(s => document.querySelector(s) !== null) || null;
    }).catch(() => null);
    if (captchaFound) {
      console.log('[ABNORMAL] captcha matched:', captchaFound);
      larkSend('⚠️ [' + label + '] 检测到验证码，需要人工处理');
      return true;
    }
    return false;
  }



  // ── STEP 1: Dashboard ──
  let startUrl = 'https://buyin.jinritemai.com/dashboard';
  try {
    const state = JSON.parse(fs.readFileSync('/opt/douyin-fetcher/session_state.json','utf8'));
    if (state.dashboardUrl && state.dashboardUrl.includes('buyin.jinritemai.com'))
      startUrl = state.dashboardUrl;
  } catch(e){}
  console.log('\n[1] Navigating to dashboard...');
  await page.goto(startUrl, {waitUntil:'networkidle',timeout:30000});
  await page.waitForTimeout(rnd(2500, 5000));
  const dashUrl = page.url();
  console.log('[1] URL:', dashUrl);
  if (!dashUrl.includes('buyin.jinritemai.com')) {
    larkSend('❌ Cookie已失效，请重新扫码');
    await _browser.close(); process.exit(1);
  }
  if (await checkAbnormal(page, 'Step1')) { await _browser.close(); process.exit(1); }
  await humanBrowse(page, '仪表盘');

  // ── STEP 2: 点经营 ──
  console.log('\n[2] Clicking 经营...');
  await page.click('text=经营', {timeout:8000}).catch(()=>
    page.hover('text=经营', {timeout:5000}).catch(()=>{})
  );
  await page.waitForTimeout(rnd(1000, 3000));

  // 预先注册 today_live_room 等待 Promise（必须在 Step3 之前注册，否则会错过响应）
  const todayRoomRespPromise = page.waitForResponse(
    r => r.url().includes('today_live_room'),
    { timeout: 20000 }
  ).catch(() => null);

  // ── STEP 3: 点直播明细（进入 live-list） ──
  console.log('\n[3] Clicking 直播明细 in nav dropdown...');
  let reached = false;
  // 找经营下拉里指向 compass-home 的 a 标签
  const navLinks = await page.$$('a');
  for (const el of navLinks) {
    const txt = (await el.innerText().catch(()=>'')).trim();
    const href = (await el.getAttribute('href').catch(()=>'')||'');
    if (txt==='直播明细' && href.includes('compass-home')) {
      await el.click(); reached=true; break;
    }
  }
  if (!reached) await page.click('text=直播明细',{timeout:5000}).catch(()=>{});

  await page.waitForTimeout(rnd(4000, 7000));
  const listUrl = page.url();
  console.log('[3] Live-list URL:', listUrl);
  await page.screenshot({path:'/tmp/step3_livelist.png'});

  // 如果没到 live-list，用 params 直接构造
  if (!listUrl.includes('compass-home/live-list')) {
    const m = dashUrl.match(/universal_page_params_id=([^&]+)/);
    if (m) {
      const pid = m[1];
      await page.goto(
        'https://buyin.jinritemai.com/dashboard/compass-home/live-list?pre_universal_page_params_id='+pid+'&universal_page_params_id='+pid,
        {waitUntil:'networkidle',timeout:25000}
      );
      await page.waitForTimeout(rnd(2000, 4000));
      console.log('[3] After fallback:', page.url());
    }
  }

  // ── STEP 4: 等待表格渲染，找今天那行的「直播明细」按钮 ──
  // ── STEP 4: 等待 live-list 表格渲染，点今天那行的「直播明细」按钮 ──
  console.log('\n[4] Waiting for live-list table...');

  // 等待 today_live_room API 响应（已在 Step3 前注册 Promise，能拿到最新 live_id）
  let liveId = null;
  const todayRoomResp = await todayRoomRespPromise;
  if (todayRoomResp) {
    const roomBody = await todayRoomResp.json().catch(() => null);
    if (roomBody && roomBody.data && roomBody.data.card_list && roomBody.data.card_list.length > 0) {
      const card = roomBody.data.card_list.find(c => c.live_status) || roomBody.data.card_list[0];
      liveId = card && card.live_id;
      console.log('[4] live_id from waitForResponse:', liveId);
    }
  }
  // fallback: 万一 Promise 没拿到，再查 allAPIs
  if (!liveId) {
    const todayApiData = allAPIs.find(a => a.url.includes('today_live_room'));
    if (todayApiData && todayApiData.body && todayApiData.body.data && todayApiData.body.data.card_list && todayApiData.body.data.card_list.length > 0) {
      const card = todayApiData.body.data.card_list.find(c => c.live_status) || todayApiData.body.data.card_list[0];
      liveId = card && card.live_id;
      console.log('[4] live_id from allAPIs fallback:', liveId);
    }
  }

  let compassPage = null;
  let clicked = false;

  // 有 live_id → 直接开新 tab 跳 compass，绕过表格按钮搜索
  if (liveId) {
    const compassDirectUrl = 'https://compass.jinritemai.com/talent/live-statement/?live_room_id=' + liveId + '&tab=coreTag';
    console.log('[4] Direct compass URL:', compassDirectUrl);
    compassPage = await context.newPage();
    await compassPage.goto(compassDirectUrl, { waitUntil: 'networkidle', timeout: 30000 });
    clicked = true;
    console.log('[4] Opened compass direct:', compassPage.url());
  }

  if (!compassPage) {
    // 先滚动让表格进入视口
    await page.evaluate(()=>window.scrollBy(0,500)).catch(()=>{});
    await page.waitForTimeout(rnd(2000, 4000));

    try {
    // 方法1: 找表格行里的按钮/链接（带 live_id 的）
    const btnHandle = await page.evaluateHandle((lid) => {
      const all = Array.from(document.querySelectorAll('a, button, span[class*="btn"], div[class*="btn"]'));
      // 找文字是「直播明细」且不在导航菜单里的元素
      const candidates = all.filter(el => {
        const text = el.textContent.trim();
        if (text !== '直播明细') return false;
        // 排除顶部导航里的
        const isNav = el.closest('nav, [class*="nav"], [class*="header"], [class*="menu"]');
        return !isNav;
      });
      return candidates[0] || null;
    }, liveId);

    const btn = btnHandle.asElement ? btnHandle.asElement() : null;

    if (btn) {
      console.log('[4] Found 直播明细 button in table, clicking...');
      await page.screenshot({path:'/tmp/step4_found.png'});
      const [newTab] = await Promise.all([
        context.waitForEvent('page', {timeout:12000}).catch(()=>null),
        btn.click()
      ]);
      if (newTab) {
        compassPage = newTab;
        console.log('[4] Opened in new tab:', await newTab.url());
      } else {
        await page.waitForTimeout(rnd(3000, 5500));
        const newUrl = page.url();
        if (newUrl.includes('compass.jinritemai.com')) {
          compassPage = page;
          console.log('[4] Navigated in same tab:', newUrl);
        }
      }
      clicked = true;
    } else {
      console.log('[4] No 直播明细 button found in table (not in nav)');
      // 截图调试
      await page.screenshot({path:'/tmp/step4_notfound.png'});
      // 打印页面上所有「直播明细」元素的信息
      const info = await page.evaluate(() => {
        const els = Array.from(document.querySelectorAll('a, button, span'));
        return els.filter(e=>e.textContent.trim()==='直播明细')
          .map(e=>({tag:e.tagName, cls:e.className.substring(0,60), parent:e.parentElement?.className?.substring(0,60)||''}));
      });
      console.log('[4] All 直播明细 elements:', JSON.stringify(info).substring(0,500));
    }
  } catch(e) {
    console.log('[4] Table click error:', e.message.substring(0,80));
  }

  }  // end if (!compassPage)

  // ── STEP 7: compass.jinritemai.com/talent/live-statement/ 详情页 ──
  // JS-based click helper: finds element by partial text, fires React-compatible events
  async function jsClickByText(pg, searchText, logLabel) {
    const handle = await pg.evaluateHandle((txt) => {
      // Search tab-like elements first, then widen
      const queries = [
        'div[role="tab"]',
        'li[role="tab"]',
        '.ant-tabs-tab',
        '[class*="tab-item"]',
        '[class*="tabItem"]',
        '[class*="tab_item"]',
        'span',
        'div',
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
      // Dump all visible text nodes for debugging
      const dump = await pg.evaluate((txt) => {
        const els = Array.from(document.querySelectorAll('span,div,li'));
        return els
          .filter(e => e.textContent.trim().length > 0 && e.textContent.trim().length < 30)
          .filter(e => {
            const r = e.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
          })
          .map(e => e.textContent.trim())
          .filter((v,i,a) => a.indexOf(v) === i)
          .slice(0,40)
          .join(' | ');
      }, searchText);
      console.log('[7] '+logLabel+' not found. Visible short texts:', dump.substring(0,200));
      return false;
    }

    // Scroll into view, then fire full React event chain (borrowed from registration bot pattern)
    await pg.evaluate((elem) => {
      elem.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }, el);
    await pg.waitForTimeout(rnd(300, 700));

    await pg.evaluate((elem) => {
      // Native click first (Playwright's internal)
      elem.click();
      // Then full MouseEvent chain so React synthetic handlers fire
      ['mouseenter','mouseover','mousemove','mousedown','mouseup','click'].forEach(type => {
        elem.dispatchEvent(new MouseEvent(type, {
          bubbles: true, cancelable: true, view: window,
          clientX: elem.getBoundingClientRect().left + elem.getBoundingClientRect().width/2,
          clientY: elem.getBoundingClientRect().top  + elem.getBoundingClientRect().height/2,
        }));
      });
    }, el);

    return true;
  }

  if (compassPage) {
    // Wait for page to fully stabilise after navigation
    await compassPage.waitForTimeout(rnd(5000, 8500));
    const compassUrl = compassPage.url();
    console.log('[7] Compass detail URL:', compassUrl);
    await compassPage.screenshot({path:'/tmp/step7_compass.png'});
    if (await checkAbnormal(compassPage, 'Step7-compass')) { await _browser.close(); process.exit(1); }

    if (!compassUrl.includes('compass.jinritemai.com')) {
      console.log('[7] WARN: Not on compass.jinritemai.com:', compassUrl.substring(0,80));
    }

    // 核心数据 tab — try multiple text variants
    console.log('[7] Clicking 核心数据 tab...');
    const coreClicked = await jsClickByText(compassPage, '核心数据', '核心数据');
    if (coreClicked) {
      await compassPage.waitForTimeout(rnd(2000, 4500));
      console.log('[7] 核心数据 tab active');
    }
    await compassPage.screenshot({path:'/tmp/step7_core_tab.png'});

    // 5 sub-tabs: use partial text for 流量 (avoid / regex issue) and others
    const subTabs = [
      { search: '流量',  label: '流量/转化' },
      { search: '互动',  label: '互动' },
      { search: '商品',  label: '商品' },
    ];

    for (const {search, label} of subTabs) {
      console.log('[7] Clicking sub-tab:', label);
      // Wait up to 3s for the tab to appear before clicking
      let clicked = false;
      for (let retry=0; retry<2; retry++) {
        clicked = await jsClickByText(compassPage, search, label);
        if (clicked) break;
        await compassPage.waitForTimeout(rnd(1000, 2500));
      }
      if (clicked) {
        // Wait for network to settle (new API requests triggered by tab)
        await compassPage.waitForTimeout(rnd(3000, 5500));
        console.log('[7]', label, 'OK');
      }
      await compassPage.screenshot({path:'/tmp/step7_tab_'+label.replace('/','_')+'.png'});
    }

    // Scroll to load 关键指标
    console.log('[7] Scrolling for 关键指标...');
    for (let i=0; i<4; i++) {
      await compassPage.evaluate(()=>window.scrollBy(0,400)).catch(()=>{});
      await compassPage.waitForTimeout(rnd(1000, 2500));
    }
    await compassPage.waitForTimeout(rnd(1500, 3500));
    await compassPage.screenshot({path:'/tmp/step7_scrolled.png'});
    console.log('[7] Done');
  } else {
    console.log('[7] ERROR: Could not reach compass detail page');
  }

  await page.waitForTimeout(rnd(1500, 3000));

  // 区分第6步 vs 第7步抓到的 API
  const step6APIs = allAPIs.filter(a=>a.url.includes('compass_api'));
  const step7APIs = allAPIs.filter(a=>
    a.url.includes('compass.jinritemai.com')||
    a.url.includes('live-statement')||
    (a.url.includes('live_room_id'))
  );

  console.log('\n=== API SUMMARY ===');
  console.log('Step-6 compass APIs:', step6APIs.length);
  step6APIs.forEach(a=>console.log('  6|', a.status, a.url.split('?')[0]));
  console.log('Step-7 compass APIs:', step7APIs.length);
  step7APIs.forEach(a=>console.log('  7|', a.status, a.url.split('?')[0]));

  const bjNow = new Date(Date.now()+8*3600*1000);
  const bjStr = bjNow.toISOString().replace('T','_').substring(0,13);
  const archivePath = '/opt/douyin-fetcher/data/'+bjStr+'.json';
  const archiveData = {
    capturedAt: new Date().toISOString(),
    bjHour: bjStr,
    dashboard_url: dashUrl,
    compass_detail_url: compassPage?compassPage.url():'',
    step6_count: step6APIs.length,
    step7_count: step7APIs.length,
    step6_apis: step6APIs,
    step7_apis: step7APIs,
  };
  fs.writeFileSync(archivePath, JSON.stringify(archiveData,null,2));
  console.log('[ARCHIVE] Saved to', archivePath);

  const result = {
    timestamp: new Date().toISOString(),
    dashboard_url: dashUrl,
    compass_url: compassPage?compassPage.url():'',
    step6_apis: step6APIs,
    step7_apis: step7APIs,
    all_api_urls: allAPIs.map(a=>({url:a.url.split('?')[0],status:a.status})),
  };
  fs.writeFileSync(DATA_OUT, JSON.stringify(result,null,2));

  const ok = step7APIs.length>0 ? '✅ 数据服务器保存成功' : '⚠️ 本次抓取异常：Step7未命中，Step6共'+step6APIs.length+'个';
  larkSend(ok);
  await context.storageState({ path: storageFile });
  console.log("[AUTH] storageState saved");
  await _browser.close();
}

main().catch(async err=>{
  console.error('[FATAL]',err.message);
  larkSend('FATAL: '+err.message.substring(0,80));
  if (_context) await _context.storageState({ path: _storageFile }).catch(()=>{});
  if (_browser) await _browser.close().catch(()=>{});
  process.exit(1);
});
