#!/usr/bin/env python3
"""Phase 25: real input paths into the cake (headless Chromium, software WebGL). THE TAP FALLBACK; the microphone is NOT exercised here (see the end of the log).

Usage:  npm run build && PORT=<own> python3 tools/cake_input.py <section> [out_dir]
  sections:  touch  (CDP touch: a tap on a candle puts that one out, a tap on the cake puts out the next lit one, a tap in the dark does nothing, a tap before the wish beat has run is ignored,
                     all five out -> done, act:enter / cake:wish / candle:out x5 / act:done once each, haptics asked for; the microphone was asked for ONCE and, with no device, resolved quietly)
             mouse  (real mouse click on a candle and on the cake)
             keys   (Tab puts the ring on the cake, Enter puts out the next lit candle, five presses = done)
             calls  (draw calls at tier low)
             mic    (FAKE microphone: Chromium's fake-device flags loop a generated WAV. breath = low-passed noise like tests/blow.test.ts, speech = voiced harmonics, silence.
                     Expect breath: flames go out one by one, mic granted and listening during `ready`, closed afterwards; speech and silence: none go out. Proves the browser pipeline
                     (getUserMedia -> AudioContext -> analyser -> detector -> machine), NOT a real microphone, NOT a real breath, NOT iOS.)
Drives `?cake` (its own scripted `&blow` is not used). Headless Chromium has no microphone, so the microphone's state is 'denied' or 'unsupported': that IS the denied path, and the taps must work on it.
Software GL runs the page at a few fps: we wait for states, never for fixed times. Writes <out_dir>/input_<section>.json.
Trust it for: that the real browser event path reaches the machine, the bus and the saved state. NOT for how a real thumb feels, NOT for the microphone, NOT for iOS.
"""
import sys, os, json, time, subprocess, re
from playwright.sync_api import sync_playwright

section = sys.argv[1] if len(sys.argv) > 1 else "touch"
out = sys.argv[2] if len(sys.argv) > 2 else "docs/phase25/input"
os.makedirs(out, exist_ok=True)
port = os.environ.get("PORT", "4185")
srv = subprocess.Popen([sys.executable, "-m", "http.server", port, "-d", "dist"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
results = []


def check(name, ok, detail=""):
    results.append((name, bool(ok), detail))
    print(("PASS " if ok else "FAIL ") + name + (("  " + detail) if detail else ""), flush=True)


def open_page(b, touch, query="cake&nohud", w=390, h=780):
    ctx = b.new_context(viewport={"width": w, "height": h}, has_touch=touch, is_mobile=touch, device_scale_factor=1)
    ctx.add_init_script("window.__vib=[]; navigator.vibrate=function(p){window.__vib.push(Array.isArray(p)?p.slice():[p]);return true;};")
    pg = ctx.new_page()
    errs = []
    pg.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
    pg.on("pageerror", lambda e: errs.append("pageerror: " + str(e)))
    pg.goto(f"http://localhost:{port}/?{query}")
    pg.wait_for_function("getComputedStyle(document.getElementById('splash')).display === 'none'", timeout=120000)
    pg.wait_for_function("window.__cake && window.__cake.t() > 0.4", timeout=60000, polling=200)
    return ctx, pg, errs


def phase(pg):
    return pg.evaluate("window.__cake.phase()")


def lit(pg):
    return pg.evaluate("window.__cake.lit()")


def wait_js(pg, js, timeout=90000):
    try:
        pg.wait_for_function(js, timeout=timeout, polling=150)
        return True
    except Exception:
        return False


def pos(pg, sid):
    p = pg.evaluate(f"window.__cake.screenOf('{sid}')")
    return (p["x"], p["y"]) if p else None


def names(pg):
    return [e["name"] for e in pg.evaluate("window.__cake.busLog()")]


def touch_fns(ctx, pg):
    cdp = ctx.new_cdp_session(pg)
    return lambda kind, pts: cdp.send("Input.dispatchTouchEvent", {"type": kind, "touchPoints": [{"x": x, "y": y, "id": i} for i, (x, y) in enumerate(pts)]})


def tap(tp, pg, p):
    tp("touchStart", [p]); pg.wait_for_timeout(60); tp("touchEnd", []); pg.wait_for_timeout(250)


def bus_checks(pg, tag):
    n = names(pg)
    check(f"{tag}: act:enter once, cake:wish on then off, candle:out five times, act:done once",
          n.count("act:enter") == 1 and n.count("cake:wish") == 2 and n.count("candle:out") == 5 and n.count("act:done") == 1, json.dumps(n))
    wish = [e["data"]["on"] for e in pg.evaluate("window.__cake.busLog()") if e["name"] == "cake:wish"]
    check(f"{tag}: the hush is on first and off second", wish == [True, False], json.dumps(wish))
    left = [e["data"]["left"] for e in pg.evaluate("window.__cake.busLog()") if e["name"] == "candle:out"]
    check(f"{tag}: the flames go out one by one (left 4,3,2,1,0)", left == [4, 3, 2, 1, 0], json.dumps(left))


def run_touch(b):
    ctx, pg, errs = open_page(b, True)
    tp = touch_fns(ctx, pg)
    check("the cake appears and the five candles are on the screen",
          all(pos(pg, f"candle{i}") and 0 < pos(pg, f"candle{i}")[0] < 390 and 0 < pos(pg, f"candle{i}")[1] < 780 for i in range(5)) and pos(pg, "cake") is not None,
          json.dumps([pos(pg, f"candle{i}") for i in range(5)]))
    # (the rule that a tap before the wish beat has run for 1 s is ignored is covered by tests/cake.test.ts; a browser check of it would race the page's own clock)
    check("it reaches the candle moment by itself", wait_js(pg, "window.__cake.phase() === 'ready'"), phase(pg))
    pg.screenshot(path=f"{out}/touch_ready.png")
    st = pg.evaluate("window.__cake.acts()")
    check("the microphone was asked for once the candle moment began and, with no device, resolved quietly (no UI, no error)", st["mic"] in ("denied", "unsupported") and not st["micListening"], json.dumps(st))
    # a tap in the dark does nothing
    tap(tp, pg, (30, 200))
    check("a tap far from the cake does nothing", lit(pg) == 5, str(lit(pg)))
    # a tap on candle 3 puts out candle 3
    tap(tp, pg, pos(pg, "candle3"))
    check("a touch on a candle puts that candle out", wait_js(pg, "window.__cake.lit() === 4") and [e for e in pg.evaluate("window.__cake.log()") if e["type"] == "candle"][0]["candle"] == 3, json.dumps(pg.evaluate("window.__cake.log()")[-2:]))
    # the same candle again does nothing
    tap(tp, pg, pos(pg, "candle3"))
    check("a touch on a candle already out does nothing", lit(pg) == 4, str(lit(pg)))
    pg.screenshot(path=f"{out}/touch_one_out.png")
    # a touch on the cake body puts out the next lit one (the thumb never has to hit a wick)
    tap(tp, pg, pos(pg, "cake"))
    check("a touch on the cake itself puts out the next lit candle", wait_js(pg, "window.__cake.lit() === 3"), str(lit(pg)))
    while lit(pg) > 0:
        n = lit(pg)
        tap(tp, pg, pos(pg, "cake"))
        if not wait_js(pg, f"window.__cake.lit() < {n}", 20000):
            break
    check("all five out", lit(pg) == 0, str(lit(pg)))
    check("then the act is done (once)", wait_js(pg, "window.__cake.acts().done"), json.dumps(pg.evaluate("window.__cake.acts()")))
    bus_checks(pg, "touch")
    check("haptics were asked for (a soft buzz per candle, and the long one at the very end)", pg.evaluate("window.__vib.length") >= 6, json.dumps(pg.evaluate("window.__vib")))
    check("the microphone is not left open", not pg.evaluate("window.__cake.acts().micListening"))
    pg.screenshot(path=f"{out}/touch_done.png")
    check("touch: no console errors", not errs, str(errs[:3]))
    ctx.close()


def run_mouse(b):
    ctx, pg, errs = open_page(b, False, w=1280, h=720)
    check("it reaches the candle moment", wait_js(pg, "window.__cake.phase() === 'ready'"), phase(pg))
    x, y = pos(pg, "candle0")
    pg.mouse.click(x, y)
    check("a click on a candle puts it out", wait_js(pg, "window.__cake.lit() === 4"), str(lit(pg)))
    x, y = pos(pg, "cake")
    pg.mouse.click(x, y)
    check("a click on the cake puts out the next lit one", wait_js(pg, "window.__cake.lit() === 3"), str(lit(pg)))
    pg.mouse.click(5, 5)
    pg.wait_for_timeout(300)
    check("a click in the dark does nothing", lit(pg) == 3, str(lit(pg)))
    pg.screenshot(path=f"{out}/mouse.png")
    check("mouse: no console errors", not errs, str(errs[:3]))
    ctx.close()


def run_keys(b):
    ctx, pg, errs = open_page(b, False)
    check("it reaches the candle moment", wait_js(pg, "window.__cake.phase() === 'ready'"), phase(pg))
    pg.keyboard.press("Tab")
    check("Tab puts the focus on the cake", wait_js(pg, "window.__cake.acts().focus === 'cake'"), json.dumps(pg.evaluate("window.__cake.acts()")))
    pg.wait_for_timeout(400)
    pg.screenshot(path=f"{out}/keys_ring.png")
    for k in range(5):
        pg.keyboard.press("Enter")
        wait_js(pg, f"window.__cake.lit() <= {4 - k}", 20000)
        pg.wait_for_timeout(200)
        if k == 0:
            check("Enter puts out the next lit candle", lit(pg) == 4, str(lit(pg)))
    check("five presses put them all out", lit(pg) == 0, str(lit(pg)))
    check("then the act is done", wait_js(pg, "window.__cake.acts().done"))
    bus_checks(pg, "keys")
    check("keys: no console errors", not errs, str(errs[:3]))
    ctx.close()


def run_calls(b):
    ctx, pg, errs = open_page(b, False, "cake&debug&tier=low&nohud")
    pg.wait_for_timeout(1500)
    m = re.search(r"calls\s+(\d+)", pg.evaluate("document.body.innerText"))
    c = int(m.group(1)) if m else None
    check("draw calls in the cake view at tier low (backdrop + ground + cake), budget 60", c is not None and c <= 60, f"{c}")
    check("calls: no console errors", not errs, str(errs[:3]))
    ctx.close()


FS_WAV = 48000


def make_wavs(d):
    """three looping WAVs (16-bit mono). Every loop starts with 0.8 s of quiet room so the detector's 0.4 s calibration hears the room, not the breath."""
    import numpy as np
    from scipy.signal import lfilter
    import wave
    rng = np.random.default_rng(5)
    room = lambda n: 0.003 * (rng.random(n) * 2 - 1)
    lead, tail = int(0.8 * FS_WAV), int(0.6 * FS_WAV)

    # The recipe of tests/blow.test.ts is built at 16 kHz. Building it at 48 kHz makes the same filter a third as wide, so the white hiss dominates and the sign changes
    # land near 5 kHz (found in session 5: the first WAVs were not a breath to the detector). So: build at 16 kHz, then upsample x3 for the 48 kHz device.
    from scipy.signal import resample_poly
    F0 = 16000
    up = lambda x: resample_poly(x, FS_WAV // F0, 1)

    def breath(sec, level=0.3, hiss=0.12):
        n = int(sec * F0)
        w = rng.random(n) * 2 - 1
        k = 1 - np.exp(-2 * np.pi * 450 / F0)
        c = w
        for _ in range(3):
            c = lfilter([k], [1, -(1 - k)], c)
        t = np.arange(n) / F0
        return up(level * np.minimum(1, t / 0.08) * (c * 5.5 + hiss * w))

    def speech(sec, f0=120, level=0.3):
        n = int(sec * F0)
        t = np.arange(n) / F0
        s = np.zeros(n)
        for h in range(1, 15):
            s += np.sin(2 * np.pi * f0 * h * t) * (1 if 600 < h * f0 < 1200 else 1 / h)
        return up(level * 0.35 * s * (0.55 + 0.45 * np.sin(2 * np.pi * 4 * t)))

    def save(name, body):
        x = np.concatenate([room(lead), body, room(tail)])
        x = np.clip(x, -1, 1)
        path = os.path.join(d, name)
        with wave.open(path, "wb") as f:
            f.setnchannels(1); f.setsampwidth(2); f.setframerate(FS_WAV)
            f.writeframes((x * 32767).astype("<i2").tobytes())
        return path, float(np.abs(x).max()), float(np.sqrt((x ** 2).mean()))

    return {"breath": save("breath.wav", breath(4.0)), "speech": save("speech.wav", speech(4.0)), "silence": save("silence.wav", room(int(4.0 * FS_WAV)))}


def run_mic(_b, pw):
    import tempfile
    d = tempfile.mkdtemp(prefix="cake_wavs_")
    wavs = make_wavs(d)
    for k, (pth, peak, rms) in wavs.items():
        print(f"wav {k}: peak {peak:.3f} rms {rms:.4f}", flush=True)
    for kind in ("breath", "speech", "silence"):
        args = ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--use-fake-ui-for-media-stream",
                "--use-fake-device-for-media-stream", f"--use-file-for-fake-audio-capture={wavs[kind][0]}"]
        if True:
            bb = pw.chromium.launch(args=args)
            ctx, pg, errs = open_page(bb, False)
            check(f"{kind}: it reaches the candle moment", wait_js(pg, "window.__cake.phase() === 'ready'"), phase(pg))
            check(f"{kind}: the microphone was granted and is listening during the candle moment",
                  wait_js(pg, "window.__cake.acts().mic === 'granted' && window.__cake.acts().micListening", 30000), json.dumps(pg.evaluate("window.__cake.acts()")))
            if kind == "breath":
                ok = wait_js(pg, "window.__cake.lit() === 0", 150000)
                check("breath: all five flames go out by breath alone (no tap was made)", ok, f"lit {lit(pg)}")
                check("breath: then the act is done (once)", wait_js(pg, "window.__cake.acts().done"), json.dumps(pg.evaluate("window.__cake.acts()")))
                bus_checks(pg, "breath")
                by = {e["by"] for e in pg.evaluate("window.__cake.log()") if e["type"] == "candle"}
                check("breath: every candle went out by 'blow', none by tap", by == {"blow"}, json.dumps(sorted(by)))
                check("breath: the microphone is closed once the moment is over", wait_js(pg, "!window.__cake.acts().micListening", 20000), json.dumps(pg.evaluate("window.__cake.acts()")))
            else:
                t0 = pg.evaluate("window.__cake.t()")
                # a fixed span of the machine's own clock (software GL runs slowly: wait for machine seconds, not wall time); the loop is 5.4 s, so this covers several loops
                wait_js(pg, f"window.__cake.t() > {t0 + 25}", 240000)
                check(f"{kind}: nothing went out over 25 s of the card's clock (several loops of the file)", lit(pg) == 5 and phase(pg) == "ready", f"lit {lit(pg)} phase {phase(pg)}")
                check(f"{kind}: the microphone was still listening (it was really hearing the file)", pg.evaluate("window.__cake.acts().micListening"), json.dumps(pg.evaluate("window.__cake.acts()")))
                pg.screenshot(path=f"{out}/mic_{kind}.png")
            check(f"{kind}: no console errors", not errs, str(errs[:3]))
            ctx.close()
            bb.close()


try:
    with sync_playwright() as p:
        b = p.chromium.launch(args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"])
        if section == "mic":
            run_mic(b, p)
        else:
            {"touch": run_touch, "mouse": run_mouse, "keys": run_keys, "calls": run_calls}[section](b)
        b.close()
finally:
    srv.terminate()
bad = [r for r in results if not r[1]]
json.dump([{"check": n, "ok": ok, "detail": d} for n, ok, d in results], open(f"{out}/input_{section}.json", "w"), indent=1)
print(f"{len(results) - len(bad)} / {len(results)} checks pass")
sys.exit(1 if bad else 0)
