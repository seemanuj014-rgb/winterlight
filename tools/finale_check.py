#!/usr/bin/env python3
"""Phase 28: browser checks of the finale pictures (?finale), headless Chromium, software WebGL.
Usage: npm run build && python3 tools/finale_check.py
Checks (at 390x780, 360x640, 1280x720; normal and reduced motion): the five events in order; at the end of the joining all five shapes are on screen and the message box is inside the
screen; the message lines hold the given text (nothing cut); the aurora gain rises; the camera ends at the valley; reduced motion goes dark in the middle; console clean.
Not proven here: frame rate, a real phone, sound (not wired in this view)."""
import sys, subprocess, time, json
from urllib.parse import quote
from playwright.sync_api import sync_playwright

port = "4191"
srv = subprocess.Popen([sys.executable, "-m", "http.server", port, "-d", "dist"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
ok = bad = 0
def check(name, cond, extra=""):
    global ok, bad
    if cond: ok += 1
    else: bad += 1; print("FAIL", name, extra)
IDS = ["strawberry", "bumblebee", "rose", "kaaju-katli", "cutie-patootie"]
TEXT = "one two three four five six seven eight nine ten eleven twelve"
try:
    with sync_playwright() as p:
        b = p.chromium.launch(args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"])
        for (w, h) in [(390, 780), (360, 640), (1280, 720)]:
            for reduced in (False, True):
                r = "&reduced" if reduced else ""
                join_at = 4.5 if reduced else 13.0  # after the joining, during the swell (reduced motion is 7.4 s in all)
                def load(q):
                    pg = b.new_page(viewport={"width": w, "height": h})
                    logs = []
                    pg.on("console", lambda m: logs.append(m.type + ": " + m.text) if m.type == "error" else None)
                    pg.on("pageerror", lambda e: logs.append(str(e)))
                    pg.goto(f"http://localhost:{port}/?{q}")
                    pg.wait_for_function("getComputedStyle(document.getElementById('splash')).display === 'none'", timeout=120000)
                    pg.wait_for_timeout(800)
                    return pg, logs
                tag = f"{w}x{h}{' reduced' if reduced else ''}"
                pg, logs = load(f"finale&at={30 if not reduced else 9}&text={quote(TEXT)}{r}")
                st = pg.evaluate("({phase: window.__finale.phase(), log: window.__finale.log().map(e => e.type), cam: window.__finale.camera(), msg: window.__finale.message(), aurora: window.__finale.aurora()})")
                check(tag + " events in order", st["log"] == ["start", "join", "swell", "pullback", "done"], st["log"])
                check(tag + " ends done", st["phase"] == "done")
                check(tag + " ends at the valley (eye 8 m left, 14 m back)", abs(st["cam"]["eye"][0] + 8) < 0.01 and abs(st["cam"]["eye"][2] - 14) < 0.01, st["cam"])
                check(tag + " aurora at the fullest", st["aurora"] > 2.0, st["aurora"])
                check(tag + " the message lines hold the text", " ".join(st["msg"]["lines"]).split() == TEXT.split(), st["msg"])
                check(tag + " console clean", not logs, logs)
                pg.close()
                pg, logs = load(f"finale&at={join_at}&text={quote(TEXT)}{r}")
                st = pg.evaluate("({shapes: %s.map(id => window.__finale.shapeAt(id)), box: window.__finale.messageBox(), draws: window.__finale.draws(), sky: window.__finale.skyDraws()})" % json.dumps(IDS))
                check(tag + " five shapes on screen", all(s and 0 <= s["x"] <= w and 0 <= s["y"] <= h for s in st["shapes"]), st["shapes"])
                bx = st["box"]
                check(tag + " message box inside the screen", bx and bx["x0"] >= 0 and bx["x1"] <= w and bx["y0"] >= 0 and bx["y1"] <= h, bx)
                check(tag + " draw calls under 60 at the sky", st["draws"] < 60, st["draws"])
                check(tag + " console clean (join)", not logs, logs)
                pg.close()
            # reduced motion goes dark while the camera changes places
            pg, logs = load(f"finale&at=6.2&reduced")
            check(f"{w}x{h} reduced: dark in the middle of the pull-back", pg.evaluate("window.__finale.fade()") == 1)
            pg.close()
        b.close()
finally:
    srv.terminate()
print(f"{ok} / {ok + bad}")
sys.exit(1 if bad else 0)
