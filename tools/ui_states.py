#!/usr/bin/env python3
"""Phase 24 close-out: every UI state in a real browser (headless Chromium, software WebGL), with ARIA, focus-order and replay checks. Makes contact sheets.

Usage:  npm run build && PORT=<own> python3 tools/ui_states.py [out_dir]
States at 360x640, 390x780 (faked notch) and 1280x720: names in the sky, the wish card, a long wish (made-up text from this tool, never shipped), the sound button on and off,
the replay column (none finished = one button; some finished = two), the hint, the owner's line, the letter reader (made-up text from the URL), and reduced motion.
Checks: tab order (sound, music replay, wishes replay, then the scene), every control has a name, the dialog has a name, only one live region speaks when a card opens,
the wishes replay opens every finished shape's card in order, the music replay un-mutes and does not throw, reduced motion has no transitions on the buttons, no console errors.
Keeps only contact sheets in out_dir (the raw frames are deleted). NOT for how it looks on her phone, a screen reader, or sound.
"""
import sys, os, json, time, subprocess, glob
from urllib.parse import quote
from playwright.sync_api import sync_playwright
from PIL import Image, ImageDraw

out = sys.argv[1] if len(sys.argv) > 1 else "docs/phase24"
os.makedirs(out, exist_ok=True)
raw = os.path.join(out, "_raw")
os.makedirs(raw, exist_ok=True)
port = os.environ.get("PORT", "4185")
srv = subprocess.Popen([sys.executable, "-m", "http.server", port, "-d", "dist"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
NAMES = [c["id"] for c in json.load(open("content/names.json", encoding="utf8"))["constellations"]]
results = []
LONG = "Test text for layout only, written by the test tool and never shipped. " * 6
PARA = "Made up for layout only.\\nSecond line, kept as typed.\\n\\n" + ("A made-up sentence that only tests wrapping and scrolling in the reader. " * 12)


def check(name, ok, detail=""):
    results.append((name, bool(ok), detail))
    print(("PASS " if ok else "FAIL ") + name + (("  " + detail) if detail else ""), flush=True)


def open_page(b, w, h, query, notch=None, touch=True, reduced=False, wait="window.__sky && window.__sky.t() > 0.4"):
    ctx = b.new_context(viewport={"width": w, "height": h}, has_touch=touch, is_mobile=touch, device_scale_factor=1, reduced_motion="reduce" if reduced else "no-preference")
    pg = ctx.new_page()
    errs = []
    pg.on("console", lambda m: errs.append(m.text) if m.type == "error" and "ReadPixels" not in m.text else None)
    pg.on("pageerror", lambda e: errs.append("pageerror: " + str(e)))
    pg.goto(f"http://localhost:{port}/?{query}" + ("&reduced" if reduced else ""))
    pg.wait_for_function("getComputedStyle(document.getElementById('splash')).display === 'none'", timeout=120000)
    if wait:
        pg.wait_for_function(wait, timeout=60000, polling=200)
    if notch:
        pg.add_style_tag(content=f":root{{--safe-top:{notch[0]}px;--safe-right:{notch[1]}px;--safe-bottom:{notch[2]}px;--safe-left:{notch[3]}px}}")
    pg.wait_for_timeout(700)
    return ctx, pg, errs


def shot(pg, tag, vp):
    pg.screenshot(path=f"{raw}/{vp}__{tag}.png")


def sheet(vp):
    files = sorted(glob.glob(f"{raw}/{vp}__*.png"))
    if not files:
        return
    ims = [(os.path.basename(f).split("__")[1][:-4], Image.open(f).convert("RGB")) for f in files]
    th = 520
    scaled = []
    for n, im in ims:
        r = th / im.height
        scaled.append((n, im.resize((max(1, int(im.width * r)), th))))
    cols = 4 if vp != "desktop" else 3
    cw = max(i.width for _, i in scaled) + 8
    rows = (len(scaled) + cols - 1) // cols
    S = Image.new("RGB", (cols * cw, rows * (th + 22)), (20, 20, 24))
    d = ImageDraw.Draw(S)
    for k, (n, im) in enumerate(scaled):
        x, y = (k % cols) * cw + 4, (k // cols) * (th + 22)
        S.paste(im, (x, y + 18))
        d.text((x, y + 3), f"{vp}  {n}", fill=(230, 230, 230))
    S.save(f"{out}/states_{vp}.jpg", quality=80)


with sync_playwright() as pw:
    b = pw.chromium.launch(args=["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"])
    for (w, h, vp, notch, touch) in [(360, 640, "360x640", None, True), (390, 780, "390x780", (47, 0, 34, 0), True), (1280, 720, "desktop", None, False)]:
        # 1. names in the sky + sound + replay column with two finished shapes
        ctx, pg, errs = open_page(b, w, h, "sky&sound&done=strawberry,rose&nopost", notch, touch)
        shot(pg, "01_names_and_controls", vp)
        bar = pg.evaluate("(()=>{const r=(s)=>{const e=document.querySelector(s);if(!e)return null;const b=e.getBoundingClientRect();return {x:b.x,y:b.y,w:b.width,h:b.height,hidden:e.hidden,name:e.getAttribute('aria-label')}};return {mute:r('.mute-button'),music:r('.wl-replay-music'),wishes:r('.wl-replay-wishes'),vw:innerWidth}})()")
        t = (notch or (0, 0, 0, 0))[0]
        right = (notch or (0, 0, 0, 0))[1]
        check(f"{vp}: three controls, each 44x44, in one column, clear of the notch", all(bar[k] and abs(bar[k]["w"] - 44) < 1 and abs(bar[k]["h"] - 44) < 1 for k in ("mute", "music", "wishes")) and abs(bar["mute"]["x"] - bar["music"]["x"]) < 1 and bar["mute"]["y"] >= t + 9 and bar["music"]["y"] > bar["mute"]["y"] + 44 and bar["wishes"]["y"] > bar["music"]["y"] + 44, json.dumps({k: (round(bar[k]["x"]), round(bar[k]["y"])) for k in ("mute", "music", "wishes")}))
        check(f"{vp}: every control has a plain name", all(bar[k]["name"] for k in ("mute", "music", "wishes")), str([bar[k]["name"] for k in ("mute", "music", "wishes")]))
        # tab order: sound, music, wishes, then the scene
        seq = []
        for _ in range(4):
            pg.keyboard.press("Tab")
            seq.append(pg.evaluate("document.activeElement.className || document.activeElement.tagName"))
        check(f"{vp}: tab order is sound, music replay, wishes replay, then the scene", seq[0] == "mute-button" and "wl-replay-music" in seq[1] and "wl-replay-wishes" in seq[2] and seq[3].upper() in ("CANVAS", "BODY"), str(seq))
        ring = pg.evaluate("(()=>{const e=document.querySelector('.wl-replay-wishes');e.focus();e.matches(':focus-visible');return getComputedStyle(e).outlineStyle})()")
        check(f"{vp}: replay button shows a focus ring from the keyboard", ring == "solid", ring)
        # wishes replay: opens each finished shape's card in order, and nothing else
        seen = []
        pg.evaluate("window.__seen=[];const o=new MutationObserver(()=>{const c=window.__sky.card();if(c.open&&window.__seen[window.__seen.length-1]!==c.id)window.__seen.push(c.id)});o.observe(document.body,{subtree:true,childList:true,attributes:true,characterData:true})")
        if touch:
            pg.touchscreen.tap(bar["wishes"]["x"] + 22, bar["wishes"]["y"] + 22)
        else:
            pg.mouse.click(bar["wishes"]["x"] + 22, bar["wishes"]["y"] + 22)
        pg.wait_for_function("window.__sky.card().open", timeout=10000, polling=100)
        pg.wait_for_timeout(800)
        shot(pg, "02_wish_card_replayed", vp)
        live = pg.evaluate("[...document.querySelectorAll('[role=status]')].filter(e=>e.closest('[aria-hidden=true]')===null&&getComputedStyle(e).display!=='none'&&e.getClientRects().length>0||e.id!=='splash'&&e.closest('#splash')===null&&e.textContent.trim()).map(e=>e.textContent.trim()).filter(Boolean)")
        card = pg.evaluate("(()=>{const e=document.getElementById('wish-card');return {label:e.getAttribute('aria-label'),role:e.getAttribute('role'),focus:document.activeElement===e}})()")
        check(f"{vp}: the dialog is named after its constellation", bool(card["label"]) and card["role"] == "dialog" and card["focus"], str(card))
        check(f"{vp}: only one live region speaks when a card opens", len(live) == 1, str(live)[:100])
        pg.keyboard.press("Escape")
        pg.wait_for_timeout(300)
        pg.wait_for_function("window.__sky.card().open", timeout=10000, polling=100)  # the second finished shape's card (queued)
        pg.keyboard.press("Escape")
        pg.wait_for_function("!window.__sky.card().open", timeout=10000, polling=100)
        seen = pg.evaluate("window.__seen")
        want = [n for n in NAMES if n in ("strawberry", "rose")]
        check(f"{vp}: the wishes replay shows each finished wish, in the order of names.json, and only those", seen == want, f"{seen} vs {want}")
        check(f"{vp}: focus goes back to the replay button after the cards", pg.evaluate("document.activeElement.className") == "wl-replay-btn wl-replay-wishes", pg.evaluate("document.activeElement.className"))
        # music replay: un-mutes, no console error
        pg.evaluate("localStorage.setItem('winterlight.muted','1')") if False else None
        pg.click(".mute-button") if not touch else pg.touchscreen.tap(bar["mute"]["x"] + 22, bar["mute"]["y"] + 22)
        pg.wait_for_timeout(300)
        was = pg.evaluate("document.querySelector('.mute-button').getAttribute('aria-pressed')")
        shot(pg, "03_sound_state_a", vp)
        if touch:
            pg.touchscreen.tap(bar["music"]["x"] + 22, bar["music"]["y"] + 22)
        else:
            pg.mouse.click(bar["music"]["x"] + 22, bar["music"]["y"] + 22)
        pg.wait_for_timeout(600)
        after = pg.evaluate("document.querySelector('.mute-button').getAttribute('aria-pressed')")
        check(f"{vp}: the music replay turns the sound on if it was off", after == "false", f"before {was} after {after}")
        check(f"{vp}: no console errors", not errs, "; ".join(errs[:2]))
        ctx.close()

        # 2. nothing finished: only the music button
        ctx, pg, errs = open_page(b, w, h, "sky&sound&fresh&nopost", notch, touch)
        vis = pg.evaluate("[...document.querySelectorAll('.wl-replay-btn')].filter(e=>!e.hidden&&e.getBoundingClientRect().width>0).map(e=>e.className)")
        check(f"{vp}: with nothing finished only the music replay shows (no empty wishes button)", len(vis) == 1 and "music" in vis[0], str(vis))
        shot(pg, "04_nothing_finished", vp)
        ctx.close()

        # 3. a long made-up wish
        ctx, pg, errs = open_page(b, w, h, "sky&done=strawberry&nopost", notch, touch)
        star = pg.evaluate("window.__sky.edges('strawberry')")[0][0]
        p = pg.evaluate(f"window.__sky.screenOf('{star}')")
        pg.touchscreen.tap(p["x"], p["y"]) if touch else pg.mouse.click(p["x"], p["y"])
        pg.wait_for_function("window.__sky.card().open", timeout=20000, polling=200)
        pg.wait_for_timeout(900)
        shot(pg, "05_wish_card", vp)
        pg.evaluate("(t)=>{document.querySelector('#wish-card span').textContent=t}", LONG)
        pg.wait_for_timeout(250)
        shot(pg, "06_long_wish", vp)
        ctx.close()

        # 4. the hint and the owner's line (acts view, nobody touching): hint at about 4 s, the line at about 26 s
        for tag, at in (("07_hint", 4), ("08_owners_line", 26)):
            ctx, pg, errs = open_page(b, w, h, f"acts&at={at}&nopost", notch, touch, wait="window.__acts && window.__acts.state")
            pg.wait_for_timeout(1500)
            m = pg.evaluate("(()=>{const h=document.querySelector('.wl-hint'),l=document.querySelector('.wl-line');const rb=(e)=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,r:r.right,b:r.bottom,o:Number(e.style.opacity||0),t:e.textContent}};return {hint:rb(h),line:rb(l),vw:innerWidth,vh:innerHeight}})()")
            shot(pg, tag, vp)
            sb = (notch or (0, 0, 0, 0))
            e = m["hint"] if at < 20 else m["line"]
            check(f"{vp}: {tag[2:]} is shown, has text, and sits inside the safe area", e["o"] > 0.5 and len(e["t"]) > 0 and e["x"] >= sb[3] and e["r"] <= w - sb[1] + 0.5 and e["b"] <= h - sb[2] + 0.5, f"o={e['o']} x{e['x']:.0f}..{e['r']:.0f} b{e['b']:.0f}")
            check(f"{vp}: {tag[2:]}: no console errors", not errs, "; ".join(errs[:2]))
            ctx.close()

        # 5. the letter reader
        ctx, pg, errs = open_page(b, w, h, "letter&text=" + quote(PARA), notch, touch, wait="window.__letter && window.__letter.isOpen()")
        pg.wait_for_timeout(500)
        shot(pg, "09_letter", vp)
        ctx.close()

        # 6. reduced motion: buttons and hud have no transitions
        ctx, pg, errs = open_page(b, w, h, "sky&sound&done=strawberry&nopost", notch, touch, reduced=True)
        tr = pg.evaluate("[...document.querySelectorAll('.mute-button,.wl-replay-btn,.wl-label')].map(e=>getComputedStyle(e).transitionDuration)")
        check(f"{vp}: reduced motion: buttons and names have no transition", len(tr) >= 3 and all(x in ("0s", "0s, 0s") for x in tr), str(tr))
        check(f"{vp}: reduced motion: no console errors", not errs, "; ".join(errs[:2]))
        shot(pg, "10_reduced_motion", vp)
        ctx.close()
        ctx, pg, errs = open_page(b, w, h, "acts&at=26&nopost&reduced", notch, touch, wait="window.__acts && window.__acts.state")
        tr = pg.evaluate("[...document.querySelectorAll('.wl-hud p')].map(e=>getComputedStyle(e).transitionDuration)")
        check(f"{vp}: reduced motion: the hint and the line have no transition", all(x in ("0s", "0s, 0s") for x in tr), str(tr))
        ctx.close()
        sheet(vp)
    b.close()
srv.terminate()
for f in glob.glob(f"{raw}/*.png"):
    os.remove(f)
os.rmdir(raw)
json.dump([{"name": n, "ok": o, "detail": d} for n, o, d in results], open(f"{out}/ui_states.json", "w"), indent=1)
bad = [r for r in results if not r[1]]
print(f"\n{len(results) - len(bad)} / {len(results)} checks passed")
sys.exit(1 if bad else 0)
