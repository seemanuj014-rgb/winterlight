#!/usr/bin/env python3
"""Phase 27: browser checks of the letter ritual in ?letter&ritual (headless Chromium; the view is plain DOM, no WebGL needed beyond the page boot).

Usage:  npm run build && python3 tools/letter_check.py [out_dir]     (default docs/phase27)
Checks: the envelope arrives and WAITS (never opens by itself); a tap or Enter opens it; the reader shows the given text BYTE FOR BYTE (textContent, emoji, spaces, blank lines);
        the sign-off is its own block under the letter; a scroll to the end counts as read once; close puts it away and shows the read-again button; read again reopens with no
        envelope and does not count a second read; Escape closes; reduced motion has the same beats; no console errors. Shots of a LONG made-up letter at three sizes.
Trust it for: the DOM wiring and the exact text. Not for: how it looks on her phone, the real envelope picture (not built), a screen reader.
"""
import sys, subprocess, time, os, json
from urllib.parse import quote
from playwright.sync_api import sync_playwright

out = sys.argv[1] if len(sys.argv) > 1 else "docs/phase27"
os.makedirs(out, exist_ok=True)
port = os.environ.get("PORT", "4188")
srv = subprocess.Popen([sys.executable, "-m", "http.server", port, "-d", "dist"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
rows = []
def check(name, ok, detail=""):
    rows.append({"check": name, "ok": bool(ok), "detail": detail})
    print(("PASS " if ok else "FAIL ") + name + (("  " + str(detail)[:200]) if detail else ""), flush=True)

# made-up text, never the owner's. Long on purpose; has an emoji, a double space, a blank line, a tab, an angle bracket and an ampersand.
PARA = "Lorem ipsum dolor sit amet,  consectetur adipiscing elit; sed do eiusmod tempor <b>not html</b> & more 🙂\tafter a tab."
LONG = "\n\n".join([f"Paragraph {i}. " + PARA + " " + PARA for i in range(1, 15)])
SIGN = "Made-up sign-off line|Made-up maker line"

def url(q, text=None, sign=SIGN):
    u = f"http://localhost:{port}/?letter&ritual&{q}"
    if text is not None:
        u += "&text=" + quote(text.replace("\n", "\\n"), safe="")
    if sign:
        u += "&signoff=" + quote(sign, safe="|")
    return u

def open_page(b, q, w=390, h=780, text=LONG, sign=SIGN):
    pg = b.new_page(viewport={"width": w, "height": h}, device_scale_factor=1)
    logs = []
    pg.on("console", lambda m: logs.append(m.type + ": " + m.text) if m.type == "error" else None)
    pg.on("pageerror", lambda e: logs.append("pageerror: " + str(e)))
    pg.goto(url(q, text, sign))
    pg.wait_for_function("getComputedStyle(document.getElementById('splash')).display === 'none'", timeout=120000)
    pg.wait_for_function("window.__letter !== undefined && window.__letter.act !== undefined", timeout=20000)
    return pg, logs

def real_errors(logs):
    return [l for l in logs if "ReadPixels" not in l and "GPU stall" not in l]

def phase(pg):
    return pg.evaluate("window.__letter.state().phase")

def run_flow(b, reduced):
    tag = "reduced: " if reduced else ""
    q = "reduced" if reduced else "x=1"
    pg, logs = open_page(b, q)
    check(tag + "starts arriving, the reader is closed", phase(pg) in ("arriving", "waiting") and not pg.evaluate("window.__letter.isOpen()"), phase(pg))
    pg.wait_for_function("window.__letter.state().phase === 'waiting'", timeout=20000)
    check(tag + "the envelope is waiting and can be opened", pg.evaluate("window.__letter.state().canOpen"))
    pg.wait_for_timeout(4000)
    check(tag + "it is STILL waiting 4 s later: nothing opens it by itself", phase(pg) == "waiting" and not pg.evaluate("window.__letter.isOpen()"))
    check(tag + "no read-again button yet", pg.locator(".wl-replay-letter:visible").count() == 0)
    pg.wait_for_function("getComputedStyle(document.querySelector('.wl-envelope-stub')).opacity === '1'", timeout=5000)
    pg.focus(".wl-envelope-stub")
    pg.keyboard.press("Enter")
    check(tag + "Enter on the envelope opens it", phase(pg) in ("opening", "reading"), phase(pg))
    pg.wait_for_function("window.__letter.state().phase === 'reading'", timeout=20000)
    check(tag + "the reader is open after the opening", pg.evaluate("window.__letter.isOpen()"))
    shown = pg.evaluate("document.querySelector('.wl-letter-text').textContent")
    check(tag + "the shown text equals the given text, byte for byte", shown == LONG, f"{len(shown)} vs {len(LONG)}")
    check(tag + "the letter column holds only the letter (no sign-off inside it)", "Made-up" not in shown)
    sign = pg.evaluate("[...document.querySelectorAll('.wl-letter-signoff p')].map(p => p.textContent)")
    check(tag + "the sign-off is its own block with the two given lines", sign == ["Made-up sign-off line", "Made-up maker line"], sign)
    check(tag + "not read yet while only the top is shown", pg.evaluate("window.__letter.readCount()") == 0)
    pg.evaluate("document.querySelector('.wl-letter-scroll').scrollTop = 1e6")
    pg.wait_for_function("window.__letter.readCount() === 1", timeout=5000)
    check(tag + "scrolled to the end: read counted once", pg.evaluate("window.__letter.readCount()") == 1)
    pg.evaluate("document.querySelector('.wl-letter-scroll').scrollTop = 0; document.querySelector('.wl-letter-scroll').scrollTop = 1e6")
    pg.wait_for_timeout(200)
    check(tag + "scrolling again does not count a second read", pg.evaluate("window.__letter.readCount()") == 1)
    check(tag + "the saved progress says the letter is read", "\"letterRead\":true" in (pg.evaluate("Object.values(localStorage).join('|')") or ""))
    pg.locator(".wl-letter-close").click()
    check(tag + "the close button puts it away (state closed, reader hidden)", phase(pg) == "closed" and not pg.evaluate("window.__letter.isOpen()"), phase(pg))
    check(tag + "the read-again button appears, 44x44", pg.locator(".wl-replay-letter:visible").count() == 1 and pg.evaluate("(() => { const r = document.querySelector('.wl-replay-letter').getBoundingClientRect(); return Math.round(r.width) === 44 && Math.round(r.height) === 44; })()"))
    check(tag + "the read-again button has a name", bool(pg.get_attribute(".wl-replay-letter", "aria-label")))
    pg.locator(".wl-replay-letter").click()
    check(tag + "read again opens the reader straight away (no envelope)", phase(pg) == "reading" and pg.evaluate("window.__letter.isOpen()") and pg.locator(".wl-envelope-stub:visible").count() == 0, phase(pg))
    check(tag + "the button hides while she reads", pg.locator(".wl-replay-letter:visible").count() == 0)
    check(tag + "the text is the same again", pg.evaluate("document.querySelector('.wl-letter-text').textContent") == LONG)
    check(tag + "no second read was counted", pg.evaluate("window.__letter.readCount()") == 1)
    pg.keyboard.press("Escape")
    check(tag + "Escape closes it", phase(pg) == "closed" and not pg.evaluate("window.__letter.isOpen()"), phase(pg))
    names = [e["name"] for e in pg.evaluate("window.__letter.busLog()")]
    check(tag + "the bus saw: enter 5, arrive, open, read, close, done, open, close, done", names == ["act:enter", "letter:arrive", "letter:open", "letter:read", "letter:close", "act:done", "letter:open", "letter:close", "act:done"], names)
    check(tag + "no console errors", not real_errors(logs), real_errors(logs))
    pg.close()

try:
    with sync_playwright() as p:
        b = p.chromium.launch(args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"])
        run_flow(b, False)
        run_flow(b, True)

        # exact text with awkward characters, short letter (no scroll needed: counts as read at once)
        odd = "  leading spaces\n\n\tTab\nemoji 😭😭 and नमस्ते\ntrailing   \n\n"
        pg, logs = open_page(b, "x=1&opened", text=odd, sign="|")
        pg.wait_for_function("window.__letter.state().phase === 'reading'", timeout=20000)
        shown = pg.evaluate("document.querySelector('.wl-letter-text').textContent")
        check("awkward text (leading spaces, tab, emoji, Devanagari, trailing blank lines) is shown byte for byte", shown == odd, repr(shown))
        pg.wait_for_function("window.__letter.readCount() === 1", timeout=5000)
        check("a letter shorter than the screen counts as read at once", pg.evaluate("window.__letter.readCount()") == 1)
        check("no sign-off block when there is nothing to show", pg.locator(".wl-letter-signoff").count() == 0)
        check("no console errors (short letter)", not real_errors(logs), real_errors(logs))
        pg.close()

        # shots: a long made-up letter at three sizes: the top, and the end with the sign-off
        for w, h in ((390, 780), (360, 640), (1280, 720)):
            pg, logs = open_page(b, "x=1&opened", w=w, h=h)
            pg.wait_for_function("window.__letter.state().phase === 'reading'", timeout=20000)
            pg.wait_for_timeout(600)
            pg.screenshot(path=f"{out}/letter_{w}x{h}_top.png")
            pg.evaluate("document.querySelector('.wl-letter-scroll').scrollTop = 1e6")
            pg.wait_for_timeout(300)
            pg.screenshot(path=f"{out}/letter_{w}x{h}_end.png")
            fit = pg.evaluate("(() => { const t = document.querySelector('.wl-letter-text'); return t.scrollWidth <= t.clientWidth + 1 && document.documentElement.scrollWidth <= innerWidth; })()")
            check(f"{w}x{h}: nothing runs off the side", fit)
            check(f"{w}x{h}: no console errors", not real_errors(logs), real_errors(logs))
            pg.close()

        # the stand-in envelope while waiting
        pg, logs = open_page(b, "at=30", w=390, h=780)
        pg.wait_for_timeout(500)
        pg.screenshot(path=f"{out}/envelope_waiting_390.png")
        pg.close()
        b.close()
finally:
    srv.terminate()

json.dump(rows, open(f"{out}/letter_check.json", "w"), indent=1)
bad = [r for r in rows if not r["ok"]]
print(f"\n{len(rows) - len(bad)} / {len(rows)} checks pass")
sys.exit(1 if bad else 0)
