// qr_login_cloak.mjs — CloakBrowser 版扫码登录 v2.0
// 核心修复：直接导航到 open.douyin.com/qrconnect 页面（非 iframe），
//           从 oauth/get_qrcode API 响应拦截 base64 PNG，跳过 canvas 截图
import { launch } from "/opt/douyin-fetcher/node_modules/cloakbrowser/dist/index.js";
import { execSync } from "child_process";
import fs from "fs";
import config from "./feishu_config.cjs";
const { CHAT_ID } = config;

const QR_PATH    = "/tmp/qr_login.png";
const COOKIE_OUT = "/opt/douyin-fetcher/fresh_cookies.json";
const STATE_OUT  = "/opt/douyin-fetcher/full_storage_state.json";
const COOKIE_TMP = "/opt/douyin-fetcher/fresh_cookies.json.tmp";
const STATE_TMP  = "/opt/douyin-fetcher/full_storage_state.json.tmp";

// 启动前只清残留 .tmp —— 绝不删生产 cookie/state(COOKIE_OUT/STATE_OUT)！
// 扫码成功前采集/填表必须能继续用旧 cookie，成功后才由 renameSync 原子覆盖(CLAUDE.md 2.2)
for (const f of [COOKIE_TMP, STATE_TMP]) {
  try { fs.unlinkSync(f); console.log("[CLEAN] Removed tmp:", f); } catch(e) {}
}

async function larkSend(text) {
  try {
    execSync(
      `lark-cli im +messages-send --chat-id ${CHAT_ID} --text "${text.replace(/"/g, "'")}" --as bot`,
      { encoding: "utf8", timeout: 15000, stdio: "pipe" }
    );
  } catch(e) { console.error("[LARK]", e.message?.substring(0, 80)); }
}

async function sendQRToLark() {
  try {
    execSync(`cd /tmp && lark-cli im +messages-send --chat-id ${CHAT_ID} --image ./qr_login.png --as bot`,
      { encoding: "utf8", timeout: 30000, stdio: "pipe" });
    await larkSend("📡 罗盘哨兵请求登录授权\n请用抖音APP扫描上方二维码\n⏱ 有效期约1分钟");
    console.log("[QR] Sent to Feishu OK");
  } catch(e) { console.error("[QR] Feishu error:", e.message?.substring(0, 100)); }
}

async function main() {
  console.log("[BOOT] Launching CloakBrowser...");
  const browser = await launch({ headless: true, locale: "zh-CN", timezone: "Asia/Shanghai" });

  // === Step 1: Capture qrconnect URL from login page ===
  console.log("[1] Capturing qrconnect URL...");
  const ctx1 = await browser.newContext({ ignoreHTTPSErrors: true });
  const p1 = await ctx1.newPage();
  let qrconnectUrl = null;

  p1.on("request", (req) => {
    const url = req.url();
    if (url.includes("open.douyin.com/qrconnect") && url.includes("client_key") && !qrconnectUrl) {
      qrconnectUrl = url;
      console.log("[1] Got qrconnect URL");
    }
  });

  await p1.goto("https://buyin.jinritemai.com/mpa/account/login?type=24", {
    waitUntil: "networkidle", timeout: 25000
  }).catch(e => console.log("[1] WARN:", e.message));

  // Check if already logged in
  const landedUrl = p1.url();
  if (landedUrl.includes("buyin.jinritemai.com/dashboard") || landedUrl.includes("buyin.jinritemai.com/mpa/home")) {
    console.log("[1] Already logged in:", landedUrl);
    const cookies = await ctx1.cookies();
    fs.writeFileSync(COOKIE_TMP, JSON.stringify(cookies, null, 2));
    await ctx1.storageState({ path: STATE_TMP });
    fs.renameSync(COOKIE_TMP, COOKIE_OUT);
    fs.renameSync(STATE_TMP, STATE_OUT);
    console.log("[1] Saved", cookies.length, "cookies (already logged in)");
    await larkSend("✅ Cookie 已刷新（已登录，无需扫码）");
    await browser.close();
    return;
  }

  await p1.waitForTimeout(2000);
  await p1.close();
  await ctx1.close();

  if (!qrconnectUrl) {
    console.error("[FATAL] Could not capture qrconnect URL");
    await browser.close();
    process.exit(1);
  }

  // === Step 2: Navigate DIRECTLY to qrconnect URL (not as iframe) ===
  // 原因：qrconnect React 应用在 iframe 中不渲染（#root 空），
  //       直接作为顶层页面访问时正常渲染，oauth/get_qrcode API 正常调用
  console.log("[2] Opening qrconnect as top-level page...");
  const context = await browser.newContext({
    viewport: { width: 500, height: 600 },
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();

  let qrToken = null;
  let qrRefreshCount = 0;
  let loginConfirmed = false;

  // Intercept oauth/get_qrcode to capture QR PNG
  context.on("response", async (resp) => {
    const url = resp.url();
    if (url.includes("oauth/get_qrcode")) {
      const body = await resp.json().catch(() => null);
      if (!body?.data) return;
      console.log("[QR] get_qrcode, error_code:", body.data.error_code, "token:", body.data.token?.substring(0, 20));
      if (body.data.token) qrToken = body.data.token;
      if (body.data.qrcode) {
        // qrcode 字段是 base64 PNG
        const pngBuf = Buffer.from(body.data.qrcode, "base64");
        fs.writeFileSync(QR_PATH, pngBuf);
        console.log("[QR] PNG saved:", pngBuf.length, "bytes");
        await sendQRToLark();
        qrRefreshCount++;
      }
    }
    if (url.includes("check_qrcode")) {
      const body = await resp.json().catch(() => null);
      const status = body?.data?.status;
      if (status && status !== "new") {
        console.log("[QR CHECK] status:", status);
        if (["confirmed", "used", "login", "success"].includes(status)) {
          loginConfirmed = true;
        }
      }
    }
  });

  // Detect login via page navigation (after scan, qrconnect redirects to redirect_uri with code)
  page.on("framenavigated", async (frame) => {
    if (frame !== page.mainFrame()) return;
    const navUrl = frame.url();
    if (navUrl.includes("buyin.jinritemai.com") && !navUrl.includes("/account/login")) {
      console.log("[NAV] Login complete! URL:", navUrl.substring(0, 100));
      loginConfirmed = true;
    }
  });

  await page.goto(qrconnectUrl, {
    waitUntil: "networkidle", timeout: 25000
  }).catch(e => console.log("[2] WARN:", e.message));

  // Wait for get_qrcode to fire (max 15s)
  let waitCount = 0;
  while (!qrToken && waitCount < 15) {
    await page.waitForTimeout(1000);
    waitCount++;
  }

  if (!qrToken) {
    console.log("[WARN] get_qrcode not intercepted, falling back to screenshot");
    await page.screenshot({ path: QR_PATH, fullPage: false });
    await sendQRToLark();
  }

  // === Step 3: Wait for scan (max 4 min) ===
  console.log("[3] Waiting for QR scan (max 4 min)...");
  const deadline = Date.now() + 240000;

  while (Date.now() < deadline) {
    if (loginConfirmed) break;

    const cur = page.url();
    if (cur.includes("buyin.jinritemai.com") && !cur.includes("/account/login") && !cur.includes("qrconnect")) {
      console.log("[3] Login detected via URL:", cur.substring(0, 80));
      loginConfirmed = true;
      break;
    }

    await page.waitForTimeout(3000);
  }

  if (!loginConfirmed) {
    await larkSend("❌ 扫码超时（4分钟），请重新运行 qr_login_cloak.mjs");
    await browser.close();
    process.exit(1);
  }

  // === Step 4: Save session ===
  console.log("[4] Stabilizing session...");
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(3000);

  const cookies = await context.cookies();
  fs.writeFileSync(COOKIE_TMP, JSON.stringify(cookies, null, 2));
  await context.storageState({ path: STATE_TMP });
  console.log("[4] Saved:", cookies.length, "cookies");

  fs.renameSync(COOKIE_TMP, COOKIE_OUT);
  fs.renameSync(STATE_TMP, STATE_OUT);
  console.log("[4] ✅ fresh_cookies.json updated");
  console.log("[4] ✅ full_storage_state.json updated");

  await larkSend("✅ 扫码成功，Cookie 已安全更新（CloakBrowser v2）");
  await browser.close();
  console.log("[DONE] Cookie refresh complete");
}

main().catch(async err => {
  try { fs.unlinkSync(COOKIE_TMP); } catch(e) {}
  try { fs.unlinkSync(STATE_TMP);  } catch(e) {}
  console.error("[FATAL]", err.message);
  process.exit(1);
});
