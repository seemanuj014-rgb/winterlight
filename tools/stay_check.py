#!/usr/bin/env python3
"""Phase 28: browser checks of stay a while's hands in ?stay (headless Chromium, software WebGL).
Usage: npm run build && python3 tools/stay_check.py [out_dir]
Checks: the wishes button exists, is 44x44 or more and has a name; a click opens the wish card with the text of content/wishes.json (a placeholder shows as it is); the activity is 'wishes' while a card is open;
arrow keys do NOT turn the view while the card has focus; Escape closes the cards and the activity comes back to 'wander'; a drag turns the view; the exits stay on offer all the time; the console is clean.
Trust it for: wiring and states. Not for how it feels on a phone."""
import sys, subprocess, time, os, json
from playwright.sync_api import sync_playwright
out = sys.argv[1] if len(sys.argv) > 1 else "docs/phase28/stay"
os.makedirs(out, exist_ok=True)
port = os.environ.get("PORT", "4192")
srv = subprocess.Popen([sys.executable, "-m", "http.server", port, "-d", "dist"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
res = []
def check(name, ok, extra=""):
    res.append(bool(ok)); print(("PASS " if ok else "FAIL ") + name + (" :: " + str(extra) if extra != "" else ""), flush=True)
try:
    with sync_playwright() as p:
        b = p.chromium.launch(args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"])
        for (w, h, reduced) in [(390, 780, False), (360, 640, True), (1280, 720, False)]:
            tag = f"{w}x{h}" + ("r" if reduced else "")
            pg = b.new_page(viewport={"width": w, "height": h}, device_scale_factor=1, has_touch=(w < 500))
            logs = []
            pg.on("console", lambda m: logs.append(m.type + ": " + m.text) if m.type == "error" else None)
            pg.on("pageerror", lambda e: logs.append("pageerror: " + str(e)))
            pg.goto(f"http://localhost:{port}/?stay&nopost" + ("&reduced" if reduced else ""))
            pg.wait_for_function("getComputedStyle(document.getElementById('splash')).display === 'none'", timeout=120000)
            pg.wait_for_timeout(1200)
            btn = pg.locator(".wl-replay-wishes:visible")
            check(f"[{tag}] wishes button is visible, one button only (the two exits are checked by tools/stay_exits.py)", btn.count() == 1, btn.count())
            bb = btn.first.bounding_box()
            check(f"[{tag}] button is at least 44x44", bb and bb["width"] >= 44 and bb["height"] >= 44, bb and (bb["width"], bb["height"]))
            check(f"[{tag}] button has an accessible name", bool(btn.first.get_attribute("aria-label")), btn.first.get_attribute("aria-label"))
            check(f"[{tag}] starts staying, wander, both exits on offer", pg.evaluate("window.__stay.activity()") == "wander" and pg.evaluate("window.__stay.exits()") == ["letter", "replay"])
            yaw0 = pg.evaluate("window.__stay.pan().yawDeg")
            btn.first.click()
            pg.wait_for_timeout(700)
            card = pg.evaluate("window.__stay.card()")
            check(f"[{tag}] click opens a wish card", card["open"] is True, card)
            check(f"[{tag}] activity is 'wishes' while a card is open", pg.evaluate("window.__stay.activity()") == "wishes")
            check(f"[{tag}] exits still on offer with the card open", pg.evaluate("window.__stay.exits()") == ["letter", "replay"])
            txt = pg.evaluate("document.getElementById('wish-card')?.textContent || ''")
            wishes = json.load(open("content/wishes.json"))
            vals = [v for v in (wishes.values() if isinstance(wishes, dict) else []) if isinstance(v, str)]
            check(f"[{tag}] card text is one of the wishes as given", any(v and v in txt for v in vals) or not vals, txt[:60])
            if w == 390: pg.screenshot(path=f"{out}/card_{tag}.png")
            pg.keyboard.press("ArrowLeft"); pg.keyboard.press("ArrowLeft")
            check(f"[{tag}] arrow keys do not turn the view while a card has focus", abs(pg.evaluate("window.__stay.pan().yawDeg") - yaw0) < 1e-6, pg.evaluate("window.__stay.pan().yawDeg"))
            for _ in range(8):
                if not pg.evaluate("window.__stay.card().open"): break
                pg.keyboard.press("Escape"); pg.wait_for_timeout(500)
            pg.wait_for_timeout(400)
            check(f"[{tag}] Escape closes every card", pg.evaluate("window.__stay.card().open") is False)
            check(f"[{tag}] activity comes back to wander", pg.evaluate("window.__stay.activity()") == "wander", pg.evaluate("window.__stay.activity()"))
            pg.evaluate("window.__stay.drag(-120, 0)")
            check(f"[{tag}] a drag still turns the view afterwards", abs(pg.evaluate("window.__stay.pan().yawDeg") - yaw0) > 1)
            pg.evaluate("for (let i = 0; i < 4; i++) window.__stay.key('ArrowUp')")
            check(f"[{tag}] looking up four key presses (24 degrees, past the 22 that count) reads as 'constellations'", pg.evaluate("window.__stay.activity()") == "constellations", pg.evaluate("window.__stay.activity()"))
            check(f"[{tag}] console clean", not logs, logs[:2])
            pg.close()
        b.close()
finally:
    srv.terminate()
print(f"{sum(res)} / {len(res)}")
sys.exit(0 if all(res) else 1)
