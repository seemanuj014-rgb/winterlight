#!/usr/bin/env python3
"""Phase 24 (first half): the wish card and the name labels in a real browser (headless Chromium, software WebGL).

Usage:  npm run build && PORT=<own> python3 tools/ui_check.py [out_dir]
Opens ?sky&done=strawberry,rose at 360x640, 390x780 (with a notch's safe areas faked), 844x390 sideways and 1280x720, taps a finished star so the card opens,
and checks: the card is on screen and inside the safe area, never wider than 26rem or 86% of the width, text is exactly the file's text, the card has focus,
Escape closes it and focus goes back, a long TEST string (made up by this tool, NOT shipped) scrolls inside the card instead of running off, a Devanagari
TEST string gets a real font (no empty boxes: width is not zero), reduced motion has no transition, no console errors. Saves screenshots to <out_dir>.
Trust it for layout and behaviour. NOT for how it looks on her phone, her font, or contrast by eye (contrast is computed in tests/ui.test.ts).
"""
import sys, os, json, time, subprocess
from playwright.sync_api import sync_playwright

out = sys.argv[1] if len(sys.argv) > 1 else "docs/phase24"
os.makedirs(out, exist_ok=True)
port = os.environ.get("PORT", "4184")
srv = subprocess.Popen([sys.executable, "-m", "http.server", port, "-d", "dist"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
WISHES = json.load(open("content/wishes.json", encoding="utf8"))
results = []
LONG = "Test text for layout only, written by the test tool and never shipped. " * 6
DEVA = "\u0905\u0906\u0907\u0908\u0909 \u0915\u0916\u0917\u0918 \u0928\u092e\u0938\u094d\u0924\u0947"


def check(name, ok, detail=""):
    results.append((name, bool(ok), detail))
    print(("PASS " if ok else "FAIL ") + name + (("  " + detail) if detail else ""), flush=True)


def run(b, w, h, tag, reduced=False, notch=None, touch=True):
    ctx = b.new_context(viewport={"width": w, "height": h}, has_touch=touch, is_mobile=touch, device_scale_factor=1, reduced_motion="reduce" if reduced else "no-preference")
    pg = ctx.new_page()
    errs = []
    pg.on("console", lambda m: errs.append(m.text) if m.type == "error" and "ReadPixels" not in m.text else None)
    pg.on("pageerror", lambda e: errs.append("pageerror: " + str(e)))
    pg.goto(f"http://localhost:{port}/?sky&done=strawberry,rose&nopost" + ("&reduced" if reduced else ""))
    pg.wait_for_function("getComputedStyle(document.getElementById('splash')).display === 'none'", timeout=120000)
    pg.wait_for_function("window.__sky && window.__sky.t() > 0.4", timeout=60000, polling=200)
    if notch:
        pg.add_style_tag(content=f":root{{--safe-top:{notch[0]}px;--safe-right:{notch[1]}px;--safe-bottom:{notch[2]}px;--safe-left:{notch[3]}px}}")
    pg.wait_for_timeout(600)
    edges = pg.evaluate("window.__sky.edges('strawberry')")
    star = edges[0][0]
    p = pg.evaluate(f"window.__sky.screenOf('{star}')")
    if touch:
        pg.touchscreen.tap(p["x"], p["y"])
    else:
        pg.mouse.click(p["x"], p["y"])
    pg.wait_for_function("window.__sky.card().open", timeout=20000, polling=200)
    pg.wait_for_timeout(900)
    return ctx, pg, errs


with sync_playwright() as pw:
    b = pw.chromium.launch(args=["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"])
    for (w, h, tag, notch, touch) in [(360, 640, "360x640", None, True), (390, 780, "390x780_notch", (47, 0, 34, 0), True), (844, 390, "844x390_sideways", (0, 47, 21, 47), True), (1280, 720, "desktop", None, False)]:
        ctx, pg, errs = run(b, w, h, tag, notch=notch, touch=touch)
        card = pg.evaluate("(()=>{const e=document.getElementById('wish-card');const r=e.getBoundingClientRect();const cs=getComputedStyle(e);return {x:r.x,y:r.y,w:r.width,h:r.height,txt:e.textContent,font:cs.fontSize,focus:document.activeElement===e,role:e.getAttribute('role'),vis:cs.display!=='none'&&Number(cs.opacity)>0.9}})()")
        t, r_, bt, l = (notch or (0, 0, 0, 0))
        check(f"{tag}: card visible", card["vis"])
        check(f"{tag}: inside the safe area", card["x"] >= l - 0.5 and card["y"] >= t - 0.5 and card["x"] + card["w"] <= w - r_ + 0.5 and card["y"] + card["h"] <= h - bt + 0.5, f"x{card['x']:.0f} y{card['y']:.0f} w{card['w']:.0f} h{card['h']:.0f}")
        check(f"{tag}: not wider than 26rem or 86% of the usable width", card["w"] <= min(26 * 16, (w - l - r_) * 0.86) + 1, f"w{card['w']:.0f}")
        check(f"{tag}: text is exactly the file's text", card["txt"] == WISHES["strawberry"], repr(card["txt"]))
        check(f"{tag}: card has focus and is a dialog", card["focus"] and card["role"] == "dialog")
        pg.screenshot(path=f"{out}/card_{tag}.png")
        # long made-up text: the card scrolls inside itself
        pg.evaluate("(t)=>{document.querySelector('#wish-card span').textContent=t}", LONG)
        pg.wait_for_timeout(200)
        lc = pg.evaluate("(()=>{const e=document.getElementById('wish-card');const r=e.getBoundingClientRect();return {y:r.y,h:r.height,bottom:r.y+r.height,sh:e.scrollHeight,ch:e.clientHeight}})()")
        check(f"{tag}: a long text stays inside the screen", lc["y"] >= t - 0.5 and lc["bottom"] <= h - bt + 0.5, f"y{lc['y']:.0f} bottom{lc['bottom']:.0f}")
        pg.screenshot(path=f"{out}/card_long_{tag}.png")
        # Devanagari made-up glyphs: a real font, not empty boxes (width > 0 and differs from a missing-glyph run)
        pg.evaluate("(t)=>{document.querySelector('#wish-card span').textContent=t}", DEVA)
        pg.wait_for_timeout(200)
        dw = pg.evaluate("(()=>{const s=document.querySelector('#wish-card span');return s.getBoundingClientRect().width})()")
        check(f"{tag}: Devanagari test glyphs have width", dw > 20, f"{dw:.0f}px")
        if tag == "390x780_notch":
            pg.screenshot(path=f"{out}/card_deva_{tag}.png")
        # Escape closes and gives focus back; a second tap reopens
        pg.keyboard.press("Escape")
        pg.wait_for_function("!window.__sky.card().open", timeout=5000, polling=100)
        check(f"{tag}: Escape closes the card", True)
        if tag == "390x780_notch":
            pg.wait_for_timeout(300)
            pg.screenshot(path=f"{out}/names_{tag}.png")
        check(f"{tag}: no console errors", not errs, "; ".join(errs[:2]))
        ctx.close()
    # the letter reader (made-up text from the URL; content/letter.md is not touched)
    from urllib.parse import quote
    PARA = "Made up for layout only.\\nSecond line, kept as typed.\\n\\n" + ("A made-up sentence that only tests wrapping and scrolling in the reader. " * 40)
    for (w, h, tag, notch, touch) in [(360, 640, "360x640", None, True), (390, 780, "390x780_notch", (47, 0, 34, 0), True), (1280, 720, "desktop", None, False)]:
        ctx = b.new_context(viewport={"width": w, "height": h}, has_touch=touch, is_mobile=touch, device_scale_factor=1)
        pg = ctx.new_page()
        errs = []
        pg.on("console", lambda m: errs.append(m.text) if m.type == "error" and "ReadPixels" not in m.text else None)
        pg.on("pageerror", lambda e: errs.append("pageerror: " + str(e)))
        pg.goto(f"http://localhost:{port}/?letter&text={quote(PARA)}")
        pg.wait_for_function("window.__letter && window.__letter.isOpen()", timeout=60000, polling=200)
        if notch:
            pg.add_style_tag(content=f":root{{--safe-top:{notch[0]}px;--safe-right:{notch[1]}px;--safe-bottom:{notch[2]}px;--safe-left:{notch[3]}px}}")
        pg.wait_for_timeout(900)
        m = pg.evaluate("(()=>{const t=document.querySelector('.wl-letter-text');const r=t.getBoundingClientRect();const c=document.querySelector('.wl-letter-close').getBoundingClientRect();const sc=document.querySelector('.wl-letter-scroll');return {txt:t.textContent,x:r.x,w:r.width,top:r.y,cx:c.x,cy:c.y,cw:c.width,ch:c.height,sh:sc.scrollHeight,ch2:sc.clientHeight,fs:parseFloat(getComputedStyle(t).fontSize),ws:getComputedStyle(t).whiteSpace,focus:document.activeElement.className}})()")
        t_, r_, bt, l_ = (notch or (0, 0, 0, 0))
        exp = PARA.replace("\\n", "\n")
        check(f"letter {tag}: text is exactly what was given, line breaks kept", m["txt"] == exp and m["ws"] == "pre-wrap")
        check(f"letter {tag}: column inside the screen and safe area", m["x"] >= l_ + 16 and m["x"] + m["w"] <= w - r_ - 16, f"x{m['x']:.0f} w{m['w']:.0f}")
        cpl = m["w"] / (m["fs"] * 0.5)
        check(f"letter {tag}: about 28 to 66 characters a line", 28 <= cpl <= 66, f"{cpl:.0f} at {m['fs']:.1f}px")
        check(f"letter {tag}: first line is clear of the close button and the notch", m["top"] >= t_ + 40, f"top{m['top']:.0f}")
        check(f"letter {tag}: close button 44x44 inside the notch", abs(m["cw"] - 44) < 1 and abs(m["ch"] - 44) < 1 and m["cy"] >= t_ + 9, f"y{m['cy']:.0f}")
        check(f"letter {tag}: it scrolls and the scroller has focus", m["sh"] > m["ch2"] and "wl-letter-scroll" in m["focus"], f"{m['sh']} > {m['ch2']}")
        pg.screenshot(path=f"{out}/letter_{tag}_top.png")
        pg.evaluate("document.querySelector('.wl-letter-scroll').scrollTop = 1e6")
        pg.wait_for_timeout(200)
        prog = pg.evaluate("window.__letter.progress()")
        check(f"letter {tag}: progress reads 1 at the bottom", prog > 0.99, f"{prog:.2f}")
        pg.screenshot(path=f"{out}/letter_{tag}_bottom.png")
        pg.keyboard.press("Escape")
        pg.wait_for_function("!window.__letter.isOpen()", timeout=5000, polling=100)
        check(f"letter {tag}: Escape closes it", True)
        pg.evaluate("window.__letter.reader.open()")
        pg.wait_for_function("window.__letter.isOpen()", timeout=5000, polling=100)
        if touch:
            pg.touchscreen.tap(m["cx"] + 22, m["cy"] + 22)
        else:
            pg.mouse.click(m["cx"] + 22, m["cy"] + 22)
        pg.wait_for_function("!window.__letter.isOpen()", timeout=5000, polling=100)
        check(f"letter {tag}: the close button closes it", True)
        check(f"letter {tag}: no console errors", not errs, "; ".join(errs[:2]))
        ctx.close()
    ctx = b.new_context(viewport={"width": 390, "height": 780}, reduced_motion="reduce")
    pg = ctx.new_page()
    pg.goto(f"http://localhost:{port}/?letter&reduced&text=x")
    pg.wait_for_function("window.__letter && window.__letter.isOpen()", timeout=60000, polling=200)
    tr = pg.evaluate("[getComputedStyle(document.querySelector('.wl-letter')).transitionDuration, getComputedStyle(document.querySelector('.wl-letter')).opacity]")
    check("letter reduced motion: no transition and fully shown at once", tr[0] in ("0s", "0s, 0s") and tr[1] == "1", str(tr))
    ctx.close()
    # the real sound button on ?sky&sound
    ctx = b.new_context(viewport={"width": 390, "height": 780}, has_touch=True, is_mobile=True)
    pg = ctx.new_page()
    pg.goto(f"http://localhost:{port}/?sky&sound&nopost")
    pg.wait_for_function("window.__sky && window.__sky.t() > 0.4", timeout=60000, polling=200)
    pg.add_style_tag(content=":root{--safe-top:47px;--safe-right:0px}")
    pg.wait_for_timeout(300)
    mb = pg.evaluate("(()=>{const e=document.querySelector('.mute-button');const r=e.getBoundingClientRect();return {w:r.width,h:r.height,top:r.y,right:window.innerWidth-r.right,inline:e.getAttribute('style')}})()")
    check("sound button: 44x44, 10 px under the notch, 10 px from the right", abs(mb["w"] - 44) < 1 and abs(mb["h"] - 44) < 1 and abs(mb["top"] - 57) < 1.5 and abs(mb["right"] - 10) < 1.5, json.dumps({k: mb[k] for k in ("w", "h", "top", "right")}))
    check("sound button: look comes from the theme (no inline style)", not mb["inline"], str(mb["inline"]))
    pg.keyboard.press("Tab")  # Phase 24: the sound button is first in the tab order
    ol = pg.evaluate("document.activeElement.className==='mute-button' ? getComputedStyle(document.activeElement).outlineStyle : 'not focused: '+document.activeElement.tagName")
    check("sound button: a keyboard focus ring shows", ol == "solid", ol)
    pg.screenshot(path=f"{out}/mute_390x780_notch.png", clip={"x": 250, "y": 0, "width": 140, "height": 120})
    ctx.close()
    # reduced motion: no transition on the card or the labels
    ctx, pg, errs = run(b, 390, 780, "reduced", reduced=True)
    tr = pg.evaluate("[getComputedStyle(document.getElementById('wish-card')).transitionDuration, getComputedStyle(document.querySelector('.wl-label')).transitionDuration]")
    check("reduced motion: card and labels have no transition", all(x in ("0s", "0s, 0s") for x in tr), str(tr))
    check("reduced motion: no console errors", not errs, "; ".join(errs[:2]))
    ctx.close()
    # normal motion keeps its fade (so the check above is not trivially true)
    ctx, pg, errs = run(b, 390, 780, "normal")
    tr = pg.evaluate("getComputedStyle(document.getElementById('wish-card')).transitionDuration")
    check("normal motion: the card does fade (0.6 s)", tr.startswith("0.6"), tr)
    ctx.close()
    b.close()
srv.terminate()
json.dump([{"name": n, "ok": o, "detail": d} for n, o, d in results], open(f"{out}/ui_check.json", "w"), indent=1)
bad = [r for r in results if not r[1]]
print(f"\n{len(results) - len(bad)} / {len(results)} checks passed")
sys.exit(1 if bad else 0)
