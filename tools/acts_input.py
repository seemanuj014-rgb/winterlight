#!/usr/bin/env python3
"""Phase 19: real input paths into Act 1 (headless Chromium, software WebGL).

Usage:  npm run build && python3 tools/acts_input.py [out_dir]

Drives `?acts` with CDP touch events, real mouse and real key presses (NOT the scripted &hold= viewer), polls window.__acts.state() / .log(),
and checks that each path wakes Chamgadad and writes the log. Also reads the draw-call count from the `&debug` overlay in the nook and outside (tier low).
Trust it for: that holds, taps, Tab + Space / Enter reach the act through the real browser event path. Software GL runs the page at a few fps, so
the page's own clock runs slow (a frame is never more than 0.1 s long): we wait for states, never for fixed times. Do NOT trust it for: how a real thumb feels.
"""
import sys, os, json, time, subprocess, re
from playwright.sync_api import sync_playwright

out = sys.argv[1] if len(sys.argv) > 1 else "docs/phase19/input"
os.makedirs(out, exist_ok=True)
port = os.environ.get("PORT", "4177")
srv = subprocess.Popen([sys.executable, "-m", "http.server", port, "-d", "dist"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
results = []


def check(name, ok, detail=""):
    results.append((name, bool(ok), detail))
    print(("PASS " if ok else "FAIL ") + name + ("  " + detail if detail else ""))


def open_page(b, touch, query="debug&tier=low", w=390, h=780):
    ctx = b.new_context(viewport={"width": w, "height": h}, has_touch=touch, is_mobile=touch, device_scale_factor=1)
    ctx.add_init_script("window.__vib=[]; navigator.vibrate=function(p){window.__vib.push(Array.isArray(p)?p.slice():[p]);return true;};")
    pg = ctx.new_page()
    errs = []
    pg.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
    pg.on("pageerror", lambda e: errs.append("pageerror: " + str(e)))
    pg.goto(f"http://localhost:{port}/?acts&{query}")
    pg.wait_for_function("getComputedStyle(document.getElementById('splash')).display === 'none'", timeout=120000)
    pg.wait_for_function("window.__acts && window.__acts.state().act", timeout=60000)
    pg.wait_for_timeout(800)
    return ctx, pg, errs


def state(pg):
    return pg.evaluate("window.__acts.state()")


def wait_state(pg, pred_js, timeout=90000):
    try:
        pg.wait_for_function(f"(() => {{ const s = window.__acts.state(); return {pred_js}; }})()", timeout=timeout, polling=250)
        return True
    except Exception:
        return False


def whats(pg):
    return [e["what"] for e in pg.evaluate("window.__acts.log()") if e.get("act") == 1]


def run():
    with sync_playwright() as p:
        b = p.chromium.launch(args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"])

        # ---- 1. touch: one long hold anywhere on the screen
        ctx, pg, errs = open_page(b, True)
        cdp = ctx.new_cdp_session(pg)
        tp = lambda kind, pts: cdp.send("Input.dispatchTouchEvent", {"type": kind, "touchPoints": [{"x": x, "y": y, "id": i} for i, (x, y) in enumerate(pts)]})
        tp("touchStart", [(195, 400)])
        check("touch hold: the light starts to rise", wait_state(pg, "s.progress > 0.2"), json.dumps(state(pg)))
        pg.screenshot(path=f"{out}/touch_hold_rising.png")
        check("touch hold: she wakes while the finger is down", wait_state(pg, "s.phase === 'waking'"), json.dumps(state(pg)))
        tp("touchEnd", [])
        ok = wait_state(pg, "s.phase === 'noticing'")
        check("touch hold: she goes on to notice the finger", ok, json.dumps(state(pg)))
        pg.screenshot(path=f"{out}/touch_noticing.png")
        w = whats(pg)
        check("touch hold: log shows start, press, wake, noticing in order", all(x in w for x in ("start", "press", "wake", "noticing")) and w.index("press") < w.index("wake") < w.index("noticing"), str(w))
        check("touch hold: haptics were asked for", pg.evaluate("window.__vib.length") > 0, str(pg.evaluate("window.__vib")[:4]))
        check("touch hold: the progress is remembered as a secret-free run (no secret)", "secret" not in w)
        check("touch hold: no console errors", not errs, str(errs[:3]))
        ctx.close()

        # ---- 2. touch: six taps
        ctx, pg, errs = open_page(b, True)
        cdp = ctx.new_cdp_session(pg)
        tp = lambda kind, pts: cdp.send("Input.dispatchTouchEvent", {"type": kind, "touchPoints": [{"x": x, "y": y, "id": i} for i, (x, y) in enumerate(pts)]})
        woke = False
        n = 0
        for n in range(1, 16):
            tp("touchStart", [(150, 420)]); pg.wait_for_timeout(60); tp("touchEnd", [])
            pg.wait_for_timeout(350)
            if state(pg).get("phase") != "asleep":
                woke = True
                break
        check("touch taps: she wakes after a handful of taps (each adds 0.17, six should do it; the light also sinks between taps)", woke, f"taps sent {n}; {json.dumps(state(pg))}")
        check("touch taps: no console errors", not errs, str(errs[:3]))
        ctx.close()

        # ---- 3. keyboard: Tab to her, ring shows, hold Space
        ctx, pg, errs = open_page(b, False)
        pg.keyboard.press("Tab")
        pg.wait_for_timeout(1500)
        ring = pg.evaluate("(() => { const r=[...document.querySelectorAll('div')].find(d=>d.style.borderRadius==='50%' && d.style.position==='fixed'); return r ? {display:r.style.display, left:r.style.left, top:r.style.top, w:r.style.width} : null })()")
        check("keyboard: Tab puts the focus ring on her", ring and ring["display"] == "block", str(ring))
        pg.screenshot(path=f"{out}/keyboard_ring.png")
        pg.keyboard.down("Space")
        check("keyboard: holding Space raises the light", wait_state(pg, "s.progress > 0.2"), json.dumps(state(pg)))
        check("keyboard: she wakes", wait_state(pg, "s.phase === 'waking'"), json.dumps(state(pg)))
        pg.keyboard.up("Space")
        w = whats(pg)
        check("keyboard: log shows press then wake", "press" in w and "wake" in w and w.index("press") < w.index("wake"), str(w))
        check("keyboard: no console errors", not errs, str(errs[:3]))
        ctx.close()

        # ---- 4. keyboard with Enter
        ctx, pg, errs = open_page(b, False)
        pg.keyboard.press("Tab"); pg.wait_for_timeout(800)
        pg.keyboard.down("Enter")
        check("keyboard Enter: she wakes", wait_state(pg, "s.phase === 'waking'"), json.dumps(state(pg)))
        pg.keyboard.up("Enter")
        ctx.close()

        # ---- 5. mouse: press and hold
        ctx, pg, errs = open_page(b, False, w=1280, h=720)
        pg.mouse.move(640, 360); pg.mouse.down()
        check("mouse hold: she wakes", wait_state(pg, "s.phase === 'waking'"), json.dumps(state(pg)))
        pg.mouse.up()
        check("mouse hold: no console errors", not errs, str(errs[:3]))
        ctx.close()

        # ---- 6. a quick touch is not a wake: one tap only nudges the light
        ctx, pg, errs = open_page(b, True)
        cdp = ctx.new_cdp_session(pg)
        cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": 150, "y": 420, "id": 0}]}); pg.wait_for_timeout(60)
        cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
        pg.wait_for_timeout(1500)
        s = state(pg)
        check("one tap does not wake her", s.get("phase") == "asleep", json.dumps(s))
        ctx.close()

        # ---- 7. draw calls (tier low, limit 60): nook, then outside after the push-out
        ctx, pg, errs = open_page(b, False, "debug&tier=low&hold=4-8")
        def calls():
            t = pg.evaluate("document.body.innerText")
            m = re.search(r"calls\s+(\d+)", t)
            return int(m.group(1)) if m else None
        pg.wait_for_timeout(1000)
        c_nook = calls()
        check("draw calls in the nook at low tier are under 60", c_nook is not None and c_nook < 60, f"{c_nook}")
        ctx.close()
        ctx, pg, errs = open_page(b, False, "debug&tier=low&hold=4-8&at=36")
        pg.wait_for_timeout(1500)
        c_out = calls()
        s = state(pg)
        check("draw calls outside (after the push-out) at low tier are under 60", s.get("location") == "outside" and c_out is not None and c_out < 60, f"{c_out} at {json.dumps(s)}")
        ctx.close()
        b.close()


try:
    run()
finally:
    srv.terminate()
bad = [r for r in results if not r[1]]
json.dump([{"check": n, "pass": ok, "detail": d} for n, ok, d in results], open(f"{out}/input_run.json", "w"), indent=1)
print(f"\n{len(results) - len(bad)} / {len(results)} checks pass")
sys.exit(1 if bad else 0)
