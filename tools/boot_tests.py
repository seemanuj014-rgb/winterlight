#!/usr/bin/env python3
"""Phase 17: the boot screen under bad conditions (headless Chromium).

Usage:  npm run build && python3 tools/boot_tests.py out_dir
Runs, each with screenshots you must LOOK at:
  slow    400 kbps / 400 ms latency (CDP Network.emulateNetworkConditions): screenshots at 1, 3, 6, 10, 15, 22, 30 s after navigation
  nowebgl Chromium started with 3D disabled: the plain-words "This needs WebGL" screen
  noscript the main script request is aborted: the "It did not load" screen
  taskfail a boot task throws (?tour&failtask=cabin): the same failure screen, naming nothing technical
The server sends the files as they are (no gzip), so the slow run moves about 3.5 times the bytes a real host would; it is a harsher test than Vercel.
Trust it for: what the splash shows and when. Not for real network feel or a real phone.
"""
import sys, subprocess, time, os, re
from playwright.sync_api import sync_playwright

out = sys.argv[1] if len(sys.argv) > 1 else "docs/phase17/boot"
os.makedirs(out, exist_ok=True)
srv = subprocess.Popen([sys.executable, "-m", "http.server", "4176", "-d", "dist"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
URL = "http://localhost:4176/?tour"
GL = ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"]

def state(pg):
    return pg.evaluate("""() => { const s = document.getElementById('splash'); if (!s) return null;
      const cs = getComputedStyle(s); return { display: cs.display, opacity: cs.opacity, cls: s.className,
      title: document.getElementById('splash-title')?.textContent || '', titleHidden: document.getElementById('splash-title')?.hidden,
      msg: document.getElementById('splash-msg')?.textContent || '', fill: document.getElementById('splash-fill')?.style.width || '',
      reloadShown: !document.getElementById('splash-reload')?.hidden, scripts: [...document.scripts].length } }""")

try:
    with sync_playwright() as p:
        # 1. slow network
        b = p.chromium.launch(args=GL)
        ctx = b.new_context(viewport={"width": 390, "height": 780})
        pg = ctx.new_page()
        logs = []
        pg.on("console", lambda m: logs.append(m.type + ": " + m.text))
        pg.on("pageerror", lambda e: logs.append("pageerror: " + str(e)))
        cdp = ctx.new_cdp_session(pg)
        cdp.send("Network.enable")
        cdp.send("Network.emulateNetworkConditions", {"offline": False, "latency": 400, "downloadThroughput": 400 * 1000 / 8, "uploadThroughput": 400 * 1000 / 8})
        t0 = time.time()
        pg.goto(URL, wait_until="commit")
        for t in [1, 3, 6, 10, 15, 22, 30, 45, 60, 75]:
            wait = t - (time.time() - t0)
            if wait > 0: time.sleep(wait)
            try:
                st = state(pg)
            except Exception as e:
                st = "page not ready: " + str(e)[:60]
            pg.screenshot(path=f"{out}/slow_{t:02d}s.png")
            print(f"slow t={t:>2}s", st)
            if isinstance(st, dict) and st["display"] == "none": break
        print("slow console:", [l for l in logs if not l.startswith("log") and "KHR_parallel" not in l] or "clean")
        b.close()

        # 2. no WebGL
        b = p.chromium.launch(args=["--disable-3d-apis", "--disable-gpu", "--disable-software-rasterizer"])
        pg = b.new_page(viewport={"width": 390, "height": 780})
        logs = []
        pg.on("pageerror", lambda e: logs.append("pageerror: " + str(e)))
        pg.goto(URL); pg.wait_for_timeout(2500)
        print("nowebgl", state(pg), logs or "no page errors")
        pg.screenshot(path=f"{out}/fail_nowebgl.png"); b.close()

        # 3. main script blocked
        b = p.chromium.launch(args=GL)
        pg = b.new_page(viewport={"width": 390, "height": 780})
        pg.route(re.compile(r".*/assets/index-.*\.js"), lambda r: r.abort())
        pg.goto(URL); pg.wait_for_timeout(3500)
        print("script blocked", state(pg))
        pg.screenshot(path=f"{out}/fail_script.png"); b.close()

        # 4. a task throws
        b = p.chromium.launch(args=GL)
        pg = b.new_page(viewport={"width": 390, "height": 780})
        logs = []
        pg.on("console", lambda m: logs.append(m.type + ": " + m.text))
        pg.goto(URL + "&failtask=cabin"); pg.wait_for_timeout(15000)
        print("task throws", state(pg))
        print("task throws console:", [l[:110] for l in logs if not l.startswith("log") and "KHR_parallel" not in l] or "clean")
        pg.screenshot(path=f"{out}/fail_task.png"); b.close()
finally:
    srv.terminate()
