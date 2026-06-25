# 罗盘哨兵 (Luopan Sentinel)

抖音直播数据全自动采集系统。每小时无人值守抓取抖音罗盘、直播大屏、巨量千川三套数据，清洗后自动填入飞书表格，并将截图发送到飞书群。

---

## 系统架构

```
cron (每小时整点)
  └─ live_capture_v3.js        # 抖音罗盘直播数据（39字段）
  └─ screen_capture.js         # 直播大屏 + 千川 截图 + API数据
  └─ promover_capture.js       # 达人素材数据
  └─ route_b_pull.js           # 补充数据源
       └─ n8n webhook           # 数据清洗管线
            └─ live_clean.json  # 统一输出
                 └─ auto_fill_hangzhou_sheet.js  # 飞书自动填表
```

---

## 安装

### 1. 环境要求

- Linux 服务器（内存 ≥ 3.6G，同时只能跑一个 CloakBrowser 实例）
- Node.js 18+
- n8n（Docker 部署）
- lark-cli（飞书命令行工具）

### 2. 安装依赖

```bash
cd /opt/douyin-fetcher
npm install
```

### 3. 安装 CloakBrowser

```bash
npm install cloakbrowser
```

CloakBrowser 是本项目的核心反检测浏览器，详见下方「风控绕过」章节。

### 4. 配置 n8n

导入工作流：

```bash
n8n import:workflow --input=n8n_workflows_export.json
```

启动 n8n 后激活「🔧 直播数据清洗管线」工作流（ID: `5wha4FMrZzhOWyye`），监听 `POST /webhook/live-data-clean`。

### 5. 配置 lark-cli

```bash
npm install -g lark-cli
lark-cli auth login --as bot
```

---

## 使用

### 首次登录（扫码）

```bash
node qr_login_cloak.mjs
```

脚本会自动把抖音扫码登录的二维码图片发送到飞书群，用抖音 APP 扫码后 Cookie 自动保存到 `full_storage_state.json`，有效期约 3 天。Cookie 过期后重新执行此命令即可。

### 配置 cron

```bash
crontab -e
```

加入以下任务（示例为值班时段 8:00-16:00 + 20:00-次日01:00）：

```cron
# 罗盘直播数据
0 0,1,8-23 * * * cd /opt/douyin-fetcher && (node live_capture_v3.js || (sleep 300 && node live_capture_v3.js)) >> /tmp/luopan_cron.log 2>&1 && sleep 30 && curl -s -X POST http://localhost:5678/webhook/live-data-clean >> /tmp/luopan_cron.log 2>&1

# 直播大屏截图
0 8-23,0,1 * * * cd /opt/douyin-fetcher && (node screen_capture.js || (sleep 300 && node screen_capture.js --retry)) >> /tmp/screen_cron.log 2>&1 && node extract_screen_summary.js >> /tmp/screen_cron.log 2>&1

# 达人素材数据
35 8-23,0,1 * * * cd /opt/douyin-fetcher && flock -xn /tmp/promover.lock node promover_capture.js >> /tmp/promover_cron.log 2>&1 && node extract_promover_summary.js >> /tmp/promover_cron.log 2>&1

# 飞书自动填表（按值班时段调整小时范围）
8 8-16 * * * cd /opt/douyin-fetcher && flock -xn /tmp/autofill.lock node auto_fill_hangzhou_sheet.js >> /tmp/autofill.log 2>&1

# 磁盘自动清理（3天前归档）+ 告警
0 3 * * * find /opt/douyin-fetcher/data -name "*_2026-*.json" -mtime +3 -delete >> /tmp/disk_clean.log 2>&1 && bash /opt/douyin-fetcher/disk_alert.sh >> /tmp/disk_clean.log 2>&1
```

### 数据输出

| 文件 | 内容 |
|---|---|
| `data/live_clean.json` | 当前场次直播数据（39字段，每小时更新） |
| `data/screen_clean.json` | 直播大屏 + 千川完整数据 |
| `data/screen_summary.json` | 大屏关键指标摘要 |
| `data/promover_summary.json` | 达人素材投放摘要 |
| `/tmp/sc_pro.png` | 直播大屏专业版截图 |
| `/tmp/sc_basic.png` | 直播大屏基础版截图 |
| `/tmp/sc_qc.png` | 巨量千川截图 |

---

## 背后的浏览器：CloakBrowser

### 为什么不用普通 Playwright？

抖音、飞鱼、巨量千川对 Playwright / Puppeteer 默认浏览器有严格指纹检测：

- 检测 `navigator.webdriver = true`
- 检测 Canvas 指纹、WebGL 指纹
- 检测缺失的浏览器插件列表
- 检测 Chrome headless 特征（`HeadlessChrome` UA、缺失语音合成等）
- 检测鼠标移动轨迹（机器人式直线移动）

普通 Playwright headless 跑 2-3 天就会触发验证码或封 Cookie。

### CloakBrowser 做了什么

CloakBrowser 是专为自动化场景设计的反检测浏览器（基于 Chromium），核心能力：

| 检测项 | 普通 Playwright | CloakBrowser |
|---|---|---|
| `navigator.webdriver` | `true`（暴露） | `undefined`（隐藏） |
| Canvas 指纹 | 固定特征值 | 随机噪声注入，每次不同 |
| WebGL 指纹 | 服务器 GPU 暴露 | 模拟真实显卡参数 |
| User-Agent | `HeadlessChrome` | 真实 Chrome 版本号 |
| 插件列表 | 空（暴露无插件） | 注入常见插件集合 |
| 字体列表 | 系统最小集 | 扩展字体集 |
| 屏幕分辨率 | 0×0 或服务器分辨率 | 模拟 1920×1080 |
| 时区 | 服务器时区 | 指定 `Asia/Shanghai` |

### 使用方式

```javascript
import { launch } from 'cloakbrowser';

const browser = await launch({
  headless: true,
  locale: 'zh-CN',
  timezone: 'Asia/Shanghai'
});
```

接口与 Playwright 完全兼容，直接替换 `chromium.launch()` 即可。

### Cookie 持久化策略

每次成功采集后，`storageState`（包含全部 Cookie + localStorage）写回磁盘：

```javascript
await context.storageState({ path: 'full_storage_state.json' });
```

下次启动时加载，实现 Cookie 滚动续期，减少重新扫码频率（正常情况 Cookie 有效期 3-7 天）。

---

## 常见问题

**Q: 触发验证码怎么办？**
重新运行 `node qr_login_cloak.mjs` 扫码刷新 Cookie。

**Q: 直播大屏进不去（SCREEN 报错）？**
检查是否正在播出。`screen_capture.js` 第一次失败会静默退出，5 分钟后自动 retry；只有 retry 也失败才发飞书告警。

**Q: 磁盘满了？**
`data/` 归档每小时约 10-15MB，3 天约 1G+。已配置每日凌晨 3:00 自动清理 3 天前的归档。紧急手动清理：
```bash
find /opt/douyin-fetcher/data -name "*_2026-*.json" -mtime +3 -delete
```

**Q: Cookie 多久过期？**
抖音 Cookie 通常 3-7 天，飞鱼/千川同源。每次成功采集后自动续期。出现 401/302 跳转登录页时手动扫码重置。

---

## 文件说明

| 文件 | 说明 |
|---|---|
| `live_capture_v3.js` | 罗盘直播数据主采集脚本 |
| `screen_capture.js` | 直播大屏 + 千川 Playwright 自动化 |
| `promover_capture.js` | 达人素材投放数据采集 |
| `route_b_pull.js` | 补充数据拉取 |
| `qr_login_cloak.mjs` | CloakBrowser 扫码登录，二维码发飞书 |
| `auto_fill_hangzhou_sheet.js` | 飞书多维表格自动填表 |
| `extract_screen_summary.js` | 大屏数据提取为 summary |
| `extract_promover_summary.js` | 素材数据提取为 summary |
| `hourly_report.js` | 每小时数据报告 |
| `quick_check.js` | 5分钟快速数据检查 |
| `creative_check.js` | 创意素材状态检查 |
| `disk_alert.sh` | 磁盘占用告警脚本 |
| `n8n_workflows_export.json` | n8n 工作流备份（5个） |
| `docs/` | 七文档体系（架构/步骤/工作流/技术债） |
