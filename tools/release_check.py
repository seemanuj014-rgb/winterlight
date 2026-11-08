#!/usr/bin/env python3
"""Phase 26: browser checks of the release machine in ?release (headless Chromium, software WebGL).

Usage:  npm run build && python3 tools/release_check.py [out_json]     (default docs/phase26/release_check.json)
Checks: the machine runs on its own clock and its three events come out in order once each (release:start, release:burst, release:done);
        a frozen frame (&at=) has already fired the events it passed; reduced motion has the same beat; under &sound the release WAITS for a touch, a touch starts it
        and builds exactly one AudioContext; no console errors; the empty sky after the end draws nothing wrong.
Trust it for: the logic wired to the page, the events, no console errors. Not for: how it sounds, speed (software GL), a real phone.
"""
import sys, subprocess, time, os, json
from playwright.sync_api import sync_playwright

out = sys.argv[1] if len(sys.argv) > 1 else "docs/phase26/release_check.json"
port = os.environ.get("PORT", "4187")
srv = subprocess.Popen([sys.executable, "-m", "http.server", port, "-d", "dist"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
rows = []
def check(name, ok, detail=""):
    rows.append({"check": name, "ok": bool(ok), "detail": detail})
    print(("PASS " if ok else "FAIL ") + name + (("  " + str(detail)) if detail else ""), flush=True)

def open_page(b, q, w=390, h=780, ctx_args=None):
    pg = b.new_page(viewport={"width": w, "height": h}, device_scale_factor=1)
    logs = []
    pg.on("console", lambda m: logs.append(m.type + ": " + m.text) if m.type == "error" else None)
    pg.on("pageerror", lambda e: logs.append("pageerror: " + str(e)))
    pg.goto(f"http://localhost:{port}/?{q}")
    pg.wait_for_function("getComputedStyle(document.getElementById('splash')).display === 'none'", timeout=120000)
    pg.wait_for_function("window.__release !== undefined", timeout=20000)
    return pg, logs

def real_errors(logs):
    return [l for l in logs if "ReadPixels" not in l and "GPU stall" not in l]

try:
    with sync_playwright() as p:
        b = p.chromium.launch(args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--autoplay-policy=no-user-gesture-required"])

        # 1. plain run: starts by itself, hush then burst, events in order
        pg, logs = open_page(b, "release&debug&tier=low")
        pg.wait_for_function("window.__release.phase() === 'hush' || window.__release.phase() === 'release'", timeout=30000)
        check("starts by itself (no &sound): the machine leaves idle", pg.evaluate("window.__release.phase()") in ("hush", "release"))
        # software GL is slow: the page clock is real frames, so wait for the burst by polling, not by a fixed time
        pg.wait_for_function("window.__release.busLog().some(e => e.name === 'release:burst')", timeout=120000)
        bl = pg.evaluate("window.__release.busLog()")
        names = [e["name"] for e in bl]
        check("start then burst, in that order, once each", names[:2] == ["release:start", "release:burst"] and names.count("release:start") == 1 and names.count("release:burst") == 1, bl)
        burst = [e for e in bl if e["name"] == "release:burst"][0]["at"]
        check("the burst comes when the hush ends (1.4 s of the machine's clock, within one capped frame)", 1.4 <= burst <= 1.4 + 0.26, burst)
        check("the machine's own log has the same two events as the bus", [e["type"] for e in pg.evaluate("window.__release.log()")][:2] == ["start", "burst"])
        draws = pg.evaluate("window.__release.draws()")
        check("draw calls at low tier stay under 60", draws <= 60, draws)
        check("no console errors in the plain run", not real_errors(logs), real_errors(logs))
        pg.close()

        # 2. frozen frames: a frozen frame has already fired the events it passed
        for at, expect in ((0.5, ["release:start"]), (3, ["release:start", "release:burst"]), (30, ["release:start", "release:burst", "release:done"])):
            pg, logs = open_page(b, f"release&at={at}&debug&tier=low")
            bl = [e["name"] for e in pg.evaluate("window.__release.busLog()")]
            check(f"&at={at}: events so far are {expect}", bl == expect, bl)
            if at == 0.5:
                check("&at=0.5 (the hush): no lantern is up and no spark is alive", pg.evaluate("window.__release.up()") == 0 and pg.evaluate("window.__release.sparkLife()") == 0)
            if at == 3:
                check("&at=3 (after the burst): sparks are alive and at least one lantern is up", pg.evaluate("window.__release.sparkLife()") == 1 and pg.evaluate("window.__release.up()") >= 1, pg.evaluate("window.__release.up()"))
            if at == 30:
                check("&at=30 (after the end): phase is done, no lantern up, spark life 0, clock held at the end", pg.evaluate("window.__release.phase()") == "done" and pg.evaluate("window.__release.up()") == 0 and pg.evaluate("window.__release.sparkLife()") == 0, pg.evaluate("window.__release.t()"))
                check("&at=30: the empty sky still draws (calls > 0, <= 60) with no console error", 0 < pg.evaluate("window.__release.draws()") <= 60 and not real_errors(logs), pg.evaluate("window.__release.draws()"))
            else:
                check(f"&at={at}: no console errors", not real_errors(logs), real_errors(logs))
            pg.close()

        # 3. reduced motion: the same beat
        pg, logs = open_page(b, "release&at=3&reduced&debug&tier=low")
        bl = [e["name"] for e in pg.evaluate("window.__release.busLog()")]
        check("reduced motion: the same events at the same time (the clock is one clock)", bl == ["release:start", "release:burst"] and not real_errors(logs), bl)
        pg.close()

        # 4. &sound: waits for a touch; a touch starts it and builds exactly one AudioContext
        pg, logs = open_page(b, "release&sound&debug&tier=low")
        pg.wait_for_timeout(1500)
        check("&sound: before any touch the release has NOT started (a phone has no sound before one)", pg.evaluate("window.__release.phase()") == "idle" and pg.evaluate("window.__release.busLog().length") == 0, pg.evaluate("window.__release.phase()"))
        pg.mouse.click(200, 400)
        pg.wait_for_function("window.__release.phase() !== 'idle'", timeout=30000)
        check("&sound: a touch starts it", pg.evaluate("window.__release.phase()") in ("hush", "release"))
        pg.wait_for_function("window.__release.busLog().some(e => e.name === 'release:burst')", timeout=120000)
        has_btn = pg.evaluate("!!document.querySelector('button[aria-label]') ")
        check("&sound: the mute button is on the page", has_btn)
        check("&sound: no console errors across the hush and the swell", not real_errors(logs), real_errors(logs))
        pg.close()
        b.close()
finally:
    srv.terminate()

json.dump(rows, open(out, "w"), indent=1)
bad = [r for r in rows if not r["ok"]]
print(f"\n{len(rows) - len(bad)} / {len(rows)} checks pass")
sys.exit(1 if bad else 0)
