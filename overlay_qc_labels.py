#!/usr/bin/env python3
# PIL 叠字：读 qc_metric_pos.json，把 KPI 标签叠到千川截图上
import sys, json, os
from PIL import Image, ImageDraw, ImageFont

SRC  = sys.argv[1] if len(sys.argv) > 1 else '/tmp/sc_qc.png'
DST  = sys.argv[2] if len(sys.argv) > 2 else SRC
JSON = sys.argv[3] if len(sys.argv) > 3 else '/tmp/qc_metric_pos.json'

if not os.path.exists(JSON):
    print("no metric pos json, skip"); sys.exit(0)

meta = json.load(open(JSON))
if not meta:
    print("empty metric pos, skip"); sys.exit(0)

im = Image.open(SRC).convert('RGBA')
overlay = Image.new('RGBA', im.size, (0,0,0,0))
draw = ImageDraw.Draw(overlay)

# 字体
def load_font(size):
    for p in [
        '/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc',
        '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
        '/usr/share/fonts/truetype/wqy/wqy-microhei.ttc',
        '/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc',
        '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    ]:
        if os.path.exists(p):
            try: return ImageFont.truetype(p, size)
            except: pass
    return ImageFont.load_default()

font = load_font(15)
COLOR  = (255, 255, 255, 235)   # 白色文字
STROKE = (10, 16, 40, 255)      # 深蓝黑描边，任何背景都清晰

placed = 0
for item in meta:
    lbl = item.get('label','').strip()
    w, h = item.get('w',0), item.get('h',0)
    if not lbl or w < 5 or h < 5: continue
    # 标签放在卡片【正上方】留白区，避免压住数字
    cx = item['x'] + w // 2
    bbox = draw.textbbox((0,0), lbl, font=font, stroke_width=2)
    tw = bbox[2] - bbox[0]
    th = bbox[3] - bbox[1]
    y  = item['y'] - th - 2      # 卡片顶部再往上 th+2，整体抬到数字上方
    tx = cx - tw // 2
    # 防止超出左/右边界
    tx = max(2, min(tx, im.size[0] - tw - 2))
    draw.text((tx, y), lbl, font=font, fill=COLOR, stroke_width=2, stroke_fill=STROKE)
    placed += 1

result = Image.alpha_composite(im, overlay).convert('RGB')
result.save(DST)
print(f'overlay done: {placed} labels on {DST}')
