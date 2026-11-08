#!/usr/bin/env python3
"""Phase 28: frames of the finale view (?finale) (headless Chromium, software WebGL).

Usage:  npm run build && python3 tools/finale_frames.py out_dir WIDTHxHEIGHT name="QUERY" [name="QUERY" ...]
  e.g.  python3 tools/finale_frames.py docs/phase28/finale 390x780 lift="finale&at=2&nopost" join="finale&at=8"
Each frame loads  /?<QUERY>  (use &at=<s> so the page freezes), waits for the loading screen, screenshots to <out_dir>/<name>.png and prints window.__finale counts, lanterns up and the draw calls.
Trust it for: framing, what is on screen, console errors. Not for speed (software GL).
"""
import sys, subprocess, time, os, json
from playwright.sync_api import sync_playwright

out = sys.argv[1]
w, h = [int(v) for v in sys.argv[2].split("x")]
items = [a.split("=", 1) for a in sys.argv[3:]]
os.makedirs(out, exist_ok=True)
port = os.environ.get("PORT", "4190")
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
            info = pg.evaluate("window.__finale ? {phase: window.__finale.phase(), t: window.__finale.t(), progress: window.__finale.progress(), draws: window.__finale.draws(), skyDraws: window.__finale.skyDraws(), message: window.__finale.message(), aurora: window.__finale.aurora(), fade: window.__finale.fade(), camera: window.__finale.camera()} : null")
            print(name, json.dumps(info), "console:", [l for l in logs if not l.startswith(("log", "warning"))] or "clean", flush=True)
            pg.close()
        b.close()
finally:
    srv.terminate()
