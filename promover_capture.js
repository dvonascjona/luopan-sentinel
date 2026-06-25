// promover_capture.js v1.1 — 抖店乘方素材数据采集
// 按截图9步：fxg登录 → 抖店工作台 → 巨量千川 → 乘方 → 素材100条
// 策略：先用现有 qianchuan cookies 直跳乘方；失败再走 fxg QR 登录流
// v1.1: Step9b 改为计划行「直播大屏」旁「素材」精确定位；新增 Step9c 点「视频」子tab

'use strict';
const { execSync } = require('child_process');
const fs = require('fs');

const STORAGE_FILE = '/opt/douyin-fetcher/full_storage_state.json';
const FXG_STORAGE  = '/opt/douyin-fetcher/fxg_storage_state.json';
const OUT_FILE     = '/opt/douyin-fetcher/data/promover_clean.json';
const CHAT_ID      = 'oc_af2b50b253a140dafe12c2d2a1acd9e9';
const AAVID        = '1845951364198153';
const SHOP_ID      = '235448269';

function larkSend(msg) {
  try {
    execSync('lark-cli im +messages-send --chat-id ' + CHAT_ID +
      ' --text "' + msg.replace(/"/g, "'") + '" --as bot',
      { encoding: 'utf8', timeout: 10000, stdio: 'pipe' });
  } catch (e) { console.log('lark err:', e.message.slice(0, 60)); }
}

async function larkSendImage(base64) {
  const tmp = '/tmp/promover_qr.png';
  fs.writeFileSync(tmp, Buffer.from(base64, 'base64'));
  try {
    execSync('lark-cli im +messages-send --chat-id ' + CHAT_ID +
      ' --file-path ' + tmp + ' --as bot',
      { encoding: 'utf8', timeout: 15000, stdio: 'pipe' });
    console.log('[QR] image sent to Feishu');
  } catch (e) {
    larkSend('[乘方] QR已存 /tmp/promover_qr.png，请发手机扫');
  }
}

let _browser, _context;

async function main() {
  const rnd = (a, b) => Math.floor(a + Math.random() * (b - a));
  const { launch } = await import('/opt/douyin-fetcher/node_modules/cloakbrowser/dist/index.js');

  // 优先用 fxg 专属 state，其次用全局 state（含 qianchuan cookies）
  const stateFile = fs.existsSync(FXG_STORAGE) ? FXG_STORAGE
                  : fs.existsSync(STORAGE_FILE) ? STORAGE_FILE : null;
  console.log('[INIT] storageState:', stateFile || 'none');

  _browser = await launch({ headless: true, locale: 'zh-CN', timezone: 'Asia/Shanghai' });
  const context = await _browser.newContext({
    ...(stateFile ? { storageState: stateFile } : {}),
    ignoreHTTPSErrors: true,
    extraHTTPHeaders: { 'Accept-Language': 'zh-CN,zh;q=0.9' },
  });
  _context = context;

  // ── API 拦截 ──────────────────────────────────────────────────────────
  const allAPIs = [];
  const statRequests = [];
  context.on('request', req => {
    if (req.method() === 'POST' && req.url().includes('statQuery')) {
      const rf = (req.url().split('reqFrom=')[1] || '?').split('&')[0];
      statRequests.push({ reqFrom: rf, url: req.url(), postData: req.postData() || '' });
      console.log('[REQ] statQuery reqFrom=' + rf);
    }
  });
  context.on('response', async resp => {
    const url = resp.url();
    if (!url.includes('qianchuan') && !url.includes('jinritemai') && !url.includes('zijieapi')) return;
    const ct = resp.headers()['content-type'] || '';
    if (!ct.includes('json')) return;
    const body = await resp.json().catch(() => null);
    if (!body) return;
    allAPIs.push({ url, status: resp.status(), body });
    if (url.includes('statQuery') || url.includes('uni-promover'))
      console.log('[API]', resp.status(), url.split('?')[0]);
  });

  const page = await context.newPage();

  // ── 策略1: 直接跳乘方（复用已有 qianchuan cookies）──────────────────
  const bjDate = new Date(Date.now() + 8 * 3600 * 1000).toISOString().substring(0, 10);
  const promoverUrl = 'https://qianchuan.jinritemai.com/uni-promover/all' +
    '?aavid=' + AAVID + '&awemeId=&ct=1&dr=' + bjDate + '%2C' + bjDate +
    '&sourceFrom=&utm_source=qianchuan-ori';

  // 无 fxg_storage_state: 乘方需要 douShop session，强制 fxg 登录
  const hasFxgState = fs.existsSync(FXG_STORAGE);
  let onPromover = false;

  if (hasFxgState) {
    console.log("[STEP1] fxg state 存在，先跳千川首页初始化 Session...");
    const qcHome = 'https://qianchuan.jinritemai.com/home?aavid=' + AAVID + '&shopId=' + SHOP_ID + '&source=douShop';
    await page.goto(qcHome, { waitUntil: 'load', timeout: 30000 });
    await page.waitForTimeout(rnd(3000, 5000));
    const homeUrl = page.url();
    console.log("[STEP1] home landing:", homeUrl.substring(0, 100));

    if (homeUrl.includes('/login')) {
      console.log("[STEP1] home redirect to login — fxg cookies failed");
    } else {
      console.log("[STEP1] home OK，点击导航「乘方」...");
      // 点击顶部导航「乘方」
      const clickedLuopan = await page.evaluate(() => {
        const els = Array.from(document.querySelectorAll('a, li, div, span, button'));
        const el = els.find(e => e.textContent.trim() === '乘方');
        if (el) { el.scrollIntoView({ block: 'center' }); el.click(); return true; }
        return false;
      });
      if (clickedLuopan) {
        console.log("[STEP1] 点击「乘方」成功，等待路由跳转...");
        await page.waitForTimeout(rnd(4000, 6000));
      } else {
        console.log("[STEP1] WARN: 未找到「乘方」nav item，直跳URL...");
        await page.goto(promoverUrl, { waitUntil: 'load', timeout: 30000 });
        await page.waitForTimeout(rnd(3000, 5000));
      }
      // Set date range (today) via URL if not already on promoverUrl
      const currentUrl = page.url();
      if (!currentUrl.includes('uni-prom') && !currentUrl.includes('qianchuan')) {
        // fallback: direct navigate if nav click went wrong
        await page.goto(promoverUrl, { waitUntil: 'load', timeout: 30000 });
        await page.waitForTimeout(rnd(3000, 5000));
      }
      const urlCheck = page.url();
      console.log("[STEP1] 乘方 landing URL:", urlCheck.substring(0, 100));
      onPromover = (urlCheck.includes("uni-prom") || urlCheck.includes("qianchuan")) && !urlCheck.includes("/login");
    }
  } else {
    console.log("[STEP1] 无 fxg state，跳过直跳，必须扫码");
  }

  if (!onPromover) {
    const reason = hasFxgState ? "fxg cookies 已失效" : "首次运行，无 fxg cookies";
    console.log("[STEP1]", reason, "→ 进入 fxg 登录流...");
    larkSend("🔐 [乘方] " + reason + "，即将发飞书二维码，请扫码");
    // STEP 1：进入 fxg login
    const FXG_LOGIN = 'https://fxg.jinritemai.com/login/common';
    console.log('\n[FXG-1] goto', FXG_LOGIN);
    await page.goto(FXG_LOGIN, { waitUntil: 'load', timeout: 45000 });
    await page.waitForTimeout(rnd(2000, 3500));

    // QR 拦截注册（覆盖当前 + 未来新开的 page）
    let qrBase64 = null;
    const interceptQR = async (resp) => {
      if (resp.url().includes('get_qrcode') || resp.url().includes('qrcode')) {
        const body = await resp.json().catch(() => null);
        const qr = body?.data?.qrcode || body?.data?.qr_code || body?.data?.url;
        if (qr && qr.length > 50 && !qrBase64) qrBase64 = qr;
      }
    };
    context.on('response', interceptQR);

    // STEP 2: 点抖音图标
    await page.waitForTimeout(rnd(1000, 2000));
    await page.evaluate(() => {
      const els = Array.from(document.querySelectorAll('*'));
      // 找带"抖音"文字或 data-source/class 含 douyin 的元素
      const el = els.find(e =>
        (e.tagName === 'LI' || e.tagName === 'DIV' || e.tagName === 'SPAN') &&
        (e.textContent.trim() === '抖音' || (e.getAttribute('class') || '').includes('douyin') ||
         (e.getAttribute('data-source') || '') === 'douyin')
      );
      if (el) { el.scrollIntoView({ block: 'center' }); el.click(); }
    });
    console.log('[FXG-2] clicked 抖音');
    await page.waitForTimeout(rnd(1500, 3000));

    // 找 qrconnect iframe → 另开 page 直跳（复用 qr_login_cloak.mjs v2.0 方案）
    const iframeSrc = await page.evaluate(() => {
      const el = document.querySelector('iframe[src*="qrconnect"], iframe[src*="open.douyin"]');
      return el?.src || null;
    });
    if (iframeSrc) {
      console.log('[FXG-2] iframe found:', iframeSrc.substring(0, 80));
      const qrPage = await context.newPage();
      qrPage.on('response', interceptQR);
      await qrPage.goto(iframeSrc, { waitUntil: 'networkidle', timeout: 20000 }).catch(() => {});
      await qrPage.waitForTimeout(rnd(2000, 3500));
    }

    // 等 QR code（最多 20s）
    for (let i = 0; i < 40 && !qrBase64; i++) await page.waitForTimeout(500);

    // STEP 3: 发飞书
    if (qrBase64) {
      await larkSendImage(qrBase64);
      larkSend('📱 [乘方] 请手机抖音 APP 扫码 → 选「抖店工作台」');
    } else {
      await page.screenshot({ path: '/tmp/promover_login.png', fullPage: false });
      larkSend('⚠️ [乘方] 未截获 QR code，截图: /tmp/promover_login.png');
    }

    // STEP 3: 等扫码成功（3分钟）
    console.log('[FXG-3] 等待扫码...');
    let scanned = false;
    const deadline = Date.now() + 180000;
    while (Date.now() < deadline) {
      await page.waitForTimeout(2000);
      for (const p of context.pages()) {
        const u = p.url();
        if (u.includes('fxg.jinritemai.com') && !u.includes('/login')) {
          scanned = true; break;
        }
      }
      if (scanned) break;
    }
    if (!scanned) throw new Error('FXG 扫码超时 (3min)');
    console.log('[FXG-3] 扫码成功！URL:', page.url().substring(0, 80));

    // STEP 4: 选「抖店工作台」
    await page.waitForTimeout(rnd(1000, 2000));
    await page.evaluate(() => {
      const els = Array.from(document.querySelectorAll('*'));
      const el = els.find(e => e.textContent.trim() === '抖店工作台');
      if (el) el.click();
    });
    console.log('[FXG-4] selected 抖店工作台');
    await page.waitForTimeout(rnd(2000, 3500));

    // STEP 5: 抖店首页 + 关广告
    const FXG_HOME = 'https://fxg.jinritemai.com/ffam/shop/homepage/index';
    if (!page.url().includes('homepage')) {
      await page.goto(FXG_HOME, { waitUntil: 'networkidle', timeout: 30000 });
    }
    await page.waitForTimeout(rnd(1500, 3000));
    // 关弹窗广告（点叉号）
    const closed = await page.evaluate(() => {
      const closeEls = document.querySelectorAll(
        '.ant-modal-close, [aria-label="close"], [aria-label="关闭"], ' +
        '[class*="close-btn"], [class*="closeBtn"], [class*="modal-close"]'
      );
      for (const el of closeEls) {
        if (el.getBoundingClientRect().width > 0) { el.click(); return true; }
      }
      return false;
    });
    if (closed) { console.log('[FXG-5] 广告已关'); await page.waitForTimeout(rnd(500, 1000)); }

    // STEP 6: 点击「巨量千川」
    console.log('[FXG-6] clicking 巨量千川...');
    await page.evaluate(() => {
      const els = Array.from(document.querySelectorAll('a, button, div, span, li'));
      const el = els.find(e => e.textContent.trim().includes('巨量千川'));
      if (el) { el.scrollIntoView({ block: 'center' }); el.click(); }
    });
    await page.waitForTimeout(rnd(3000, 5000));

    // STEP 7: 等千川页面（可能新 tab）
    let qcPage = page;
    for (const p of context.pages()) {
      if (p.url().includes('qianchuan.jinritemai.com')) { qcPage = p; break; }
    }
    if (!qcPage.url().includes('qianchuan')) {
      console.log('[FXG-7] 直跳 qianchuan home...');
      await qcPage.goto(
        'https://qianchuan.jinritemai.com/home?aavid=' + AAVID + '&shopId=' + SHOP_ID + '&source=douShop',
        { waitUntil: 'networkidle', timeout: 30000 }
      );
    }
    console.log('[FXG-7] qc URL:', qcPage.url().substring(0, 100));
    await qcPage.waitForTimeout(rnd(2000, 3500));

    // STEP 8: 跳乘方（直接导航比点按钮稳定）
    console.log('[FXG-8] 跳乘方...');
    await page.goto(promoverUrl, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(rnd(3000, 5000));
    console.log('[FXG-8] 乘方URL:', page.url().substring(0, 100));

    // 保存 fxg storageState
    await context.storageState({ path: FXG_STORAGE });
    console.log('[FXG] saved fxg_storage_state.json');
    larkSend('✅ [乘方] 登录成功，Cookie 已保存');
  }

  // ── STEP 9: 素材区 — 关弹窗 + 等待表格 + 滚动 + 设100条/页 ────────
  console.log('\n[STEP9] 关防诈提示弹窗...');

  // 关「防诈提示」3页弹窗（每次点「我知道了」）
  for (let closeRound = 0; closeRound < 5; closeRound++) {
    const modalClosed = await page.evaluate(() => {
      // 找「我知道了」或「关闭」按钮
      const btns = Array.from(document.querySelectorAll('button, span, a'));
      const btn = btns.find(el => {
        const t = el.textContent.trim();
        return t === '我知道了' || t === '关闭' || t === '确定';
      });
      if (btn && btn.getBoundingClientRect().width > 0) {
        btn.click();
        return true;
      }
      return false;
    });
    if (modalClosed) {
      console.log('[STEP9] 关弹窗', closeRound + 1);
      await page.waitForTimeout(600);
    } else {
      break;
    }
  }
  await page.waitForTimeout(1500);

  // 等表格出现（最多15s）
  const tableVisible = await page.waitForSelector(
    '.ant-table-tbody, .recharts-wrapper, [class*="table-content"], [class*="campaign-list"]',
    { timeout: 30000 }
  ).then(() => true).catch(() => false);
  console.log('[STEP9] table visible:', tableVisible);

  // 截图2：等表格后
  await page.screenshot({ path: '/tmp/promover_step9b.png', fullPage: false });




  // 多轮滚动触发懒加载 API
  for (let i = 0; i < 5; i++) {
    await page.evaluate(() => window.scrollBy(0, 500)).catch(() => {});
    await page.waitForTimeout(rnd(600, 1200));
  }
  await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
  await page.waitForTimeout(rnd(800, 1500));

  // 设每页 100 条
  const pagerFound = await page.evaluate(() => {
    const pageOpts = document.querySelector('.ant-pagination-options');
    if (!pageOpts) return false;
    const sel = pageOpts.querySelector('.ant-select-selector');
    if (!sel) return false;
    sel.scrollIntoView({ block: 'center' });
    sel.click();
    return true;
  });
  if (pagerFound) {
    await page.waitForTimeout(rnd(500, 1000));
    const set100 = await page.evaluate(() => {
      const items = document.querySelectorAll(
        '.ant-select-item-option, .rc-virtual-list-holder-inner .ant-select-item'
      );
      const opt = Array.from(items).find(el => el.textContent.trim().match(/^100/));
      if (opt) { opt.click(); return true; }
      return false;
    });
    if (set100) {
      console.log('[STEP9] 已设100条/页');
      await page.waitForTimeout(rnd(2000, 4000));
    } else {
      console.log('[STEP9] WARN: 100条选项未找到');
    }
  } else {
    console.log('[STEP9] WARN: 分页器未找到，仅滚动采集');
  }

  // 最终滚动确保完全加载
  for (let i = 0; i < 4; i++) {
    await page.evaluate(() => window.scrollBy(0, 400)).catch(() => {});
    await page.waitForTimeout(rnd(500, 1000));
  }

  console.log('[STEP9] 完成 | allAPIs:', allAPIs.length, '| statRequests:', statRequests.length);

  // ── STEP 9b: 计划行里点「素材」按钮 → 进计划详情素材tab ────────────
  // 目标：点的是计划列表行里「直播大屏」旁边的「素材」，不是导航/其他元素
  console.log('\n[STEP9b] 在计划行找「素材」按钮（直播大屏旁边）...');

  // DEBUG：精确文字等于"素材"的元素
  const materialDebug = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('a, span, button, td, div'))
      .filter(el => el.textContent.trim() === '素材')
      .map(el => {
        const r = el.getBoundingClientRect();
        return {
          tag: el.tagName,
          text: el.textContent.trim().substring(0, 30),
          href: el.href || null,
          cls: el.className.substring(0, 60),
          rect: `${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.width)}x${Math.round(r.height)}`,
        };
      })
      .slice(0, 20);
  });
  console.log('[STEP9b DEBUG] 精确匹配"素材"元素:', JSON.stringify(materialDebug, null, 2));

  // 策略1（精确）：用 class 含 live-adinfo-material 直接定位
  // 策略2（备选）：找和「直播大屏」同容器的「素材」，向上最多6层
  const materialBtnClicked = await page.evaluate(() => {
    // 策略1: class 含 live-adinfo-material（由 DEBUG 日志确认的精确 class）
    const byClass = document.querySelector(
      '[class*="live-adinfo-material"], [class*="adinfo-material"]'
    );
    if (byClass && byClass.getBoundingClientRect().width > 0) {
      byClass.scrollIntoView({ block: 'center' });
      byClass.click();
      return { found: true, strategy: 'class', cls: byClass.className.substring(0, 60) };
    }

    // 策略2: 找文字等于「直播大屏」的元素，在其祖先里找「素材」
    const liveScreenEls = Array.from(document.querySelectorAll('*'))
      .filter(el => el.textContent.trim() === '直播大屏' && el.getBoundingClientRect().width > 0);
    for (const lsEl of liveScreenEls) {
      let parent = lsEl.parentElement;
      for (let depth = 0; depth < 8; depth++) {
        if (!parent) break;
        const matEl = Array.from(parent.querySelectorAll('*'))
          .find(el => el.textContent.trim() === '素材' && el !== lsEl &&
                      el.getBoundingClientRect().width > 0);
        if (matEl) {
          matEl.scrollIntoView({ block: 'center' });
          matEl.click();
          return { found: true, strategy: 'sibling', depth, cls: matEl.className.substring(0, 40) };
        }
        parent = parent.parentElement;
      }
    }

    // 策略3: href 含 uni-prom 且文字精确等于「素材」的 <a>
    const detailLink = Array.from(document.querySelectorAll('a'))
      .find(el => (el.href || '').includes('uni-prom') && el.textContent.trim() === '素材');
    if (detailLink) {
      detailLink.click();
      return { found: true, strategy: 'href-fallback', cls: '' };
    }

    return { found: false };
  });
  console.log('[STEP9b] 点击结果:', JSON.stringify(materialBtnClicked));

  if (materialBtnClicked.found) {
    console.log('[STEP9b] 等待计划详情页加载...');
    await page.waitForTimeout(rnd(3000, 5000));
    await page.screenshot({ path: '/tmp/promover_step9b_detail.png', fullPage: false });
    console.log('[STEP9b] 当前URL:', page.url().substring(0, 120));

    // ── STEP 9c: 关弹窗 → 点「视频」子tab → 设100条/页 → 采集全量 ──────
    // 素材tab下有子tab：直播间画面 | 视频 | AIGC | 其他素材 | 标题
    console.log('\n[STEP9c] 关所有弹窗...');

    // 关弹窗：同时覆盖 X 按钮（ant-modal-close）+ 文字按钮（我知道了/关闭/确定）
    for (let i = 0; i < 6; i++) {
      const closed = await page.evaluate(() => {
        // 优先找 ant-modal X 关闭按钮
        const xSelectors = [
          '.ant-modal-close', '.ant-modal-close-x',
          '[aria-label="Close"]', '[aria-label="close"]',
          '[class*="modal-close"]', '[class*="close-icon"]',
          '[class*="closeBtn"]', '[class*="close-btn"]',
        ];
        for (const sel of xSelectors) {
          const el = document.querySelector(sel);
          if (el && el.getBoundingClientRect().width > 0) { el.click(); return 'x-btn:' + sel; }
        }
        // 文字按钮（我知道了/关闭/确定）
        const textBtn = Array.from(document.querySelectorAll('button, span, a'))
          .find(el => ['我知道了', '关闭', '确定'].includes(el.textContent.trim()) &&
                      el.getBoundingClientRect().width > 0);
        if (textBtn) { textBtn.click(); return 'text:' + textBtn.textContent.trim(); }
        return null;
      });
      if (closed) {
        console.log('[STEP9c] 关弹窗:', closed);
        await page.waitForTimeout(600);
      } else break;
    }
    await page.waitForTimeout(1000);

    // 点「视频」子tab
    const videoTabClicked = await page.evaluate(() => {
      const candidates = Array.from(document.querySelectorAll(
        '.ant-tabs-tab, [role="tab"], [class*="tab-item"], span, div'
      )).filter(el => {
        const t = el.textContent.trim();
        const r = el.getBoundingClientRect();
        return t === '视频' && r.width > 0 && r.height > 0;
      });
      if (candidates.length === 0) return false;
      const tab = candidates.find(el => el.getAttribute('role') === 'tab') || candidates[0];
      tab.scrollIntoView({ block: 'center' });
      tab.click();
      return true;
    });
    console.log('[STEP9c] 视频tab点击:', videoTabClicked);

    // 等视频列表 API 真正回来（监测 material/list-required 新增一次）
    const matCountBefore = allAPIs.filter(a => a.url.includes('material/list-required')).length;
    console.log('[STEP9c] 等待 material/list-required API（当前:', matCountBefore, ')...');
    let matLoaded = false;
    for (let w = 0; w < 30; w++) {  // 最多等 15s（30 × 500ms）
      await page.waitForTimeout(500);
      const cur = allAPIs.filter(a => a.url.includes('material/list-required')).length;
      if (cur > matCountBefore) { matLoaded = true; console.log('[STEP9c] API到达，共', cur, '次'); break; }
    }
    if (!matLoaded) console.log('[STEP9c] WARN: 15s内未见新 material API，继续尝试...');
    await page.waitForTimeout(rnd(1500, 2000));  // 额外等渲染完成

    // 关可能再次出现的弹窗
    for (let i = 0; i < 3; i++) {
      const closed = await page.evaluate(() => {
        const xSelectors = ['.ant-modal-close', '.ant-modal-close-x', '[class*="modal-close"]'];
        for (const sel of xSelectors) {
          const el = document.querySelector(sel);
          if (el && el.getBoundingClientRect().width > 0) { el.click(); return true; }
        }
        return false;
      });
      if (closed) { await page.waitForTimeout(500); } else break;
    }

    // 截图 debug（分页器操作前）
    await page.screenshot({ path: '/tmp/promover_before_pager.png', fullPage: false });

    // 滚动到底部（window + overflow容器）
    await page.evaluate(() => {
      window.scrollTo(0, document.body.scrollHeight);
      // 也滚动所有 overflow 容器
      document.querySelectorAll('*').forEach(el => {
        if (el.scrollHeight > el.clientHeight + 50 &&
            ['auto','scroll'].includes(getComputedStyle(el).overflowY)) {
          el.scrollTo(0, el.scrollHeight);
        }
      });
    });
    await page.waitForTimeout(rnd(1000, 1500));

    // JS 文字遍历找分页器（不依赖 viewport 可见性）
    console.log('[STEP9c] JS 遍历找分页器...');
    let pager100Done = false;
    const pagerClicked = await page.evaluate(() => {
      // 用 TreeWalker 找包含 "条/页" 的文字节点
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        const t = node.textContent.trim();
        if (/\d+\s*条\s*[/／]\s*页/.test(t)) {
          const el = node.parentElement;
          if (!el) continue;
          el.scrollIntoView({ behavior: 'instant', block: 'center' });
          el.click();
          return { found: true, text: t, tag: el.tagName, cls: el.className.substring(0, 80) };
        }
      }
      // 备用：.ant-pagination-options > .ant-select-selector
      const opts = document.querySelector('.ant-pagination-options .ant-select-selector');
      if (opts) {
        opts.scrollIntoView({ behavior: 'instant', block: 'center' });
        opts.click();
        return { found: true, text: opts.textContent.trim(), tag: 'ant-options', cls: '' };
      }
      return { found: false };
    });
    console.log('[STEP9c] 分页器探测:', JSON.stringify(pagerClicked));

    if (pagerClicked.found) {
      await page.waitForTimeout(rnd(600, 1000));
      // 找并点击 100条/页 选项（在弹出的下拉里）
      const opt100Clicked = await page.evaluate(() => {
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        let node;
        while ((node = walker.nextNode())) {
          const t = node.textContent.trim();
          if (/^100\s*条\s*[/／]\s*页$/.test(t)) {
            const el = node.parentElement;
            if (el && el.getBoundingClientRect().width > 0) {
              el.click();
              return true;
            }
          }
        }
        // 备用：li 元素里找 100
        const lis = document.querySelectorAll('.ant-select-item, [role="option"], li');
        for (const li of lis) {
          if (/100/.test(li.textContent) && /条/.test(li.textContent)) {
            li.scrollIntoView({ behavior: 'instant', block: 'center' });
            li.click();
            return true;
          }
        }
        return false;
      });
      if (opt100Clicked) {
        console.log('[STEP9c] 已选100条/页，等待全量加载...');
        await page.waitForTimeout(rnd(4000, 6000));
        pager100Done = true;
      } else {
        console.log('[STEP9c] WARN: 100条/页 选项点击失败');
      }
    } else {
      console.log('[STEP9c] WARN: 分页器未找到，仅采集当前页');
    }

    await page.screenshot({ path: '/tmp/promover_step9c.png', fullPage: false });

    // 滚动确保全部53条触发 API
    for (let i = 0; i < 8; i++) {
      await page.evaluate(() => window.scrollBy(0, 400)).catch(() => {});
      await page.waitForTimeout(rnd(500, 900));
    }
    await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
    await page.waitForTimeout(rnd(1000, 2000));
    console.log('[STEP9c] 完毕 | allAPIs now:', allAPIs.length);

  } else {
    console.log('[STEP9b] WARN: 未找到计划行「素材」按钮，跳过');
    await page.screenshot({ path: '/tmp/promover_step9b_fail.png', fullPage: false });
  }

  // ── 存档 ─────────────────────────────────────────────────────────────
  const promoverAPIs = allAPIs.filter(a =>
    a.url.includes('pmc') || a.url.includes('uni-prom') || a.url.includes('promotion') ||
    a.url.includes('ocean') || a.url.includes('material') || a.url.includes('statQuery') ||
    a.url.includes('creative') || a.url.includes('audit') || a.url.includes('video_list')
  );
  const bjNow  = new Date(Date.now() + 8 * 3600 * 1000);
  const bjHour = bjNow.toISOString().replace('T', '_').substring(0, 13);
  const archive = {
    capturedAt: new Date().toISOString(),
    bjHour,
    promover_url: page.url(),
    total_api_count:    allAPIs.length,
    promover_api_count: promoverAPIs.length,
    stat_request_count: statRequests.length,
    stat_requests:  statRequests,
    promover_apis:  promoverAPIs,
    all_apis:       allAPIs,
  };

  fs.mkdirSync('/opt/douyin-fetcher/data', { recursive: true });
  const archivePath = '/opt/douyin-fetcher/data/promover_' + bjHour + '.json';
  fs.writeFileSync(archivePath, JSON.stringify(archive, null, 2));
  fs.writeFileSync(OUT_FILE,    JSON.stringify(archive, null, 2));
  console.log('[ARCHIVE] saved:', archivePath);

  // 仅在走了 fxg 登录流时才保存 fxg state（避免用 buyin session 污染）
  // fxg state 已在登录流末尾保存（saveResults 不重复保存）

  const msg = promoverAPIs.length > 0
    ? '✅ [乘方] 采集成功 | ' + statRequests.length + ' statQuery | ' + promoverAPIs.length + ' API'
    : '⚠️ [乘方] 采集异常：total=' + allAPIs.length + '，promover命中=' + promoverAPIs.length;
  larkSend(msg);
  console.log('[DONE]', msg);

  await _browser.close();
}

main().catch(async err => {
  console.error('[FATAL]', err.message);
  larkSend('FATAL [乘方]: ' + err.message.slice(0, 80));
  // storageState not saved on FATAL (avoid polluting fxg state with wrong session)
  if (_browser) await _browser.close().catch(() => {});
  process.exit(1);
});


