#!/usr/bin/env python3
"""Phase 10: a labelled contact sheet of named views (software WebGL, so trust shapes and timing logic, not speed).

Usage:  npm run build && python3 tools/contact_sheet.py out.png 360 COLS label1='?behave&still&state=hop&at=1' label2='?behave&...' ...
Each view is rendered at SIZE x SIZE, labelled, and tiled COLS per row into out.png. Console errors are printed per view.
"""
import sys, subprocess, time
from playwright.sync_api import sync_playwright
from PIL import Image, ImageDraw

out, size, cols = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
views = [a.split("=", 1) for a in sys.argv[4:]]
srv = subprocess.Popen([sys.executable, "-m", "http.server", "4176", "-d", "dist"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
shots = []
try:
    with sync_playwright() as p:
        b = p.chromium.launch(args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"])
        for name, q in views:
            pg = b.new_page(viewport={"width": size, "height": size})
            logs = []
            pg.on("console", lambda m: logs.append(m.type + ": " + m.text))
            pg.on("pageerror", lambda e: logs.append("pageerror: " + str(e)))
            pg.goto("http://localhost:4176/" + q)
            pg.wait_for_timeout(2500)
            path = f"/tmp/_cs_{len(shots)}.png"
            pg.screenshot(path=path)
            shots.append((name, path))
            print(name, "console:", [l for l in logs if not l.startswith("log") and not l.startswith("info")] or "clean")
            pg.close()
        b.close()
finally:
    srv.terminate()
rows = (len(shots) + cols - 1) // cols
sheet = Image.new("RGB", (cols * size, rows * size), "white")
d = ImageDraw.Draw(sheet)
for i, (name, path) in enumerate(shots):
    x, y = (i % cols) * size, (i // cols) * size
    sheet.paste(Image.open(path).convert("RGB"), (x, y))
    d.text((x + 8, y + 6), name, fill=(20, 20, 20))
    d.rectangle((x, y, x + size - 1, y + size - 1), outline=(215, 215, 215))
sheet.save(out)
print("wrote", out)
