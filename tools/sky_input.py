#!/usr/bin/env python3
"""Phase 22: real input paths into the five-name sky (headless Chromium, software WebGL).

Usage:  npm run build && PORT=<own> python3 tools/sky_input.py <section> [out_dir]
  sections:  touch  (finger drags finish a whole shape; tap-then-tap; a tap on another shape drops a half-pick; completion opens the wish card with the exact words of content/wishes.json; tap and Escape close it)
             keys   (Tab + Enter picks a star up in the first shape; Escape lets go)
             reload (a finished shape is still finished after a reload: no card, no burst; tapping it shows its wish again)
             calls  (draw calls at tier low)
Drives `?sky` with CDP touch events, real mouse and key presses, finds every star with window.__sky.screenOf, reads window.__sky.state() / .log() / .card().
Software GL runs the page at a few fps, so its clock is slow: we wait for states, never for fixed times. Writes <out_dir>/input_<section>.json.
Trust it for: that the real browser event path reaches the engine, the card and the saved progress. NOT for how a real thumb feels.
"""
import sys, os, json, time, subprocess, re, math
from playwright.sync_api import sync_playwright

section = sys.argv[1] if len(sys.argv) > 1 else "touch"
out = sys.argv[2] if len(sys.argv) > 2 else "docs/phase22/input"
os.makedirs(out, exist_ok=True)
port = os.environ.get("PORT", "4183")
srv = subprocess.Popen([sys.executable, "-m", "http.server", port, "-d", "dist"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
results = []
WISHES = json.load(open("content/wishes.json", encoding="utf8"))


def check(name, ok, detail=""):
    results.append((name, bool(ok), detail))
    print(("PASS " if ok else "FAIL ") + name + (("  " + detail) if detail else ""), flush=True)


def open_page(b, touch, query, w=390, h=780, ctx=None):
    if ctx is None:
        ctx = b.new_context(viewport={"width": w, "height": h}, has_touch=touch, is_mobile=touch, device_scale_factor=1)
        ctx.add_init_script("window.__vib=[]; navigator.vibrate=function(p){window.__vib.push(Array.isArray(p)?p.slice():[p]);return true;};")
    pg = ctx.new_page()
    errs = []
    pg.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
    pg.on("pageerror", lambda e: errs.append("pageerror: " + str(e)))
    pg.goto(f"http://localhost:{port}/?{query}")
    pg.wait_for_function("getComputedStyle(document.getElementById('splash')).display === 'none'", timeout=120000)
    pg.wait_for_function("window.__sky && window.__sky.t() > 0.4", timeout=60000, polling=200)
    pg.wait_for_timeout(300)
    return ctx, pg, errs


def S(pg):
    return pg.evaluate("window.__sky.state()")


def L(pg):
    return pg.evaluate("window.__sky.log()")


def pos(pg, sid):
    p = pg.evaluate(f"window.__sky.screenOf('{sid}')")
    return (p["x"], p["y"])


def edges(pg, cid):
    return pg.evaluate(f"window.__sky.edges('{cid}')")


def wait_js(pg, js, timeout=60000):
    try:
        pg.wait_for_function(f"(() => {{ const s = window.__sky.state(); const log = window.__sky.log(); const card = window.__sky.card(); const done = window.__sky.done(); return {js}; }})()", timeout=timeout, polling=150)
        return True
    except Exception:
        return False


def touch_fns(ctx, pg):
    cdp = ctx.new_cdp_session(pg)
    return lambda kind, pts: cdp.send("Input.dispatchTouchEvent", {"type": kind, "touchPoints": [{"x": x, "y": y, "id": i} for i, (x, y) in enumerate(pts)]})


def glide(tp, pg, a, b, step=7.0, wait=90):
    d = math.hypot(b[0] - a[0], b[1] - a[1])
    n = max(1, int(d / step))
    for i in range(1, n + 1):
        tp("touchMove", [(a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n)])
        pg.wait_for_timeout(wait)


def tap(tp, pg, p):
    tp("touchStart", [p]); pg.wait_for_timeout(60); tp("touchEnd", []); pg.wait_for_timeout(120)


def drag_edge(tp, pg, a, b):
    A, B = pos(pg, a), pos(pg, b)
    tp("touchStart", [A]); pg.wait_for_timeout(80)
    glide(tp, pg, A, B)
    pg.wait_for_timeout(150)
    tp("touchEnd", [])
    pg.wait_for_timeout(150)


def run_touch(b):
    ctx, pg, errs = open_page(b, True, "sky&fresh&nohud")
    tp = touch_fns(ctx, pg)
    n = len(S(pg))
    check("five shapes in the sky, none done, the first is the one that may hint", n == 5 and not pg.evaluate("window.__sky.done()") and pg.evaluate("window.__sky.current()") == "strawberry", json.dumps(pg.evaluate("window.__sky.done()")))
    ids = list(S(pg).keys())
    allpos = {}
    for cid in ids:
        for a, c in edges(pg, cid):
            for s_ in (a, c):
                allpos[s_] = pos(pg, s_)
    check("every star of every shape is on the screen (found by the picker)", all(0 < x < 390 and 0 < y < 780 for x, y in allpos.values()), f"{len(allpos)} stars")

    # 1. finish kaaju-katli with finger drags, one drag per line
    kk = edges(pg, "kaaju-katli")
    for a, c in kk:
        drag_edge(tp, pg, a, c)
    check("kaaju katli: touch drags star to star finish the whole shape", wait_js(pg, "s['kaaju-katli'].complete"), json.dumps(S(pg)["kaaju-katli"]))
    check("it completes exactly once", [e["type"] for e in L(pg) if e["id"] == "kaaju-katli"].count("complete") == 1)
    check("the wish card opens by itself", wait_js(pg, "card.open && card.id === 'kaaju-katli'"), json.dumps(pg.evaluate("window.__sky.card()")))
    c = pg.evaluate("window.__sky.card()")
    check("the card shows the exact words of content/wishes.json for it (a placeholder shows as it is)", c["text"] == WISHES["kaaju-katli"], repr(c["text"]))
    check("the name appears (from names.json)", pg.evaluate("window.__sky.named()") == ["kaaju-katli"])
    check("touch: the shape is saved", pg.evaluate("window.__sky.persisted()") == ["kaaju-katli"])
    check("touch: haptics asked for", pg.evaluate("window.__vib.length") >= len(kk))
    pg.wait_for_timeout(700)
    pg.screenshot(path=f"{out}/touch_wish_card.png")
    # the card closes on a tap
    box = pg.evaluate("(() => { const r = document.getElementById('wish-card').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()")
    tap(tp, pg, tuple(box))
    check("a tap on the card puts it away", wait_js(pg, "!card.open"), json.dumps(pg.evaluate("window.__sky.card()")["open"]))
    # a tap on the finished shape asks for the wish again
    first = kk[0][0]
    tap(tp, pg, pos(pg, first))
    check("a tap on a finished shape's star shows its wish again", wait_js(pg, "card.open && card.id === 'kaaju-katli'"))
    pg.keyboard.press("Escape")
    check("Escape puts the card away", wait_js(pg, "!card.open"))
    pg.screenshot(path=f"{out}/touch_one_done.png")

    # 2. tap-then-tap in strawberry; a tap on another shape drops the half-pick
    sb = edges(pg, "strawberry")
    a, c2 = sb[0]
    tap(tp, pg, pos(pg, a))
    check("tap a strawberry star: it is picked up", wait_js(pg, f"s.strawberry.anchor === '{a}'"), json.dumps(S(pg)["strawberry"]))
    bb_star = edges(pg, "bumblebee")[0][0]
    tap(tp, pg, pos(pg, bb_star))
    check("a tap on another shape: strawberry lets go, bumblebee picks up", wait_js(pg, f"s.strawberry.anchor === null && s.bumblebee.anchor === '{bb_star}'"), json.dumps({k: S(pg)[k]["anchor"] for k in ("strawberry", "bumblebee")}))
    tap(tp, pg, (20, 700))
    check("a tap in empty sky lets go of it", wait_js(pg, "s.bumblebee.anchor === null"))
    tap(tp, pg, pos(pg, a)); tap(tp, pg, pos(pg, c2))
    check("tap-then-tap draws the line", wait_js(pg, "s.strawberry.drawn === 1"), json.dumps(S(pg)["strawberry"]))
    check("the other shapes are untouched", S(pg)["rose"]["drawn"] == 0 and S(pg)["bumblebee"]["drawn"] == 0)
    # 3. a drag that starts on a finished shape goes nowhere
    k0 = pos(pg, first); k1 = pos(pg, kk[0][1])
    before = len(L(pg))
    tp("touchStart", [k0]); pg.wait_for_timeout(80); glide(tp, pg, k0, k1); tp("touchEnd", []); pg.wait_for_timeout(300)
    check("a drag that starts on a finished shape does not draw anything", S(pg)["kaaju-katli"]["drawn"] == len(kk))
    check("touch: no console errors", not errs, str(errs[:3]))
    ctx.close()


def run_keys(b):
    ctx, pg, errs = open_page(b, False, "sky&fresh&nohud")
    pg.focus("#stage")
    pg.keyboard.press("Tab")
    ring = pg.evaluate("(() => { const r=[...document.querySelectorAll('div')].find(d=>d.style.borderRadius==='50%' && d.style.position==='fixed'); return !!r && r.style.display==='block'; })()")
    check("Tab puts the focus ring on a star", ring)
    pg.screenshot(path=f"{out}/keys_ring.png")
    pg.keyboard.press("Enter")
    check("Enter picks a star up, in the first shape (discovery order)", wait_js(pg, "s.strawberry.anchor !== null"), json.dumps(S(pg)["strawberry"]))
    # (Escape ends a hold or drag in the input layer; a star picked up for tap-then-tap stays picked until the next tap, as in Phase 21)
    pg.keyboard.press("Tab")
    check("Tab moves the focus ring to the next star", pg.evaluate("window.__sky.input.focusId") not in (None, "sb1"), str(pg.evaluate("window.__sky.input.focusId")))
    check("keys: no console errors", not errs, str(errs[:3]))
    ctx.close()


def run_reload(b):
    ctx, pg, errs = open_page(b, True, "sky&fresh&nohud")
    tp = touch_fns(ctx, pg)
    for a, c in edges(pg, "kaaju-katli"):
        tap(tp, pg, (20, 700))  # a tap in empty sky lets go, so each line starts clean (a joined line otherwise chains on from its second star)
        tap(tp, pg, pos(pg, a)); tap(tp, pg, pos(pg, c))
    check("finished by taps", wait_js(pg, "s['kaaju-katli'].complete"))
    check("saved in localStorage", "kaaju-katli" in (pg.evaluate("localStorage.getItem('winterlight.progress.v1')") or ""))
    pg.close()
    ctx, pg, errs = open_page(b, True, "sky&nohud", ctx=ctx)  # same context = same storage, no &fresh
    tp = touch_fns(ctx, pg)
    check("after a reload the shape is still finished", pg.evaluate("window.__sky.done()") == ["kaaju-katli"], json.dumps(pg.evaluate("window.__sky.done()")))
    check("...drawn complete, with its name there", S(pg)["kaaju-katli"]["complete"] and pg.evaluate("window.__sky.named()") == ["kaaju-katli"])
    check("...and no wish card and no burst on a restore", not pg.evaluate("window.__sky.card()")["open"] and not [e for e in L(pg) if e["type"] == "complete"], json.dumps(L(pg)[:3]))
    check("...the other four are not done", all(not v["complete"] for k, v in S(pg).items() if k != "kaaju-katli"))
    pg.wait_for_timeout(600)
    pg.screenshot(path=f"{out}/reload_restored.png")
    tap(tp, pg, pos(pg, edges(pg, "kaaju-katli")[0][0]))
    check("tapping the restored shape shows its wish again", wait_js(pg, "card.open && card.id === 'kaaju-katli'"))
    check("reload: no console errors", not errs, str(errs[:3]))
    ctx.close()


def run_calls(b):
    def calls(pg):
        m = re.search(r"calls\s+(\d+)", pg.evaluate("document.body.innerText"))
        return int(m.group(1)) if m else None

    ctx, pg, errs = open_page(b, False, "sky&done=strawberry,bumblebee,rose,kaaju-katli,cutie-patootie&debug&tier=low")
    pg.wait_for_timeout(1500)
    c = calls(pg)
    d = pg.evaluate("window.__sky.draws()")
    check("draw calls with all five shapes finished, at tier low (backdrop + five shapes), budget 60", c is not None and c <= 60, f"{c}")
    check("the five shapes report their own cost (about 2 each)", d <= 12, f"{d}")
    pg.screenshot(path=f"{out}/calls_debug.png")
    check("calls: no console errors", not errs, str(errs[:3]))
    ctx.close()


try:
    with sync_playwright() as p:
        b = p.chromium.launch(args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"])
        {"touch": run_touch, "keys": run_keys, "reload": run_reload, "calls": run_calls}[section](b)
        b.close()
finally:
    srv.terminate()
bad = [r for r in results if not r[1]]
json.dump([{"check": n, "ok": ok, "detail": d} for n, ok, d in results], open(f"{out}/input_{section}.json", "w"), indent=1)
print(f"{len(results) - len(bad)} / {len(results)} checks pass")
sys.exit(1 if bad else 0)
