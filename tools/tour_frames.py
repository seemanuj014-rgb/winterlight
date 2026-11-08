#!/usr/bin/env python3
"""Phase 17: frames of the camera director's shots (headless Chromium, software WebGL).

Usage:  npm run build && python3 tools/tour_frames.py out_dir WIDTHxHEIGHT name='shot,at[,extra]' ...
  e.g.  python3 tools/tour_frames.py docs/phase17/pushout 390x780 f0='doorOut,0' f1='doorOut,1.5' f2='doorOut,3'
Each frame loads  /?tour&shot=<shot>&at=<seconds>[&extra]  waits for the loading screen to fade away, then screenshots. Prints console errors per frame.
Trust it for: framing, what is in shot, console errors. Not for speed (software GL).
"""
import sys, subprocess, time, os
from playwright.sync_api import sync_playwright

out = sys.argv[1]
w, h = [int(v) for v in sys.argv[2].split("x")]
frames = []
for a in sys.argv[3:]:
    name, spec = a.split("=", 1)
    parts = spec.split(",")
    frames.append((name, parts[0], parts[1] if len(parts) > 1 else "0", "".join("&" + p for p in parts[2:])))
os.makedirs(out, exist_ok=True)
srv = subprocess.Popen([sys.executable, "-m", "http.server", "4175", "-d", "dist"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
try:
    with sync_playwright() as p:
        b = p.chromium.launch(args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"])
        for name, shot, at, extra in frames:
            pg = b.new_page(viewport={"width": w, "height": h})
            logs = []
            pg.on("console", lambda m: logs.append(m.type + ": " + m.text))
            pg.on("pageerror", lambda e: logs.append("pageerror: " + str(e)))
            pg.goto(f"http://localhost:4175/?tour&shot={shot}&at={at}{extra}")
            try:
                pg.wait_for_function("getComputedStyle(document.getElementById('splash')).display === 'none'", timeout=90000)
            except Exception as e:
                logs.append("error: splash never went away: " + str(e)[:80])
            pg.wait_for_timeout(1200)
            pg.screenshot(path=f"{out}/{name}.png")
            print(name, shot, at, "console:", [l for l in logs if not l.startswith("log")] or "clean")
            pg.close()
        b.close()
finally:
    srv.terminate()
