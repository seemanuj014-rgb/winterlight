#!/usr/bin/env python3
"""Sandbox visual check: serve dist/ and screenshot it in headless Chromium (software WebGL).

Usage:  npm run build && python3 tools/shot.py [out_dir] [hash_or_query]
Trust it for: shapes, colours, framing, layout, console errors.
Do NOT trust it for: frame rate, battery, real phone GPU behaviour, microphone, audio. Those are owner-device gaps.
"""
import sys, subprocess, time, os
from playwright.sync_api import sync_playwright

out = sys.argv[1] if len(sys.argv) > 1 else "shots"
suffix = sys.argv[2] if len(sys.argv) > 2 else ""
os.makedirs(out, exist_ok=True)
srv = subprocess.Popen([sys.executable, "-m", "http.server", "4173", "-d", "dist"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
try:
    with sync_playwright() as p:
        b = p.chromium.launch(args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"])
        for name, (w, h) in {"phone": (390, 780), "small_phone": (360, 640), "desktop": (1280, 720)}.items():
            pg = b.new_page(viewport={"width": w, "height": h})
            logs = []
            pg.on("console", lambda m: logs.append(m.type + ": " + m.text))
            pg.on("pageerror", lambda e: logs.append("pageerror: " + str(e)))
            pg.goto("http://localhost:4173/" + suffix)
            pg.wait_for_timeout(2500)
            pg.screenshot(path=f"{out}/{name}.png")
            print(name, "console:", [l for l in logs if not l.startswith("log")] or "clean")
        b.close()
finally:
    srv.terminate()
