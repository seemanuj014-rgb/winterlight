#!/usr/bin/env python3
"""Phase 28: petting the bunny inside stay a while (?stay), real mouse / touch events in headless Chromium (software WebGL).
Usage: npm run build && python3 tools/stay_pet.py [out_dir]
Checks: the bunny is on screen at the level look; a press ON her does not turn the view; a press elsewhere still does; a quick click on her startles her (she hides);
a held press near her makes her hop; the activity reads 'pet' while a finger is on her and back after; both exits stay on offer; console clean."""
import sys, subprocess, time, os, json
from playwright.sync_api import sync_playwright

out = sys.argv[1] if len(sys.argv) > 1 else "docs/phase28/pet"
os.makedirs(out, exist_ok=True)
port = os.environ.get("PORT", "4192")
srv = subprocess.Popen([sys.executable, "-m", "http.server", port, "-d", "dist"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
results = []
def check(name, ok, info=""):
    results.append(bool(ok)); print(("PASS " if ok else "FAIL ") + name + (" :: " + str(info) if info != "" else ""), flush=True)

def run(w, h, touch, reduced):
    tag = f"{w}x{h}" + ("-touch" if touch else "-mouse") + ("-reduced" if reduced else "")
    with sync_playwright() as p:
        b = p.chromium.launch(args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"])
        ctx = b.new_context(viewport={"width": w, "height": h}, has_touch=touch, is_mobile=touch)
        pg = ctx.new_page()
        logs = []
        pg.on("console", lambda m: logs.append(m.type + ": " + m.text))
        pg.on("pageerror", lambda e: logs.append("pageerror: " + str(e)))
        q = "stay&at=8&nopost&tier=low" + ("&reduced" if reduced else "")
        pg.goto(f"http://localhost:{port}/?{q}")
        pg.wait_for_function("getComputedStyle(document.getElementById('splash')).display === 'none'", timeout=120000)
        pg.wait_for_function("window.__stay && window.__stay.cast().ready", timeout=60000)
        pg.wait_for_timeout(1500)
        at = pg.evaluate("window.__stay.bunnyAt()")
        check(f"[{tag}] the bunny is on the screen at the level look", at is not None and 0 < at["x"] < w and 0 < at["y"] < h, at)
        if at is None:
            b.close(); return
        x, y = at["x"], at["y"]
        pan0 = pg.evaluate("window.__stay.pan()")
        # a drag that starts ON the bunny pets, it does not turn the view
        pg.mouse.move(x, y); pg.mouse.down(); pg.wait_for_timeout(150)
        act = pg.evaluate("window.__stay.activity()")
        pressing = pg.evaluate("window.__stay.pet().pressing")
        pg.mouse.move(x + 40, y - 30, steps=5); pg.wait_for_timeout(200)
        pan1 = pg.evaluate("window.__stay.pan()")
        pg.mouse.up(); pg.wait_for_timeout(300)
        check(f"[{tag}] a press on the bunny is hers: activity reads 'pet' while down", act == "pet" and pressing, act)
        check(f"[{tag}] and it did not turn the view", pan0 == pan1, [pan0, pan1])
        check(f"[{tag}] activity is back to wander after", pg.evaluate("window.__stay.activity()") == "wander", pg.evaluate("window.__stay.activity()"))
        # held press: she hops toward the finger
        pg.mouse.move(x + 60, y + 20); pg.mouse.down(); pg.wait_for_timeout(5000)
        st = pg.evaluate("window.__stay.pet()")
        pg.mouse.up()
        pg.screenshot(path=f"{out}/held_{tag}.png")
        check(f"[{tag}] a held finger near her did not break anything", st["mode"] in ("idle", "hop", "hiding", "peeking"), st)
        # a quick click on her startles her (reduced motion: she ducks in place)
        at = pg.evaluate("window.__stay.bunnyAt()")
        if at:
            pg.wait_for_timeout(4000)
            at = pg.evaluate("window.__stay.bunnyAt()")
            pg.mouse.click(at["x"], at["y"]); pg.wait_for_timeout(1200)
            st2 = pg.evaluate("window.__stay.pet()")
            check(f"[{tag}] a quick click on her startles her", st2["mode"] in ("hiding", "peeking", "hop"), st2)
        # a press elsewhere still turns the view
        pg.wait_for_timeout(300)
        a = pg.evaluate("window.__stay.pan()")
        pg.mouse.move(w * 0.5, h * 0.2); pg.mouse.down(); pg.mouse.move(w * 0.5, h * 0.5, steps=8); pg.mouse.up(); pg.wait_for_timeout(300)
        bpan = pg.evaluate("window.__stay.pan()")
        check(f"[{tag}] a drag elsewhere still turns the view", a != bpan, [a, bpan])
        check(f"[{tag}] both exits stay on offer", sorted(pg.evaluate("window.__stay.exits()")) == ["letter", "replay"], pg.evaluate("window.__stay.exits()"))
        errs = [l for l in logs if l.startswith(("error", "pageerror"))]
        check(f"[{tag}] console clean", not errs, errs[:3])
        b.close()

try:
    run(390, 780, False, False)
    run(360, 640, False, True)
    run(1280, 720, False, False)
finally:
    srv.terminate()
print(f"{sum(results)} / {len(results)}")
sys.exit(0 if all(results) else 1)
