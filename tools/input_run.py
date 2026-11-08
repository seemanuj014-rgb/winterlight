#!/usr/bin/env python3
"""Phase 18: synthetic-input run of the `?input` test view in headless Chromium (software WebGL).

Usage:  npm run build && python3 tools/input_run.py [out_dir]

Drives the page with CDP (Input.dispatchTouchEvent for touch, Input.dispatchMouseEvent, real key presses), reads window.__inputLog,
checks what each gesture produced, and takes screenshots at 390x780.
Trust it for: that gestures are classified and aimed right through the real browser event path. Do NOT trust it for: how a real thumb,
a real gyro, a real vibration motor or iOS Safari behave (owner-device gaps).
"""
import sys, os, json, time, subprocess
from playwright.sync_api import sync_playwright

out = sys.argv[1] if len(sys.argv) > 1 else "docs/phase18"
os.makedirs(out, exist_ok=True)
srv = subprocess.Popen([sys.executable, "-m", "http.server", "4173", "-d", "dist"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
results = []

def check(name, ok, detail=""):
    results.append((name, bool(ok), detail))
    print(("PASS " if ok else "FAIL ") + name + ("  " + detail if detail else ""))

INIT = """
window.__vib = [];
navigator.vibrate = function(p){ window.__vib.push(Array.isArray(p)?p.slice():[p]); return true; };
window.__perm = [];
if (new URLSearchParams(location.search).has('ios')) {
  const D = window.DeviceOrientationEvent || function(){};
  D.requestPermission = function(){ window.__perm.push('asked'); return Promise.resolve(window.__permAnswer || 'granted'); };
  window.DeviceOrientationEvent = D;
}
"""

def run():
    with sync_playwright() as p:
        b = p.chromium.launch(args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"])
        ctx = b.new_context(viewport={"width": 390, "height": 780}, has_touch=True, is_mobile=True, device_scale_factor=2)
        ctx.add_init_script(INIT)
        pg = ctx.new_page()
        errs = []
        pg.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
        pg.on("pageerror", lambda e: errs.append("pageerror: " + str(e)))
        pg.goto("http://localhost:4173/?input&debug&tier=low")
        pg.wait_for_function("window.__inputView && window.__inputLog", timeout=20000)
        pg.wait_for_timeout(1500)
        cdp = ctx.new_cdp_session(pg)

        def pos(i):
            return pg.evaluate("(i)=>window.__inputView.screen(i)", i)
        def log():
            return pg.evaluate("window.__inputLog.slice()")
        def clear():
            pg.evaluate("window.__inputLog.length=0")
        def tp(kind, pts):
            cdp.send("Input.dispatchTouchEvent", {"type": kind, "touchPoints": [{"x": x, "y": y, "id": i} for i, (x, y) in enumerate(pts)]})
        def types(l, skip=("focus", "tilt")):
            return [e["type"] for e in l if e["type"] not in skip]
        def targets(l):
            return [e.get("target") for e in l if e["type"] == "press"]

        big, mid, tiny, speck = pos("big"), pos("mid"), pos("tiny"), pos("speck")
        print("ball screen:", {"big": big, "mid": mid, "tiny": tiny, "speck": speck})
        check("balls are on screen", all(v and 0 < v["x"] < 390 and 0 < v["y"] < 780 for v in (big, mid, tiny, speck)))
        check("tiny ball is small (under the 28 px finger radius)", tiny["radiusPx"] < 20, f"radius {tiny['radiusPx']:.1f}px")

        # --- touch tap on the big ball (away from the speck)
        clear()
        x, y = big["x"] + big["radiusPx"] * 0.4, big["y"] + big["radiusPx"] * 0.4
        tp("touchStart", [(x, y)]); pg.wait_for_timeout(80); tp("touchEnd", [])
        pg.wait_for_timeout(150)
        l = log(); check("touch tap = press, tap", types(l) == ["press", "tap"] and targets(l) == ["big"], str(types(l)) + str(targets(l)))

        # --- generous radius: tap 22 px off the tiny ball's middle (its own radius is under 14)
        clear()
        tp("touchStart", [(tiny["x"] + 22, tiny["y"] + 6)]); pg.wait_for_timeout(60); tp("touchEnd", [])
        pg.wait_for_timeout(150)
        l = log(); check("tap 22 px beside the tiny ball still hits it", targets(l) == ["tiny"], str(targets(l)))
        clear()
        tp("touchStart", [(tiny["x"] + 90, tiny["y"] + 6)]); pg.wait_for_timeout(60); tp("touchEnd", [])
        pg.wait_for_timeout(150)
        l = log(); check("tap 90 px away hits nothing", targets(l) == [None] and "tap" in types(l), str(targets(l)))

        # --- priority: the speck sits on the big ball
        clear()
        tp("touchStart", [(speck["x"] + 4, speck["y"] + 3)]); pg.wait_for_timeout(60); tp("touchEnd", [])
        pg.wait_for_timeout(150)
        l = log(); check("speck (priority) wins over the big ball under it", targets(l) == ["speck"], str(targets(l)))

        # --- hold on the big ball
        clear()
        hx, hy = big["x"] + big["radiusPx"] * 0.4, big["y"] - big["radiusPx"] * 0.4
        tp("touchStart", [(hx, hy)]); pg.wait_for_timeout(900)
        hold_seen = "holdstart" in types(log())
        pg.screenshot(path=f"{out}/hold_lit.png")
        tp("touchEnd", []); pg.wait_for_timeout(150)
        l = log(); check("touch hold = press, holdstart (while down), holdend", hold_seen and types(l) == ["press", "holdstart", "holdend"] and l[-1].get("reason") == "release", str(types(l)))
        buzz = pg.evaluate("window.__vib")
        check("a hold asked the phone to buzz (navigator.vibrate called)", len(buzz) >= 1, str(buzz))

        # --- drag the mid ball
        before = pos("mid")
        clear()
        tp("touchStart", [(mid["x"], mid["y"])])
        for i in range(1, 11):
            tp("touchMove", [(mid["x"] - 8 * i, mid["y"] + 6 * i)]); pg.wait_for_timeout(16)
        tp("touchEnd", []); pg.wait_for_timeout(250)
        after = pos("mid"); l = log()
        check("touch drag = press, dragstart, dragend on mid", types(l) == ["press", "dragstart", "dragend"] and targets(l) == ["mid"], str(types(l)))
        check("the dragged ball moved left and down", after["x"] < before["x"] - 30 and after["y"] > before["y"] + 20, f"{before['x']:.0f},{before['y']:.0f} -> {after['x']:.0f},{after['y']:.0f}")
        pg.screenshot(path=f"{out}/after_drag.png")

        # --- two fingers: cancel, and nothing until both are up
        clear()
        tp("touchStart", [(big["x"], big["y"])]); pg.wait_for_timeout(40)
        tp("touchStart", [(big["x"], big["y"]), (big["x"] + 60, big["y"] + 60)]); pg.wait_for_timeout(40)
        tp("touchMove", [(big["x"] + 30, big["y"]), (big["x"] + 90, big["y"] + 60)]); pg.wait_for_timeout(40)
        tp("touchEnd", []); pg.wait_for_timeout(150)
        l = log(); check("two fingers = press, cancel (multi), no tap", types(l) == ["press", "cancel"] and l[-1].get("reason") == "multi", str(types(l)))
        clear()
        tp("touchStart", [(big["x"] + 10, big["y"] + 10)]); pg.wait_for_timeout(50); tp("touchEnd", []); pg.wait_for_timeout(150)
        check("a tap after the pinch works again", types(log()) == ["press", "tap"], str(types(log())))

        # --- touchcancel
        clear()
        tp("touchStart", [(big["x"] + 10, big["y"] + 10)]); pg.wait_for_timeout(50); tp("touchCancel", []); pg.wait_for_timeout(150)
        l = log(); check("touchcancel = press, cancel", types(l) == ["press", "cancel"], str(types(l)))

        # --- mouse
        clear()
        mx, my = big["x"] + 10, big["y"] + 10
        pg.mouse.move(mx, my); pg.mouse.down(); pg.wait_for_timeout(50); pg.mouse.up(); pg.wait_for_timeout(150)
        l = log(); check("mouse click = press, tap (kind mouse)", types(l) == ["press", "tap"] and l[0].get("kind") == "mouse", str(types(l)))
        clear()
        pg.mouse.move(mx, my); pg.mouse.down(); pg.mouse.move(mx + 5, my + 1); pg.mouse.move(mx + 40, my + 4, steps=4); pg.mouse.up(); pg.wait_for_timeout(150)
        l = log(); check("mouse drag = press, dragstart, dragend", types(l) == ["press", "dragstart", "dragend"], str(types(l)))
        # a right click is not a gesture
        clear()
        pg.mouse.click(mx, my, button="right"); pg.wait_for_timeout(150)
        check("right click makes no gesture", types(log()) == [], str(types(log())))

        # --- keyboard
        pg.evaluate("document.querySelector('canvas').focus()")
        clear()
        pg.keyboard.press("Tab"); pg.keyboard.press("Tab")
        f = [e.get("id") for e in log() if e["type"] == "focus"]
        check("Tab moves the focus ring along the balls", len(f) == 2 and f[0] != f[1] and all(f), str(f))
        pg.screenshot(path=f"{out}/focus_ring.png")
        clear()
        pg.keyboard.press("Enter"); pg.wait_for_timeout(150)
        check("Enter = press, tap on the focused ball", types(log()) == ["press", "tap"] and log()[0]["kind"] == "key", str(types(log())))
        clear()
        pg.keyboard.press(" "); pg.wait_for_timeout(150)
        check("Space = press, tap", types(log()) == ["press", "tap"], str(types(log())))
        clear()
        pg.keyboard.down("Enter"); pg.wait_for_timeout(750); held = "holdstart" in types(log()); pg.keyboard.up("Enter"); pg.wait_for_timeout(150)
        check("held Enter = hold", held and types(log()) == ["press", "holdstart", "holdend"], str(types(log())))
        clear()
        pg.keyboard.down("Enter"); pg.keyboard.press("ArrowRight"); pg.keyboard.press("ArrowRight"); pg.keyboard.up("Enter"); pg.wait_for_timeout(150)
        check("Enter + arrows = drag", types(log()) == ["press", "dragstart", "dragend"], str(types(log())))
        clear()
        pg.keyboard.down("Enter"); pg.keyboard.press("Escape"); pg.keyboard.up("Enter"); pg.wait_for_timeout(150)
        check("Escape while held = cancel", types(log()) == ["press", "cancel"], str(types(log())))
        pg.keyboard.press("Escape")
        clear()
        for _ in range(5): pg.keyboard.press("Tab")  # four balls, so the fifth Tab lets go
        left = pg.evaluate("document.activeElement && document.activeElement.tagName")
        check("Tab runs out of balls and focus leaves the canvas (not trapped)", left != "CANVAS", f"active element: {left}")

        # --- blur / hidden cancels a hold
        pg.evaluate("document.querySelector('canvas').focus()")
        clear()
        tp("touchStart", [(hx, hy)]); pg.wait_for_timeout(700)
        pg.evaluate("window.dispatchEvent(new Event('blur'))"); pg.wait_for_timeout(100)
        l = log(); check("losing focus during a hold ends it (holdend, reset)", "holdend" in types(l) and l[-1].get("reason") == "reset", str(types(l)))
        tp("touchEnd", []); pg.wait_for_timeout(100)

        # --- default browser actions are off
        ta = pg.evaluate("getComputedStyle(document.querySelector('canvas')).touchAction")
        check("canvas has touch-action none", ta == "none", ta)
        cm = pg.evaluate("(()=>{const e=new MouseEvent('contextmenu',{cancelable:true,bubbles:true});document.querySelector('canvas').dispatchEvent(e);return e.defaultPrevented})()")
        check("context menu is prevented", cm is True)

        pg.screenshot(path=f"{out}/phone_390x780.png")
        check("no console errors", not errs, str(errs[:3]))
        ctx.close()

        # --- tilt with no sensor (this Chromium offers requestPermission, so it starts at needs-permission and asks when tapped)
        ctxA = b.new_context(viewport={"width": 390, "height": 780}, has_touch=True, is_mobile=True)
        try: ctxA.grant_permissions(["accelerometer", "gyroscope", "magnetometer"])
        except Exception as ex: print("grant_permissions (A):", str(ex)[:80])
        pA = ctxA.new_page(); pA.goto("http://localhost:4173/?input&tier=low")
        pA.wait_for_function("window.__inputView", timeout=20000); pA.wait_for_timeout(500)
        s0 = pA.evaluate("window.__inputView.tiltState()")
        pA.click("#btn-tilt"); pA.wait_for_timeout(2900)
        s1 = pA.evaluate("window.__inputView.tiltState()")
        check("no sensor: needs-permission, then after a tap and 2 s with no reading it settles on 'unsupported' (not stuck 'waiting')", s0 == "needs-permission" and s1 == "unsupported", f"{s0} -> {s1}")
        ctxA.close()

        # --- tilt with readings (CDP device-orientation override)
        ctxB = b.new_context(viewport={"width": 390, "height": 780}, has_touch=True, is_mobile=True)
        try: ctxB.grant_permissions(["accelerometer", "gyroscope", "magnetometer"])
        except Exception as ex: print("grant_permissions (B):", str(ex)[:80])
        pB = ctxB.new_page(); cB = ctxB.new_cdp_session(pB)
        pB.goto("http://localhost:4173/?input&tier=low")
        pB.wait_for_function("window.__inputView", timeout=20000); pB.wait_for_timeout(500)
        try:
            cB.send("DeviceOrientation.setDeviceOrientationOverride", {"alpha": 0, "beta": 40, "gamma": 0})
            pB.click("#btn-tilt"); pB.wait_for_timeout(800)
            st0 = pB.evaluate("window.__inputView.tiltState()")
            cB.send("DeviceOrientation.setDeviceOrientationOverride", {"alpha": 0, "beta": 40, "gamma": 12})
            pB.wait_for_timeout(900)
            par = pB.evaluate("window.__inputView.parallax()")
            st1 = pB.evaluate("window.__inputView.tiltState()")
            check("with readings: state becomes 'on'", st1 == "on", f"{st0} -> {st1}")
            check("a tilt of 12 degrees to one side gives a parallax on x only (sign is UNPROVEN on a real phone)", abs(par["x"]) > 0.3 and abs(par["y"]) < 0.05, str(par))
            cB.send("DeviceOrientation.setDeviceOrientationOverride", {"alpha": 0, "beta": 40, "gamma": -12})
            pB.wait_for_timeout(900)
            par2 = pB.evaluate("window.__inputView.parallax()")
            check("tilting the other way flips the sign", par2["x"] * par["x"] < 0, f"{par['x']:.2f} then {par2['x']:.2f}")
        except Exception as ex:
            check("device orientation override works in this Chromium", False, str(ex)[:120])
        ctxB.close()

        # --- iOS permission path with a stubbed requestPermission
        for answer in ("granted", "denied"):
            ctx2 = b.new_context(viewport={"width": 390, "height": 780}, has_touch=True, is_mobile=True)
            ctx2.add_init_script(INIT + f"window.__permAnswer='{answer}';")
            p2 = ctx2.new_page(); e2 = []
            p2.on("pageerror", lambda e: e2.append(str(e)))
            p2.goto("http://localhost:4173/?input&ios&tier=low")
            p2.wait_for_function("window.__inputView", timeout=20000); p2.wait_for_timeout(800)
            s0 = p2.evaluate("window.__inputView.tiltState()")
            asked0 = p2.evaluate("window.__perm.length")
            p2.click("#btn-tilt"); p2.wait_for_timeout(500)
            s1 = p2.evaluate("window.__inputView.tiltState()"); asked1 = p2.evaluate("window.__perm.length")
            check(f"iOS stub: starts needs-permission and does not ask until tapped ({answer})", s0 == "needs-permission" and asked0 == 0, f"{s0}, asked {asked0}")
            want = "waiting" if answer == "granted" else "denied"
            check(f"iOS stub: after a tap it asks once; answer {answer} -> {want} or on", asked1 == 1 and (s1 in (want, "on", "unsupported") if answer == "granted" else s1 == "denied"), f"{s1}, asked {asked1}")
            check(f"iOS stub: no page errors ({answer})", not e2, str(e2))
            ctx2.close()

        # --- buzz button
        ctx3 = b.new_context(viewport={"width": 390, "height": 780}, has_touch=True, is_mobile=True)
        ctx3.add_init_script(INIT)
        p3 = ctx3.new_page(); p3.goto("http://localhost:4173/?input&tier=low")
        p3.wait_for_function("window.__inputView", timeout=20000); p3.wait_for_timeout(500)
        p3.click("#btn-buzz"); p3.wait_for_timeout(200)
        v = p3.evaluate("window.__vib")
        check("the buzz button calls navigator.vibrate with a short pattern", len(v) == 1 and sum(v[0]) <= 600, str(v))
        for _ in range(30): p3.click("#btn-buzz")
        v2 = p3.evaluate("window.__vib")
        check("a storm of 30 clicks cannot buzz more than the limiter allows", sum(sum(x) for x in v2) <= 1500, f"{len(v2)} buzzes, {sum(sum(x) for x in v2)} ms")
        ctx3.close()

        # --- reduced motion: parallax is exactly 0
        ctx4 = b.new_context(viewport={"width": 390, "height": 780}, reduced_motion="reduce")
        p4 = ctx4.new_page(); p4.goto("http://localhost:4173/?input&reduced&tier=low")
        p4.wait_for_function("window.__inputView", timeout=20000); p4.wait_for_timeout(500)
        p4.mouse.move(380, 100); p4.wait_for_timeout(500)
        par = p4.evaluate("window.__inputView.parallax()")
        check("reduced motion: mouse parallax is exactly 0", par["x"] == 0 and par["y"] == 0, str(par))
        ctx4.close()
        ctx5 = b.new_context(viewport={"width": 1280, "height": 720})
        p5 = ctx5.new_page(); p5.goto("http://localhost:4173/?input&tier=low")
        p5.wait_for_function("window.__inputView", timeout=20000); p5.wait_for_timeout(2800)
        p5.mouse.move(1200, 100); p5.wait_for_timeout(800)
        par = p5.evaluate("window.__inputView.parallax()")
        check("desktop: the mouse gives a small parallax (non-zero, at most 0.35)", 0 < par["x"] <= 0.35, str(par))
        p5.screenshot(path=f"{out}/desktop_1280x720.png")
        ctx5.close()
        b.close()

try:
    run()
finally:
    srv.terminate()
bad = [r for r in results if not r[1]]
print(f"\n{len(results) - len(bad)} / {len(results)} checks passed")
json.dump([{"check": n, "ok": ok, "detail": d} for n, ok, d in results], open(os.path.join(out, "input_run.json"), "w"), indent=1)
sys.exit(1 if bad else 0)
