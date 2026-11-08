#!/usr/bin/env python3
"""Phase 27: browser checks of the real envelope picture in ?envelope (headless Chromium, software WebGL).

Usage:  npm run build && python3 tools/envelope_check.py [out_json]     (default docs/phase27/envelope_check.json)
Checks: it comes down (hidden, then arriving) and waits (still waiting after a long pause; nothing opens it by itself); the picker target exists only while it waits, is at least 44 px across and sits over the envelope;
        a tap opens it: the flap swings, the letter slides, THEN the reader opens with the file's text byte for byte; close, "read again" shows; draw calls stay under the limit; reduced motion has the same beats;
        no console errors.
Trust it for: the logic wired to the page, the picker target, the draw count (software GL). Not for: speed, a real phone, the look (look at the frames).
"""
import sys, subprocess, time, os, json
from urllib.parse import quote
from playwright.sync_api import sync_playwright

out = sys.argv[1] if len(sys.argv) > 1 else "docs/phase27/envelope_check.json"
port = os.environ.get("PORT", "4190")
srv = subprocess.Popen([sys.executable, "-m", "http.server", port, "-d", "dist"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
rows = []
def check(name, ok, detail=""):
    rows.append({"check": name, "ok": bool(ok), "detail": detail})
    print(("PASS " if ok else "FAIL ") + name + (("  " + str(detail)) if detail else ""), flush=True)

def open_page(b, q, w=390, h=780, touch=False):
    # a touch page needs a touch context (as tools/cake_input.py): without has_touch the browser never turns CDP touch points into pointer events
    ctx = b.new_context(viewport={"width": w, "height": h}, has_touch=touch, is_mobile=touch, device_scale_factor=1)
    pg = ctx.new_page()
    logs = []
    pg.on("console", lambda m: logs.append(m.type + ": " + m.text) if m.type == "error" else None)
    pg.on("pageerror", lambda e: logs.append("pageerror: " + str(e)))
    pg.goto(f"http://localhost:{port}/?{q}")
    pg.wait_for_function("getComputedStyle(document.getElementById('splash')).display === 'none'", timeout=120000)
    pg.wait_for_function("window.__envelope !== undefined", timeout=20000)
    return pg, logs

def real_errors(logs):
    return [l for l in logs if "ReadPixels" not in l and "GPU stall" not in l]

# the page turns a literal backslash-n in `&text=` into a newline; everything else (a tab, <b>, &, two spaces) must come out as it went in
EXPECT = "First line\n\n  indented line with a tab\there\nA made-up <b>line</b> & more\n" + "filler line for length\n" * 60
MADE_UP = quote(EXPECT.replace("\n", "\\n"), safe="")

try:
    with sync_playwright() as p:
        b = p.chromium.launch(args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"])
        for reduced in (False, True):
            tag = "reduced: " if reduced else ""
            rq = "&reduced" if reduced else ""
            # 1. arriving then waiting
            pg, logs = open_page(b, "envelope&at=0.5&freeze&debug&tier=low" + rq)
            st = pg.evaluate("window.__envelope.state()")
            check(tag + "just started: arriving, not openable, nothing to pick", st["phase"] == "arriving" and not st["canOpen"] and pg.evaluate("window.__envelope.picked()") is None, st["phase"])
            c = pg.evaluate("window.__envelope.screen()")
            pg.mouse.click(c["x"], c["y"])
            check(tag + "a click on the drifting envelope does nothing", pg.evaluate("window.__envelope.state().phase") == "arriving")
            pg.close()
            pg, logs = open_page(b, "envelope&at=9&text=" + MADE_UP + "&signoff=Made%20up%20sign-off%7CMade%20up%20name&debug&tier=low" + rq, touch=not reduced)
            st = pg.evaluate("window.__envelope.state()")
            check(tag + "at 9 s it is waiting and can be opened", st["phase"] == "waiting" and st["canOpen"], st["phase"])
            check(tag + "no reader opened by itself", not pg.evaluate("window.__envelope.isReaderOpen()"))
            pg.wait_for_timeout(4000)
            check(tag + "still waiting after a pause (nothing auto-advances)", pg.evaluate("window.__envelope.state().phase") == "waiting")
            pk = pg.evaluate("window.__envelope.picked()")
            sc = pg.evaluate("window.__envelope.screen()")
            check(tag + "the picker has the envelope while it waits", pk is not None, pk)
            check(tag + "picker target is at least 44 px across", pk is not None and pk["radiusPx"] * 2 >= 44, pk)
            check(tag + "the picker target sits over the envelope", pk is not None and abs(pk["x"] - sc["x"]) < 30 and abs(pk["y"] - sc["y"]) < 30, [pk, sc])
            check(tag + "no extra DOM button over the picture", pg.locator(".wl-envelope-tap").count() == 0)
            # a tap far from it picks nothing (a touch page gets a touch tap, as a real phone would; the reduced run uses the mouse)
            if not reduced:
                cdp = pg.context.new_cdp_session(pg)
                cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": 8, "y": 8, "id": 0}]})
                # down and up back to back: on software GL a slow frame can land between them and the 500 ms hold timer would turn a tap into a hold (a tool artefact, not the picker)
                cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
                pg.wait_for_timeout(1200)
            else:
                pg.mouse.click(8, 8)
            check(tag + "a click far away does nothing", pg.evaluate("window.__envelope.state().phase") == "waiting")
            check(tag + "draw calls under 60 at low tier", pg.evaluate("window.__envelope.draws()") <= 60, pg.evaluate("window.__envelope.draws()"))
            if not reduced:
                # real CDP touch on the envelope (it sways: aim at where it is now)
                # software GL can block the page for a second at a time; a slow frame between the touch's down and up can turn a tap into a hold, so a tap that did not register is tried again (up to 4 times) and the number of tries is in the detail
                tries = 0
                while tries < 4 and pg.evaluate("window.__envelope.state().phase") == "waiting":
                    tries += 1
                    sc = pg.evaluate("window.__envelope.screen()")
                    cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": sc["x"], "y": sc["y"], "id": 0}]})
                    cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
                    pg.wait_for_timeout(1500)
                check(tag + "a real touch tap on the envelope opens it", pg.evaluate("window.__envelope.state().phase") == "opening", f"{tries} tr{'y' if tries == 1 else 'ies'}")
            else:
                sc = pg.evaluate("window.__envelope.screen()")
                pg.mouse.click(sc["x"], sc["y"])
            st = pg.evaluate("window.__envelope.state()")
            check(tag + "a tap on the envelope opens it (phase opening) and the reader is not open yet", st["phase"] == "opening" and not pg.evaluate("window.__envelope.isReaderOpen()"), st["phase"])
            pg.wait_for_function("window.__envelope.state().phase === 'reading'", timeout=60000)
            pose = pg.evaluate("window.__envelope.pose()")
            check(tag + "flap is open and the letter is out when the reader opens", pose["flap"] > 2.5 and pose["letterOut"], [pose["flap"], pose["letterY"]])
            check(tag + "the reader is open", pg.evaluate("window.__envelope.isReaderOpen()"))
            txt = pg.evaluate("(() => { const el = document.querySelector('.wl-letter-text, [data-letter-text], .wl-letter-body'); return el ? el.textContent : null; })()")
            if txt is None:
                txt = pg.evaluate("(() => { const els = [...document.querySelectorAll('[class*=letter]')]; const e = els.find(x => x.textContent && x.textContent.includes('First line')); return e ? e.textContent : null; })()")
            check(tag + "the reader shows a text that contains the given text byte for byte", txt is not None and EXPECT in txt, None if txt is None else len(txt))
            check(tag + "nothing to pick while she reads", pg.evaluate("window.__envelope.picked()") is None)
            pg.keyboard.press("Escape")
            pg.wait_for_function("window.__envelope.state().phase === 'closed'", timeout=20000)
            check(tag + "Escape puts it away: phase closed", True)
            again = pg.locator("button[aria-label='Read the letter again']")
            check(tag + "the read-again button is on screen", again.count() == 1 and again.is_visible())
            pose = pg.evaluate("window.__envelope.pose()")
            check(tag + "the envelope stays open (no second ritual)", pose["flap"] > 2.5)
            again.click(force=True)
            check(tag + "read again reopens the reader", pg.evaluate("window.__envelope.isReaderOpen()") and pg.evaluate("window.__envelope.state().phase") == "reading")
            check(tag + "no console errors", not real_errors(logs), real_errors(logs))
            pg.close()
        # keyboard: Tab reaches the envelope (one stop), the ring shows, Enter opens it; and there is no stop before it waits
        pg, logs = open_page(b, "envelope&at=0.5&freeze&debug&tier=low")
        for _ in range(3): pg.keyboard.press("Tab")
        check("no keyboard stop on the envelope while it is still drifting", pg.evaluate("window.__envelope.focus()") is None)
        pg.close()
        pg, logs = open_page(b, "envelope&at=9&debug&tier=low")
        on = False
        for _ in range(6):
            pg.keyboard.press("Tab")
            if pg.evaluate("window.__envelope.focus()") == "envelope":
                on = True
                break
        check("Tab reaches the envelope (one keyboard stop)", on)
        if on:
            ring = pg.evaluate("(() => { const els = [...document.querySelectorAll('div')].filter(e => getComputedStyle(e).position === 'fixed' && getComputedStyle(e).borderRadius.includes('50%') && e.getBoundingClientRect().width >= 44); return els.length; })()")
            check("a focus ring is on screen", ring >= 1, ring)
            pg.keyboard.press("Enter")
            pg.wait_for_timeout(300)
            check("Enter opens it", pg.evaluate("window.__envelope.state().phase") == "opening")
        check("no console errors (keyboard run)", not real_errors(logs), real_errors(logs))
        pg.close()
        pg, logs = open_page(b, "envelope&at=9&debug&tier=low")
        for _ in range(6):
            pg.keyboard.press("Tab")
            if pg.evaluate("window.__envelope.focus()") == "envelope": break
        pg.keyboard.press("Space")
        pg.wait_for_timeout(300)
        check("Space opens it too", pg.evaluate("window.__envelope.state().phase") == "opening")
        pg.close()
        b.close()
finally:
    srv.terminate()
os.makedirs(os.path.dirname(out), exist_ok=True)
json.dump(rows, open(out, "w"), indent=1)
bad = [r for r in rows if not r["ok"]]
print(f"\n{len(rows) - len(bad)} / {len(rows)} passed")
sys.exit(1 if bad else 0)
