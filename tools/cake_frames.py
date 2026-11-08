#!/usr/bin/env python3
"""Phase 25: frames of the cake view (?cake) (headless Chromium, software WebGL).

Usage:  npm run build && python3 tools/cake_frames.py out_dir WIDTHxHEIGHT name="QUERY" [name="QUERY" ...]
  e.g.  python3 tools/cake_frames.py docs/phase25/frames 390x780 wish="cake&at=4" lit="cake&at=8"
Each frame loads  /?<QUERY>  (use &at=<s> so the page freezes), waits for the loading screen, screenshots to <out_dir>/<name>.png and prints window.__sky.state() (done / names / card).
Trust it for: framing, what is on screen, console errors. Not for speed (software GL).
"""
import sys, subprocess, time, os, json
from playwright.sync_api import sync_playwright

out = sys.argv[1]
w, h = [int(v) for v in sys.argv[2].split("x")]
items = [a.split("=", 1) for a in sys.argv[3:]]
os.makedirs(out, exist_ok=True)
port = os.environ.get("PORT", "4181")
srv = subprocess.Popen([sys.executable, "-m", "http.server", port, "-d", "dist"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
try:
    with sync_playwright() as p:
        b = p.chromium.launch(args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"])
        for name, q in items:
            pg = b.new_page(viewport={"width": w, "height": h}, device_scale_factor=1)
            logs = []
            pg.on("console", lambda m: logs.append(m.type + ": " + m.text))
            pg.on("pageerror", lambda e: logs.append("pageerror: " + str(e)))
            pg.goto(f"http://localhost:{port}/?{q}")
            try:
                pg.wait_for_function("getComputedStyle(document.getElementById('splash')).display === 'none'", timeout=120000)
            except Exception as e:
                logs.append("error: splash never went away: " + str(e)[:80])
            pg.wait_for_timeout(1500)
            pg.screenshot(path=f"{out}/{name}.png")
            info = pg.evaluate("window.__cake ? {phase: window.__cake.phase(), lit: window.__cake.lit(), t: window.__cake.t(), draws: window.__cake.draws(), log: window.__cake.log().map(e => e.type + (e.candle !== undefined ? ':' + e.candle : ''))} : null")
            print(name, json.dumps(info), "console:", [l for l in logs if not l.startswith(("log", "warning"))] or "clean", flush=True)
            pg.close()
        b.close()
finally:
    srv.terminate()
