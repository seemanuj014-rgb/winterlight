#!/usr/bin/env python3
"""Sandbox visual check of named views at a square size (so a ref-camera shot maps 1:1 onto her drawing).

Usage:  npm run build && python3 tools/shot_views.py out_dir 720 name1='?face&bg=white' name2='?face=3q' ...
Writes out_dir/<name>.png and prints console errors per view. Software WebGL: trust shapes and framing, not speed.
"""
import sys, subprocess, time, os
from playwright.sync_api import sync_playwright

out, size = sys.argv[1], int(sys.argv[2])
views = [a.split("=", 1) for a in sys.argv[3:]]
os.makedirs(out, exist_ok=True)
srv = subprocess.Popen([sys.executable, "-m", "http.server", "4174", "-d", "dist"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
try:
    with sync_playwright() as p:
        b = p.chromium.launch(args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"])
        for name, q in views:
            pg = b.new_page(viewport={"width": size, "height": size})
            logs = []
            pg.on("console", lambda m: logs.append(m.type + ": " + m.text))
            pg.on("pageerror", lambda e: logs.append("pageerror: " + str(e)))
            pg.goto("http://localhost:4174/" + q)
            pg.wait_for_timeout(3000)
            pg.screenshot(path=f"{out}/{name}.png")
            print(name, "console:", [l for l in logs if not l.startswith("log")] or "clean")
            pg.close()
        b.close()
finally:
    srv.terminate()
