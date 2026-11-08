#!/usr/bin/env python3
"""Phase 28: can every one of the five shapes be brought onto the screen by turning the view (?stay)?
Usage: npm run build && python3 tools/stay_reach.py [WxH ...]   (default 390x780 360x640 1280x720)
Uses window.__stay.key (the arrow keys) and shapeAt (the first star of each shape, px); a shape counts as reachable when its first star is at least 40 px inside the screen at some turn.
Trust it for: the reach of the turn limits at each aspect. Not for how it feels."""
import sys, subprocess, time, os, json
from playwright.sync_api import sync_playwright
sizes = sys.argv[1:] or ["390x780", "360x640", "1280x720"]
IDS = ["strawberry", "bumblebee", "rose", "kaaju-katli", "cutie-patootie"]
port = os.environ.get("PORT", "4191")
srv = subprocess.Popen([sys.executable, "-m", "http.server", port, "-d", "dist"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
ok_all = True
try:
    with sync_playwright() as p:
        b = p.chromium.launch(args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"])
        for sz in sizes:
            w, h = [int(v) for v in sz.split("x")]
            pg = b.new_page(viewport={"width": w, "height": h}, device_scale_factor=1)
            pg.goto(f"http://localhost:{port}/?stay&at=6&nopost")
            pg.wait_for_function("getComputedStyle(document.getElementById('splash')).display === 'none'", timeout=120000)
            pg.wait_for_timeout(800)
            res = pg.evaluate("""(args) => {
              const [ids, w, h] = args; const S = window.__stay; const out = {}; ids.forEach(i => out[i] = []);
              S.key('Home');
              // go to the lowest, leftmost turn, then sweep
              for (let i = 0; i < 11; i++) S.key('ArrowLeft');
              for (let i = 0; i < 3; i++) S.key('ArrowDown');
              const rows = 15, cols = 17;
              for (let r = 0; r < rows; r++) {
                for (let c = 0; c < cols; c++) {
                  const pan = S.pan();
                  for (const id of ids) { const s = S.shapeAt(id); if (s && s.x > 40 && s.x < w - 40 && s.y > 40 && s.y < h - 40) out[id].push([Math.round(pan.yawDeg), Math.round(pan.pitchDeg)]); }
                  S.key('ArrowRight');
                }
                for (let i = 0; i < cols + 3; i++) S.key('ArrowLeft');
                S.key('ArrowUp');
              }
              return out;
            }""", [IDS, w, h])
            print(sz)
            for i in IDS:
                v = res[i]
                print(f"  {i:16s} reachable at {len(v):3d} turns" + (f", e.g. yaw {v[len(v)//2][0]} pitch {v[len(v)//2][1]}" if v else "  <-- NEVER ON SCREEN"))
                if not v: ok_all = False
            pg.close()
        b.close()
finally:
    srv.terminate()
print("ALL REACHABLE" if ok_all else "SOME UNREACHABLE")
sys.exit(0 if ok_all else 1)
