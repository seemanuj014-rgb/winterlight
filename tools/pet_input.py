#!/usr/bin/env python3
"""Phase 20: real input paths into petting (headless Chromium, software WebGL).

Usage:  npm run build && python3 tools/pet_input.py <section> [out_dir]
  sections:  cat   (touch drag, touch hold, tap, sleeping cat, mouse drag)
             bunny (touch hold near her, touch tap near her)
             keys  (Tab + Enter / arrows on the cat, Tab + Enter on the bunny)
             calls (draw calls at tier low, both views)
Drives `?pet` and `?pet=bunny` with CDP touch events, real mouse and real key presses (NOT the scripted &stroke= viewer), finds the animal on screen with
window.__pet.screenOf, and polls window.__pet.state() / .log(). Each section writes <out_dir>/input_<section>.json.
Software GL runs the page at a few fps, so the page's own clock runs slow (a frame is never more than 0.1 s long): we wait for states, never for fixed times.
Trust it for: that drags, holds, taps, Tab + Enter reach the machines through the real browser event path. Do NOT trust it for: how a real thumb feels.
"""
import sys, os, json, time, subprocess, re, math
from playwright.sync_api import sync_playwright

section = sys.argv[1] if len(sys.argv) > 1 else "cat"
out = sys.argv[2] if len(sys.argv) > 2 else "docs/phase20/input"
os.makedirs(out, exist_ok=True)
port = os.environ.get("PORT", "4178")
srv = subprocess.Popen([sys.executable, "-m", "http.server", port, "-d", "dist"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
results = []


def check(name, ok, detail=""):
    results.append((name, bool(ok), detail))
    print(("PASS " if ok else "FAIL ") + name + (("  " + detail) if detail else ""), flush=True)


def open_page(b, touch, query, w=390, h=780, settle=True):
    ctx = b.new_context(viewport={"width": w, "height": h}, has_touch=touch, is_mobile=touch, device_scale_factor=1)
    ctx.add_init_script("window.__vib=[]; navigator.vibrate=function(p){window.__vib.push(Array.isArray(p)?p.slice():[p]);return true;};")
    pg = ctx.new_page()
    errs = []
    pg.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
    pg.on("pageerror", lambda e: errs.append("pageerror: " + str(e)))
    pg.goto(f"http://localhost:{port}/?{query}")
    pg.wait_for_function("getComputedStyle(document.getElementById('splash')).display === 'none'", timeout=120000)
    pg.wait_for_function("window.__pet && window.__pet.state().t !== undefined", timeout=60000)
    if settle:
        # the opening shot takes 6 s of the page's own time: wait until it has finished so the animals stand still on screen
        pg.wait_for_function("window.__pet.state().t > 7", timeout=120000, polling=250)
    pg.wait_for_timeout(300)
    return ctx, pg, errs


def state(pg):
    return pg.evaluate("window.__pet.state()")


def whats(pg):
    return [e["type"] for e in pg.evaluate("window.__pet.log()")]


def wait_js(pg, pred_js, timeout=90000):
    try:
        pg.wait_for_function(f"(() => {{ const s = window.__pet.state(); const log = window.__pet.log().map(e => e.type); return {pred_js}; }})()", timeout=timeout, polling=250)
        return True
    except Exception:
        return False


def where(pg, who):
    return pg.evaluate(f"window.__pet.screenOf('{who}')")


def ring_shown(pg):
    return pg.evaluate("(() => { const r=[...document.querySelectorAll('div')].find(d=>d.style.borderRadius==='50%' && d.style.position==='fixed'); return !!r && r.style.display==='block'; })()")


def touch_fns(ctx, pg):
    cdp = ctx.new_cdp_session(pg)
    return lambda kind, pts: cdp.send("Input.dispatchTouchEvent", {"type": kind, "touchPoints": [{"x": x, "y": y, "id": i} for i, (x, y) in enumerate(pts)]})


def run_cat(b):
    # ---- 1. touch: drag back and forth over the awake cat
    ctx, pg, errs = open_page(b, True, "pet")
    tp = touch_fns(ctx, pg)
    c = where(pg, "cat")
    check("cat is on screen (found by the picker)", c is not None and 0 < c["x"] < 390 and 0 < c["y"] < 780, json.dumps(c))
    amp = max(18.0, c["radiusPx"] * 0.6)
    tp("touchStart", [(c["x"], c["y"])])
    purr = False
    for i in range(160):
        x = c["x"] + amp * math.sin(i * 0.9)
        tp("touchMove", [(x, c["y"] + 4 * math.sin(i * 0.5))])
        pg.wait_for_timeout(110)
        if state(pg)["cat"]["purring"]:
            purr = True
            break
    check("touch drag over the cat: she starts to purr", purr, json.dumps(state(pg)["cat"]))
    pg.screenshot(path=f"{out}/cat_touch_drag.png")
    for i in range(10):  # keep stroking a moment, then lift
        tp("touchMove", [(c["x"] + amp * math.sin(i), c["y"])]); pg.wait_for_timeout(110)
    tp("touchEnd", [])
    w = whats(pg)
    check("touch drag: the log has purrStart and Chamgadad leaning", "purrStart" in w and "chamLean" in w, str(w))
    check("touch drag: haptics were asked for", pg.evaluate("window.__vib.length") > 0, str(pg.evaluate("window.__vib")[:3]))
    check("touch drag: no console errors", not errs, str(errs[:3]))
    ctx.close()

    # ---- 2. touch: hold a finger still on the cat
    ctx, pg, errs = open_page(b, True, "pet")
    tp = touch_fns(ctx, pg)
    c = where(pg, "cat")
    tp("touchStart", [(c["x"], c["y"])])
    check("touch hold on the cat: she purrs under the hand", wait_js(pg, "s.cat.purring"), json.dumps(state(pg)["cat"]))
    tp("touchEnd", [])
    check("touch hold: no console errors", not errs, str(errs[:3]))
    ctx.close()

    # ---- 3. touch: one tap on the cat is one ear flick, not a purr
    ctx, pg, errs = open_page(b, True, "pet")
    tp = touch_fns(ctx, pg)
    c = where(pg, "cat")
    tp("touchStart", [(c["x"], c["y"])]); pg.wait_for_timeout(60); tp("touchEnd", [])
    check("touch tap on the cat: an ear flick", wait_js(pg, "log.includes('catEar')", 60000), str(whats(pg)))
    check("touch tap on the cat: she does not purr", not state(pg)["cat"]["purring"], json.dumps(state(pg)["cat"]))
    check("touch tap: no console errors", not errs, str(errs[:3]))
    ctx.close()

    # ---- 4. touch: a tap far from her does nothing
    ctx, pg, errs = open_page(b, True, "pet")
    tp = touch_fns(ctx, pg)
    n0 = len(whats(pg))
    tp("touchStart", [(40, 700)]); pg.wait_for_timeout(60); tp("touchEnd", [])
    pg.wait_for_timeout(1500)
    check("touch tap far from the cat: nothing is logged", len(whats(pg)) == n0, str(whats(pg)))
    ctx.close()

    # ---- 5. touch: the sleeping cat wakes under the stroke, then purrs
    ctx, pg, errs = open_page(b, True, "pet&catstate=sleep")
    tp = touch_fns(ctx, pg)
    c = where(pg, "cat")
    check("sleeping cat starts asleep", state(pg)["cat"]["state"] == "sleep", json.dumps(state(pg)["cat"]))
    amp = max(18.0, c["radiusPx"] * 0.6)
    tp("touchStart", [(c["x"], c["y"])])
    woke = purr = False
    for i in range(240):
        tp("touchMove", [(c["x"] + amp * math.sin(i * 0.9), c["y"])]); pg.wait_for_timeout(110)
        s = state(pg)["cat"]
        woke = woke or s["state"] != "sleep"
        if s["purring"]:
            purr = True
            break
    tp("touchEnd", [])
    check("sleeping cat: wakes under the hand", woke, json.dumps(state(pg)["cat"]))
    check("sleeping cat: then purrs", purr, json.dumps(state(pg)["cat"]))
    check("sleeping cat: no console errors", not errs, str(errs[:3]))
    ctx.close()

    # ---- 6. mouse: drag over the cat on a desktop screen
    ctx, pg, errs = open_page(b, False, "pet", w=1280, h=720)
    c = where(pg, "cat")
    pg.mouse.move(c["x"], c["y"]); pg.mouse.down()
    amp = max(24.0, c["radiusPx"] * 0.6)
    purr = False
    for i in range(160):
        pg.mouse.move(c["x"] + amp * math.sin(i * 0.9), c["y"])
        pg.wait_for_timeout(110)
        if state(pg)["cat"]["purring"]:
            purr = True
            break
    pg.screenshot(path=f"{out}/cat_mouse_drag.png")
    pg.mouse.up()
    check("mouse drag over the cat: she purrs", purr, json.dumps(state(pg)["cat"]))
    check("mouse drag: no console errors", not errs, str(errs[:3]))
    ctx.close()


def run_bunny(b):
    # ---- 1. touch: hold a finger on the snow near her
    ctx, pg, errs = open_page(b, True, "pet=bunny")
    tp = touch_fns(ctx, pg)
    bn = where(pg, "bunny")
    check("bunny is on screen (found by the picker)", bn is not None and 0 < bn["x"] < 390 and 0 < bn["y"] < 780, json.dumps(bn))
    before = state(pg)["bunny"]
    hopped = False
    for dx, dy in [(90, 30), (130, 40), (60, 50), (-90, 30)]:
        tp("touchStart", [(bn["x"] + dx, bn["y"] + dy)])
        hopped = wait_js(pg, "log.includes('bunnyHop')", 40000)
        if hopped:
            pg.screenshot(path=f"{out}/bunny_touch_hold.png")
            check("touch hold on the snow near her: she hops toward the finger", True, f"finger offset {dx},{dy}")
            arrived = wait_js(pg, "log.includes('bunnyArrive')", 90000)
            check("touch hold: she arrives at the finger", arrived, json.dumps(state(pg)["bunny"]))
            break
        tp("touchEnd", [])
        pg.wait_for_timeout(500)
    if not hopped:
        check("touch hold on the snow near her: she hops toward the finger", False, json.dumps(state(pg)))
    tp("touchEnd", [])
    after = state(pg)["bunny"]
    check("touch hold: she really moved on the snow", math.hypot(after["x"] - before["x"], after["z"] - before["z"]) > 0.2, f"{before} -> {after}")
    check("touch hold: Chamgadad leaned toward her", "chamLean" in whats(pg), str(whats(pg)))
    check("touch hold: no console errors", not errs, str(errs[:3]))
    ctx.close()

    # ---- 2. touch: a sudden tap on or beside her sends her to hide
    ctx, pg, errs = open_page(b, True, "pet=bunny")
    tp = touch_fns(ctx, pg)
    bn = where(pg, "bunny")
    tp("touchStart", [(bn["x"] + 40, bn["y"] + 25)]); pg.wait_for_timeout(60); tp("touchEnd", [])
    check("touch tap near her: she is startled", wait_js(pg, "log.includes('bunnyStartle')", 60000), str(whats(pg)))
    check("touch tap near her: she hides", wait_js(pg, "log.includes('bunnyHide')", 90000), str(whats(pg)))
    pg.screenshot(path=f"{out}/bunny_touch_tap.png")
    check("touch tap near her: she peeks out again later", wait_js(pg, "log.includes('bunnyPeek')", 120000), str(whats(pg)))
    st = state(pg)["bunny"]
    check("the bunny stays on the snow near her home after the flee", math.hypot(st["x"] + 1.1, st["z"] + 3.4) <= 1.3, json.dumps(st))
    check("touch tap: no console errors", not errs, str(errs[:3]))
    ctx.close()

    # ---- 3. touch: a tap far away from her is not a startle
    ctx, pg, errs = open_page(b, True, "pet=bunny")
    tp = touch_fns(ctx, pg)
    n0 = len(whats(pg))
    tp("touchStart", [(30, 740)]); pg.wait_for_timeout(60); tp("touchEnd", [])
    pg.wait_for_timeout(1500)
    w = whats(pg)[n0:]
    check("touch tap far from her: no startle", "bunnyStartle" not in w, str(w))
    ctx.close()


def run_keys(b):
    # ---- 1. keyboard on the cat: Tab, ring, hold Enter, arrows while held
    ctx, pg, errs = open_page(b, False, "pet")
    pg.keyboard.press("Tab")
    pg.wait_for_timeout(1500)
    check("keyboard cat: Tab puts the focus ring on her", ring_shown(pg))
    pg.screenshot(path=f"{out}/cat_keyboard_ring.png")
    pg.keyboard.down("Enter")
    check("keyboard cat: holding Enter is a hand on her, she purrs", wait_js(pg, "s.cat.purring"), json.dumps(state(pg)["cat"]))
    for k in ["ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight"]:
        pg.keyboard.press(k); pg.wait_for_timeout(200)
    pg.keyboard.up("Enter")
    check("keyboard cat: arrows while held keep her purring", state(pg)["cat"]["affection"] > 0.3, json.dumps(state(pg)["cat"]))
    check("keyboard cat: no console errors", not errs, str(errs[:3]))
    ctx.close()

    # ---- 2. keyboard on the cat: a quick Enter is one ear flick
    ctx, pg, errs = open_page(b, False, "pet")
    pg.keyboard.press("Tab"); pg.wait_for_timeout(800)
    pg.keyboard.down("Enter"); pg.wait_for_timeout(80); pg.keyboard.up("Enter")
    check("keyboard cat: a quick Enter flicks an ear", wait_js(pg, "log.includes('catEar')", 60000), str(whats(pg)))
    ctx.close()

    # ---- 3. keyboard on the bunny: hold Enter holds a hand out, she hops to it
    ctx, pg, errs = open_page(b, False, "pet=bunny")
    pg.keyboard.press("Tab")
    pg.wait_for_timeout(1500)
    check("keyboard bunny: Tab puts the focus ring on her", ring_shown(pg))
    pg.screenshot(path=f"{out}/bunny_keyboard_ring.png")
    pg.keyboard.down("Enter")
    check("keyboard bunny: holding Enter, she hops toward the hand", wait_js(pg, "log.includes('bunnyHop')", 90000), str(whats(pg)))
    pg.keyboard.up("Enter")
    check("keyboard bunny: no console errors", not errs, str(errs[:3]))
    ctx.close()

    # ---- 4. keyboard on the bunny: a quick Enter startles her
    ctx, pg, errs = open_page(b, False, "pet=bunny")
    pg.keyboard.press("Tab"); pg.wait_for_timeout(800)
    pg.keyboard.down("Enter"); pg.wait_for_timeout(80); pg.keyboard.up("Enter")
    check("keyboard bunny: a quick Enter startles her", wait_js(pg, "log.includes('bunnyStartle')", 60000), str(whats(pg)))
    check("keyboard bunny: she hides", wait_js(pg, "log.includes('bunnyHide')", 90000), str(whats(pg)))
    ctx.close()


def run_calls(b):
    def calls(pg):
        t = pg.evaluate("document.body.innerText")
        m = re.search(r"calls\s+(\d+)", t)
        return int(m.group(1)) if m else None

    for label, q, limit in [("the nook (cat view)", "pet&debug&tier=low", 57), ("outside (bunny view)", "pet=bunny&debug&tier=low", 58)]:
        ctx, pg, errs = open_page(b, False, q)
        pg.wait_for_timeout(1500)
        c = calls(pg)
        check(f"draw calls in {label} at low tier are unchanged (at most {limit}, budget 60)", c is not None and c <= limit, f"{c}")
        check(f"{label}: no console errors", not errs, str(errs[:3]))
        ctx.close()


try:
    with sync_playwright() as p:
        b = p.chromium.launch(args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"])
        {"cat": run_cat, "bunny": run_bunny, "keys": run_keys, "calls": run_calls}[section](b)
        b.close()
finally:
    srv.terminate()
bad = [r for r in results if not r[1]]
json.dump([{"check": n, "pass": ok, "detail": d} for n, ok, d in results], open(f"{out}/input_{section}.json", "w"), indent=1)
print(f"\n{len(results) - len(bad)} / {len(results)} checks pass ({section})")
sys.exit(1 if bad else 0)
