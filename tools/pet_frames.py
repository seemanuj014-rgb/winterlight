#!/usr/bin/env python3
"""Phase 20: frames and state logs of petting (?pet and ?pet=bunny) (headless Chromium, software WebGL).

Usage:  npm run build && python3 tools/pet_frames.py out_dir WIDTHxHEIGHT "QUERY" t1 t2 t3 ...
  e.g.  python3 tools/pet_frames.py docs/phase20/cat 390x780 "pet&stroke=3-12" 0 4 8 14 (QUERY starts with pet or pet=bunny)
Each frame loads  /?acts&<QUERY>&at=<t>  (the viewer is scripted: &hold=a-b, &tap=a,b, &pointer=x,y; the page runs t seconds of fixed-step time and freezes),
waits for the loading screen to go away, screenshots, and writes <out_dir>/<name>.png plus one line of window.__pet.state(). The transition log of the last frame
(which has run the longest, so it holds every transition) is written to <out_dir>/log.json. Extra console errors are printed.
Trust it for: framing, what is on screen, console errors, state transitions. Not for speed (software GL).
"""
import sys, subprocess, time, os, json
from playwright.sync_api import sync_playwright

out = sys.argv[1]
w, h = [int(v) for v in sys.argv[2].split("x")]
query = sys.argv[3]
times = sys.argv[4:]
os.makedirs(out, exist_ok=True)
port = os.environ.get("PORT", "4176")
srv = subprocess.Popen([sys.executable, "-m", "http.server", port, "-d", "dist"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
states = []
log = []
try:
    with sync_playwright() as p:
        b = p.chromium.launch(args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"])
        for t in times:
            pg = b.new_page(viewport={"width": w, "height": h})
            logs = []
            pg.on("console", lambda m: logs.append(m.type + ": " + m.text))
            pg.on("pageerror", lambda e: logs.append("pageerror: " + str(e)))
            pg.goto(f"http://localhost:{port}/?{query}&at={t}")
            try:
                pg.wait_for_function("getComputedStyle(document.getElementById('splash')).display === 'none'", timeout=120000)
            except Exception as e:
                logs.append("error: splash never went away: " + str(e)[:80])
            pg.wait_for_timeout(1200)
            name = f"t{float(t):06.2f}".replace(".", "_")
            pg.screenshot(path=f"{out}/{name}.png")
            st = pg.evaluate("window.__pet ? window.__pet.state() : null")
            log = pg.evaluate("window.__pet ? window.__pet.log() : null")
            states.append({"at": float(t), "state": st})
            print(name, json.dumps(st), "console:", [l for l in logs if not l.startswith(("log", "warning"))] or "clean")
            pg.close()
        b.close()
finally:
    srv.terminate()
json.dump({"query": query, "size": [w, h], "frames": states}, open(f"{out}/states.json", "w"), indent=1)
json.dump(log, open(f"{out}/log.json", "w"), indent=1)
print("log entries:", len(log or []))
for e in (log or []):
    print("  ", json.dumps(e))
