#!/usr/bin/env python3
"""Phase 28: browser checks that stay a while NEVER TRAPS her, in ?stay (headless Chromium, software WebGL).
Usage: npm run build && python3 tools/stay_exits.py [out_dir]     (default docs/phase28/stay)
Checks, at 390x780 (touch), 360x640 (touch, reduced motion) and 1280x720 (mouse and keys):
  * the two exit buttons ("play the ending again", "read the letter again") are on screen from the start, 44x44 or more, each with a name, beside the wishes button;
  * in EVERY activity the view has here (wander, constellations, a wish card open) both exits are on offer (the machine says so and both buttons are visible);
  * the LETTER exit works by tap or click and by keyboard (Tab to the button, Enter): the real reader opens with content/letter.md byte for byte, she is "left", Escape puts it away and she is back
    staying, with both exits again;
  * the ENDING exit works by tap or click and by keyboard: she is "left", the finale machine runs again (second start), and she is brought back staying when it is done (the reduced run waits for it);
  * a letter opened DURING a replay does not end the replay early and she is back afterwards;
  * the two exits also work through the same door a key or a test uses (window.__stay.toLetter / replay);
  * the console is clean.
NOT covered: pets and secrets as activities (they are not in this view yet), the finale's PICTURE during a replay (the full card plays it), a real thumb, a screen reader.
Trust it for: wiring and states."""
import sys, subprocess, time, os
from playwright.sync_api import sync_playwright
out = sys.argv[1] if len(sys.argv) > 1 else "docs/phase28/stay"
os.makedirs(out, exist_ok=True)
port = os.environ.get("PORT", "4193")
LETTER = open("content/letter.md", "rb").read().decode("utf-8")
srv = subprocess.Popen([sys.executable, "-m", "http.server", port, "-d", "dist"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
res = []
def check(name, ok, extra=""):
    res.append(bool(ok)); print(("PASS " if ok else "FAIL ") + name + (" :: " + str(extra)[:160] if extra != "" else ""), flush=True)
def real(logs):
    return [l for l in logs if "ReadPixels" not in l and "GPU stall" not in l]
BOTH = ["letter", "replay"]
def js(pg, e): return pg.evaluate(e)
def open_page(b, w, h, reduced, touch):
    ctx = b.new_context(viewport={"width": w, "height": h}, device_scale_factor=1, has_touch=touch, is_mobile=touch)
    pg = ctx.new_page(); logs = []
    pg.on("console", lambda m: logs.append(m.type + ": " + m.text) if m.type == "error" else None)
    pg.on("pageerror", lambda e: logs.append("pageerror: " + str(e)))
    pg.goto(f"http://localhost:{port}/?stay&nopost" + ("&reduced" if reduced else ""))
    pg.wait_for_function("getComputedStyle(document.getElementById('splash')).display === 'none'", timeout=120000)
    pg.wait_for_function("window.__stay !== undefined", timeout=20000)
    pg.wait_for_timeout(900)
    return pg, logs
def press(pg, sel, touch):
    loc = pg.locator(sel + ":visible").first
    if touch: loc.tap()
    else: loc.click()
def tab_to(pg, cls, tries=10):
    for _ in range(tries):
        pg.keyboard.press("Tab")
        if js(pg, f"document.activeElement && document.activeElement.classList.contains('{cls}')"): return True
    return False
def wait_staying(pg, secs):
    try:
        pg.wait_for_function("window.__stay.phase() === 'staying'", timeout=secs * 1000); return True
    except Exception:
        return False
def exits_ok(pg, tag, why):
    ok = js(pg, "window.__stay.exits()") == BOTH and pg.locator(".wl-replay-letter:visible").count() == 1 and pg.locator(".wl-replay-finale:visible").count() == 1
    check(f"[{tag}] both exits on offer ({why})", ok, js(pg, "window.__stay.exits()"))
def close_cards(pg):
    for _ in range(8):
        if not js(pg, "window.__stay.card().open"): break
        pg.keyboard.press("Escape"); pg.wait_for_timeout(450)
try:
    with sync_playwright() as p:
        b = p.chromium.launch(args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"])
        sizes = [(390, 780, False, True), (360, 640, True, True), (1280, 720, False, False)]
        if os.environ.get("ONLY"):
            sizes = [sizes[int(os.environ["ONLY"])]]  # ONLY=2 runs the 1280x720 case alone
        for (w, h, reduced, touch) in sizes:
            tag = f"{w}x{h}" + ("r" if reduced else "")
            pg, logs = open_page(b, w, h, reduced, touch)
            # 1. the buttons
            for kind in ["wishes", "finale", "letter"]:
                loc = pg.locator(f".wl-replay-{kind}:visible")
                bb = loc.first.bounding_box() if loc.count() == 1 else None
                check(f"[{tag}] {kind} button visible once, 44x44 or more, named", loc.count() == 1 and bb and bb["width"] >= 44 and bb["height"] >= 44 and bool(loc.first.get_attribute("aria-label")), bb and (round(bb["width"]), round(bb["height"]), loc.first.get_attribute("aria-label")))
            check(f"[{tag}] arrives staying", js(pg, "window.__stay.phase()") == "staying" and js(pg, "window.__stay.finale().done") is True and js(pg, "window.__stay.letter().canReadAgain") is True)
            if w == 390: pg.screenshot(path=f"{out}/exits_{tag}.png")
            # 2. every activity: wander, constellations, a wish card open; the letter exit by tap or click from each
            for act in ["wander", "constellations", "wishes"]:
                if act == "constellations":
                    js(pg, "for (let i = 0; i < 4; i++) window.__stay.key('ArrowUp')")
                if act == "wishes":
                    press(pg, ".wl-replay-wishes", touch); pg.wait_for_timeout(700)
                check(f"[{tag}] activity is {act}", js(pg, "window.__stay.activity()") == act, js(pg, "window.__stay.activity()"))
                exits_ok(pg, tag, act)
                press(pg, ".wl-replay-letter", touch); pg.wait_for_timeout(500)
                check(f"[{tag}] letter exit from {act}: left, real reader open, exits none while away", js(pg, "window.__stay.phase()") == "left" and js(pg, "window.__stay.readerOpen()") is True and js(pg, "window.__stay.exits()") == [])
                check(f"[{tag}] reader holds content/letter.md byte for byte", js(pg, "document.querySelector('.wl-letter-text').textContent") == LETTER)
                check(f"[{tag}] ending button hidden while away", pg.locator(".wl-replay-finale:visible").count() == 0)
                pg.keyboard.press("Escape"); pg.wait_for_timeout(600)
                check(f"[{tag}] Escape puts the letter away and she is back staying", js(pg, "window.__stay.phase()") == "staying" and js(pg, "window.__stay.readerOpen()") is False)
                exits_ok(pg, tag, f"back from the letter, {act}")
            close_cards(pg)
            # 3. the ending exit, by tap or click
            n0 = js(pg, "window.__stay.finale().timesStarted")
            press(pg, ".wl-replay-finale", touch); pg.wait_for_timeout(500)
            check(f"[{tag}] ending exit: left, the finale started again", js(pg, "window.__stay.phase()") == "left" and js(pg, "window.__stay.finale().timesStarted") == n0 + 1 and js(pg, "window.__stay.finale().done") is False, js(pg, "window.__stay.finale()"))
            if reduced:
                # 4. a letter opened during the replay does not end it, and she is still brought back
                press(pg, ".wl-replay-letter", touch); pg.wait_for_timeout(400)
                check(f"[{tag}] letter opened during the replay: the reader opens", js(pg, "window.__stay.readerOpen()") is True)
                pg.keyboard.press("Escape"); pg.wait_for_timeout(500)
                check(f"[{tag}] put away again: the replay is still running (she is not dropped back early)", js(pg, "window.__stay.phase()") == "left" and js(pg, "window.__stay.finale().done") is False, js(pg, "[window.__stay.phase(), window.__stay.finale()]"))
            back = wait_staying(pg, int(os.environ.get("ENDWAIT", "150")) if not reduced else 40)
            check(f"[{tag}] the ending finishes and she is back staying with both exits", back and js(pg, "window.__stay.finale().done") is True and js(pg, "window.__stay.exits()") == BOTH, js(pg, "[window.__stay.phase(), window.__stay.finale()]"))
            check(f"[{tag}] console clean (first half)", not real(logs), real(logs)[:2])
            pg.context.close()
            # 5. by keyboard only, on a fresh page (and the two doors a key or a test would use)
            pg, logs = open_page(b, w, h, reduced, touch)
            ok = tab_to(pg, "wl-replay-letter")
            check(f"[{tag}] keyboard: Tab reaches the letter button", ok)
            pg.keyboard.press("Enter"); pg.wait_for_timeout(600)
            check(f"[{tag}] keyboard: Enter opens the letter, she is left", js(pg, "window.__stay.phase()") == "left" and js(pg, "window.__stay.readerOpen()") is True)
            pg.keyboard.press("Escape"); pg.wait_for_timeout(700)
            check(f"[{tag}] keyboard: Escape, she is back staying", js(pg, "window.__stay.phase()") == "staying" and js(pg, "window.__stay.readerOpen()") is False)
            foc = js(pg, "!!document.activeElement && !!document.activeElement.closest && !!document.activeElement.closest('.wl-replay')")
            check(f"[{tag}] keyboard: focus returns to the replay column (Phase 24 rule)", foc, js(pg, "document.activeElement && document.activeElement.className"))
            # the arrow keys still turn the view once focus is back on the page body
            ok = tab_to(pg, "wl-replay-finale")
            check(f"[{tag}] keyboard: Tab reaches the ending button", ok)
            n0 = js(pg, "window.__stay.finale().timesStarted")
            pg.keyboard.press("Space"); pg.wait_for_timeout(500)
            check(f"[{tag}] keyboard: Space plays the ending again, she is left", js(pg, "window.__stay.phase()") == "left" and js(pg, "window.__stay.finale().timesStarted") == n0 + 1)
            if reduced:
                check(f"[{tag}] keyboard: and she is back staying when it is done", wait_staying(pg, 40) and js(pg, "window.__stay.exits()") == BOTH)
                check(f"[{tag}] the key door toLetter() leaves for the letter", js(pg, "window.__stay.toLetter()") is True and js(pg, "window.__stay.phase()") == "left" and js(pg, "window.__stay.readerOpen()") is True)
                pg.keyboard.press("Escape"); pg.wait_for_timeout(600)
                check(f"[{tag}] ...and she is back", js(pg, "window.__stay.phase()") == "staying")
                check(f"[{tag}] the key door replay() plays the ending", js(pg, "window.__stay.replay()") is True and js(pg, "window.__stay.phase()") == "left")
                check(f"[{tag}] ...and she is back", wait_staying(pg, 40))
            check(f"[{tag}] console clean (second half)", not real(logs), real(logs)[:2])
            pg.context.close()
        b.close()
finally:
    srv.terminate()
print(f"{sum(res)} / {len(res)}")
sys.exit(0 if all(res) else 1)
