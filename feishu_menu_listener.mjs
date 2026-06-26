// feishu_menu_listener.mjs — 飞书自定义菜单"推送事件"长连接监听器 v1.0
// 点击机器人菜单(event_key=refresh_douyin_cookie) → 触发 qr_login_cloak.mjs 扫码刷新
// 长连接为出站连接(服务器主动连飞书)，无需开 iptables 端口。
import * as lark from "@larksuiteoapi/node-sdk";
import { execSync, spawn } from "child_process";
import fs from "fs";
import config from "./feishu_config.cjs";
const { CHAT_ID } = config;

const WORKDIR    = "/opt/douyin-fetcher";
const EVENT_KEY  = "refresh_douyin_cookie";
const QR_SCRIPT  = "qr_login_cloak.mjs";
const TRIGGER_LOG= "/tmp/qr_login_trigger.log";
const ENV_FILE   = "/opt/douyin-fetcher/.feishu_menu.env";

// === 读飞书凭证 ===
// appId 用固定值；appSecret 从 root-only env 文件读(lark-cli 把 secret 存 keyring，配置里只有引用)。
// .feishu_menu.env 内容: FEISHU_APP_SECRET=xxx  (chmod 600, 已 gitignore)
const appId = "cli_a9327544d5f91bcd";
let appSecret = process.env.FEISHU_APP_SECRET;
if (!appSecret) {
  try {
    const m = fs.readFileSync(ENV_FILE, "utf8").match(/^FEISHU_APP_SECRET=(.+)$/m);
    if (m) appSecret = m[1].trim();
  } catch (e) {}
}
if (!appSecret) throw new Error("[FATAL] FEISHU_APP_SECRET missing — 请在 " + ENV_FILE + " 写入 FEISHU_APP_SECRET=<飞书后台App Secret>");
console.log(`[BOOT] appId=${appId} secretLen=${appSecret.length}`);

function larkSend(text) {
  try {
    execSync(
      `lark-cli im +messages-send --chat-id ${CHAT_ID} --text "${text.replace(/"/g, "\x27")}" --as bot`,
      { encoding: "utf8", timeout: 15000, stdio: "pipe" }
    );
  } catch (e) { console.error("[LARK]", e.message?.substring(0, 100)); }
}

const COOLDOWN_MS = 60000;  // 限制1: 60s 冷却，频繁点/误点只触发一次
let lastTrigger = 0;

function qrRunning() {
  try { execSync(`pgrep -f 'node .*[q]r_login_cloak[.]mjs'`, { stdio: "pipe" }); return true; }
  catch { return false; }  // pgrep 非零 = 无进程
}

function triggerQR() {
  // 限制2(信任边界,不可简化)：进行中的扫码绝不 kill，避免打断 dv 正在扫的二维码
  if (qrRunning()) {
    console.log("[SKIP] qr_login already running, not re-spawning");
    larkSend("⏳ 已有扫码进行中，请先扫上一张二维码（如已失效请 1 分钟后再点）");
    return;
  }
  // 限制1：60s 冷却防抖(也兜住 spawn 后进程未被 pgrep 可见前的连点竞态)
  const now = Date.now();
  if (now - lastTrigger < COOLDOWN_MS) {
    const wait = Math.ceil((COOLDOWN_MS - (now - lastTrigger)) / 1000);
    console.log(`[COOLDOWN] skip, wait ${wait}s`);
    larkSend(`⏳ 操作太频繁，请 ${wait} 秒后再点（避免重复触发扫码）`);
    return;
  }
  lastTrigger = now;  // 仅真正 spawn 才计入冷却
  larkSend("📡 收到刷新请求，正在启动扫码…");
  const out = fs.openSync(TRIGGER_LOG, "a");
  fs.writeSync(out, `\n===== ${new Date().toISOString()} trigger spawn =====\n`);
  const child = spawn("node", [QR_SCRIPT], {
    cwd: WORKDIR, detached: true, stdio: ["ignore", out, out],
  });
  child.unref();
  console.log(`[SPAWN] node ${QR_SCRIPT} pid=${child.pid}`);
}

const eventDispatcher = new lark.EventDispatcher({}).register({
  "application.bot.menu_v6": async (data) => {
    const ek = (data?.event_key ?? "").trim();  // trim: 后台填ID可能带前后空格
    console.log(`[EVENT] menu_v6 event_key=${ek}`);
    if (ek === EVENT_KEY) {
      console.log(`[MATCH] event_key=${EVENT_KEY} matched → trigger`);
      triggerQR();
    } else {
      console.log(`[IGNORE] event_key=${ek} != ${EVENT_KEY}`);
    }
    return { code: 0 };
  },
});

const wsClient = new lark.WSClient({ appId, appSecret, loggerLevel: lark.LoggerLevel.info });
console.log("[BOOT] starting WS long-connection…");
wsClient.start({ eventDispatcher });
