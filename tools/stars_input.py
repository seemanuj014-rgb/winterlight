#!/usr/bin/env python3
"""Phase 21: real input paths into the constellation engine (headless Chromium, software WebGL).

Usage:  npm run build && PORT=<own> python3 tools/stars_input.py <section> [out_dir]
  sections:  touch (finger drags: chain, snap with the finger a little off, wrong star, lift mid-line, a tap)
             mouse (the whole demo shape finished with the mouse, once-only completion; the ordered shape)
             keys  (Tab + Enter picks up and joins, `u` undoes, Escape)
             hint  (8 s of nothing names a line; a touch ends it)
             calls (draw calls at tier low)
Drives `?stars` with CDP touch events, real mouse and real key presses, finds each star with window.__stars.screenOf, and reads window.__stars.state() / .log().
Software GL runs the page at a few fps, so its own clock is slow: we wait for states, never for fixed times. Writes <out_dir>/input_<section>.json.
Trust it for: that the real browser event path reaches the engine and the picture. Do NOT trust it for: how a real thumb feels.
"""
import sys, os, json, time, subprocess, re, math
from playwright.sync_api import sync_playwright

section = sys.argv[1] if len(sys.argv) > 1 else "touch"
out = sys.argv[2] if len(sys.argv) > 2 else "docs/phase21/input"
os.makedirs(out, exist_ok=True)
port = os.environ.get("PORT", "4179")
srv = subprocess.Popen([sys.executable, "-m", "http.server", port, "-d", "dist"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
results = []


def check(name, ok, detail=""):
    results.append((name, bool(ok), detail))
    print(("PASS " if ok else "FAIL ") + name + (("  " + detail) if detail else ""), flush=True)


def open_page(b, touch, query, w=390, h=780, wait_stars=True):
    ctx = b.new_context(viewport={"width": w, "height": h}, has_touch=touch, is_mobile=touch, device_scale_factor=1)
    ctx.add_init_script("window.__vib=[]; navigator.vibrate=function(p){window.__vib.push(Array.isArray(p)?p.slice():[p]);return true;};")
    pg = ctx.new_page()
    errs = []
    pg.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
    pg.on("pageerror", lambda e: errs.append("pageerror: " + str(e)))
    pg.goto(f"http://localhost:{port}/?{query}")
    pg.wait_for_function("getComputedStyle(document.getElementById('splash')).display === 'none'", timeout=120000)
    if wait_stars:
        pg.wait_for_function("window.__stars && window.__stars.state().t > 0.4", timeout=60000, polling=200)
    pg.wait_for_timeout(300)
    return ctx, pg, errs


def S(pg):
    return pg.evaluate("window.__stars.state()")


def L(pg):
    return [e["type"] for e in pg.evaluate("window.__stars.log()")]


def pos(pg, sid):
    return pg.evaluate(f"window.__stars.screenOf('{sid}')")


def wait_state(pg, js, timeout=60000):
    try:
        pg.wait_for_function(f"(() => {{ const s = window.__stars.state(); const log = window.__stars.log().map(e => e.type); return {js}; }})()", timeout=timeout, polling=150)
        return True
    except Exception:
        return False


def touch_fns(ctx, pg):
    cdp = ctx.new_cdp_session(pg)
    return lambda kind, pts: cdp.send("Input.dispatchTouchEvent", {"type": kind, "touchPoints": [{"x": x, "y": y, "id": i} for i, (x, y) in enumerate(pts)]})


def glide(tp, pg, a, b, step=7.0, wait=90):
    """move a finger from point a to point b in small steps (the page's clock is slow, so give every step time to land)"""
    d = math.hypot(b[0] - a[0], b[1] - a[1])
    n = max(1, int(d / step))
    for i in range(1, n + 1):
        tp("touchMove", [(a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n)])
        pg.wait_for_timeout(wait)


def mglide(pg, a, b, step=7.0, wait=60):
    d = math.hypot(b[0] - a[0], b[1] - a[1])
    n = max(1, int(d / step))
    for i in range(1, n + 1):
        pg.mouse.move(a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n)
        pg.wait_for_timeout(wait)


def xy(p):
    return (p["x"], p["y"])


def run_touch(b):
    ctx, pg, errs = open_page(b, True, "stars")
    tp = touch_fns(ctx, pg)
    A, B, C, D, E = (xy(pos(pg, k)) for k in "abcde")
    check("stars are on screen (found by the picker)", all(0 < p[0] < 390 and 0 < p[1] < 780 for p in (A, B, C, D, E)), json.dumps([A, C]))
    # 1. drag a -> b -> c, one touch
    tp("touchStart", [A]); pg.wait_for_timeout(80)
    glide(tp, pg, A, B)
    check("touch drag a to b: the line snaps on", wait_state(pg, "s.drawn.length >= 1"), json.dumps(S(pg)["drawn"]))
    glide(tp, pg, B, C)
    check("the chain goes on from b to c without lifting", wait_state(pg, "s.drawn.length >= 2"), json.dumps(S(pg)["drawn"]))
    # 2. the finger is on the way to e: a half-made line follows it
    glide(tp, pg, C, (C[0] + 30, C[1] - 6))
    st = S(pg)
    check("the line is out and follows the finger", st["dragging"] and st["anchor"] == "c" and st["finger"] is not None, json.dumps({k: st[k] for k in ("dragging", "anchor", "finger")}))
    pg.wait_for_timeout(500)
    pg.screenshot(path=f"{out}/touch_in_progress.png")
    tp("touchEnd", [])
    check("lifting the finger drops the half-made line and keeps the two drawn", wait_state(pg, "!s.dragging && s.anchor === null && s.drawn.length === 2"), json.dumps(S(pg)["drawn"]))
    check("touch: haptics asked for (a tick per joined line)", pg.evaluate("window.__vib.length") >= 2, str(pg.evaluate("window.__vib")[:3]))
    # 3. a second drag from c goes on
    tp("touchStart", [C]); pg.wait_for_timeout(80)
    glide(tp, pg, C, D)
    check("a second drag from c carries on to d", wait_state(pg, "s.drawn.length >= 3"), json.dumps(S(pg)["drawn"]))
    tp("touchEnd", [])
    check("touch: no console errors", not errs, str(errs[:3]))
    ctx.close()

    # a finger that lands a bit off the star, and arrives a bit off the next one
    ctx, pg, errs = open_page(b, True, "stars")
    tp = touch_fns(ctx, pg)
    A, B, C = (xy(pos(pg, k)) for k in "abc")
    tp("touchStart", [(A[0] + 8, A[1] + 8)]); pg.wait_for_timeout(80)
    glide(tp, pg, (A[0] + 8, A[1] + 8), (B[0] + 11, B[1] - 6))
    check("a finger a little off both stars still joins them (generous snap)", wait_state(pg, "s.drawn.length >= 1"), json.dumps(S(pg)["drawn"]))
    tp("touchEnd", [])
    ctx.close()

    # a wrong star: skim over c on the way from a (no line a-c): one soft 'wrong', the drag survives and can still reach b
    ctx, pg, errs = open_page(b, True, "stars")
    tp = touch_fns(ctx, pg)
    A, B, C = (xy(pos(pg, k)) for k in "abc")
    tp("touchStart", [A]); pg.wait_for_timeout(80)
    glide(tp, pg, A, C)
    check("skimming a star with no line to it gives a soft 'wrong', no connect", wait_state(pg, "log.includes('wrong')") and S(pg)["drawn"] == [], str(L(pg)))
    check("...and the finger is still dragging", S(pg)["dragging"])
    glide(tp, pg, C, B)
    check("...and it can still reach the right star afterwards", wait_state(pg, "s.drawn.length >= 1"), json.dumps(S(pg)["drawn"]))
    tp("touchEnd", [])
    check("wrong star: no console errors", not errs, str(errs[:3]))
    ctx.close()

    # taps
    ctx, pg, errs = open_page(b, True, "stars")
    tp = touch_fns(ctx, pg)
    A, B = (xy(pos(pg, k)) for k in "ab")
    tp("touchStart", [A]); pg.wait_for_timeout(60); tp("touchEnd", [])
    check("tap a star: it is picked up", wait_state(pg, "s.anchor === 'a'"), json.dumps(S(pg)["anchor"]))
    tp("touchStart", [B]); pg.wait_for_timeout(60); tp("touchEnd", [])
    check("tap its neighbour: the line is drawn", wait_state(pg, "s.drawn.length === 1"), json.dumps(S(pg)["drawn"]))
    n0 = len(L(pg))
    tp("touchStart", [(30, 700)]); pg.wait_for_timeout(60); tp("touchEnd", [])
    pg.wait_for_timeout(1200)
    check("a tap in empty sky does nothing", len(L(pg)) == n0, str(L(pg)))
    ctx.close()


def run_mouse(b):
    ctx, pg, errs = open_page(b, False, "stars")
    P = {k: xy(pos(pg, k)) for k in "abcdefg"}

    def drag(path):
        pg.mouse.move(*P[path[0]]); pg.mouse.down(); pg.wait_for_timeout(60)
        for a, c in zip(path, path[1:]):
            mglide(pg, P[a], P[c])
        pg.wait_for_timeout(200)
        pg.mouse.up()
        pg.wait_for_timeout(200)

    drag(["a", "b", "c", "d", "a"])
    check("mouse drag round the kite draws four lines", wait_state(pg, "s.drawn.length === 4"), json.dumps(S(pg)["drawn"]))
    pg.screenshot(path=f"{out}/mouse_half.png")
    drag(["c", "e", "f"])
    drag(["e", "g"])
    check("the last line completes the shape", wait_state(pg, "s.complete"), json.dumps({k: S(pg)[k] for k in ("drawn", "complete")}))
    check("it completes exactly once", L(pg).count("complete") == 1, str(L(pg).count("complete")))
    pg.wait_for_timeout(800)
    pg.screenshot(path=f"{out}/mouse_complete.png")
    drag(["a", "b"])
    check("after completion more input changes nothing", len(S(pg)["drawn"]) == 7 and L(pg).count("complete") == 1)
    check("mouse: no console errors", not errs, str(errs[:3]))
    ctx.close()

    ctx, pg, errs = open_page(b, False, "stars=path")
    P = {k: xy(pos(pg, k)) for k in ("p1", "p2", "p3", "p4", "p5")}
    pg.mouse.move(*P["p3"]); pg.mouse.down(); pg.wait_for_timeout(60)
    mglide(pg, P["p3"], P["p4"]); pg.mouse.up(); pg.wait_for_timeout(300)
    check("ordered shape: a line out of order is refused (soft wrong, nothing drawn)", S(pg)["drawn"] == [] and "wrong" in L(pg), str(L(pg)))
    pg.mouse.move(*P["p1"]); pg.mouse.down(); pg.wait_for_timeout(60)
    for a, c in [("p1", "p2"), ("p2", "p3"), ("p3", "p4"), ("p4", "p5")]:
        mglide(pg, P[a], P[c])
    pg.mouse.up()
    check("ordered shape: drawn in order, it completes", wait_state(pg, "s.complete"), json.dumps(S(pg)["drawn"]))
    check("ordered: no console errors", not errs, str(errs[:3]))
    ctx.close()


def ring_shown(pg):
    return pg.evaluate("(() => { const r=[...document.querySelectorAll('div')].find(d=>d.style.borderRadius==='50%' && d.style.position==='fixed'); return !!r && r.style.display==='block'; })()")


def run_keys(b):
    ctx, pg, errs = open_page(b, False, "stars")
    pg.focus("#stage")
    pg.keyboard.press("Tab")
    check("Tab puts the focus ring on a star", wait_state(pg, "true") and ring_shown(pg))
    pg.screenshot(path=f"{out}/keys_ring.png")
    pg.keyboard.press("Enter")
    check("Enter picks the star up", wait_state(pg, "s.anchor === 'a'"), json.dumps(S(pg)["anchor"]))
    pg.keyboard.press("Tab")
    pg.keyboard.press("Enter")
    check("Tab to its neighbour and Enter joins them", wait_state(pg, "s.drawn.length === 1"), json.dumps(S(pg)))
    pg.keyboard.press("u")
    check("u takes the line back", wait_state(pg, "s.drawn.length === 0"), json.dumps(S(pg)["drawn"]))
    pg.keyboard.press("Escape")
    check("keys: no console errors", not errs, str(errs[:3]))
    ctx.close()


def run_hint(b):
    ctx, pg, errs = open_page(b, True, "stars&pre=1")
    ok = wait_state(pg, "s.hint !== null", timeout=170000)
    check("8 s of nothing: a line is named to glow", ok, json.dumps(S(pg)["hint"]))
    h = S(pg)["hint"]
    if h:
        P = xy(pos(pg, h["from"]))
        tp = touch_fns(ctx, pg)
        tp("touchStart", [P]); pg.wait_for_timeout(60); tp("touchEnd", [])
        check("a touch ends the hint", wait_state(pg, "s.hint === null"), json.dumps(S(pg)["hint"]))
    ctx.close()


def run_calls(b):
    def calls(pg):
        m = re.search(r"calls\s+(\d+)", pg.evaluate("document.body.innerText"))
        return int(m.group(1)) if m else None

    ctx, pg, errs = open_page(b, False, "stars&pre=7&debug&tier=low")
    pg.wait_for_timeout(1500)
    c = calls(pg)
    check("draw calls in the sky view at tier low (backdrop + constellation), budget 60", c is not None and c <= 60, f"{c}")
    base = None
    ctx2, pg2, e2 = open_page(b, False, "world&debug&tier=low", wait_stars=False)
    pg2.wait_for_timeout(1000)
    base = calls(pg2)
    check("the constellation adds at most 4 draw calls to the same backdrop", c is not None and base is not None and c - base <= 4, f"stars view {c} vs ?world backdrop alone {base} (the ?world view also draws the ground, so this is a loose bound)")
    check("the engine reports its own cost", pg.evaluate("window.__stars.draws()") <= 3, str(pg.evaluate("window.__stars.draws()")))
    check("calls: no console errors", not errs, str(errs[:3]))
    ctx.close(); ctx2.close()


try:
    with sync_playwright() as p:
        b = p.chromium.launch(args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"])
        {"touch": run_touch, "mouse": run_mouse, "keys": run_keys, "hint": run_hint, "calls": run_calls}[section](b)
        b.close()
finally:
    srv.terminate()
bad = [r for r in results if not r[1]]
json.dump([{"check": n, "pass": ok, "detail": d} for n, ok, d in results], open(f"{out}/input_{section}.json", "w"), indent=1)
print(f"\n{len(results) - len(bad)} / {len(results)} checks pass ({section})")
sys.exit(1 if bad else 0)
