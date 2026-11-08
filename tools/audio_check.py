#!/usr/bin/env python3
"""Phase 23 browser check (headless Chromium, software GL). Usage: npm run build && python3 tools/audio_check.py [out_dir]   (default docs/phase23)
Checks, on a 390x780 phone and a 1280x720 desktop:
  - the mute button is on screen, >= 44 px, has aria-label and aria-pressed
  - NO AudioContext exists before the first tap, exactly ONE after it (counted by a wrapper injected before the page runs)
  - a tap on mute flips aria-pressed and survives a reload (localStorage)
  - every ?audio button can be tapped with no console error
  - ?stars&sound and ?sky&sound also show the mute button and make no context before a tap
Proves the wiring. Does NOT prove audible output, loudness, iOS Safari or a phone's silent switch (owner-device gaps).
"""
import sys, os, subprocess, time, json
from playwright.sync_api import sync_playwright

out = sys.argv[1] if len(sys.argv) > 1 else "docs/phase23"
os.makedirs(out, exist_ok=True)
srv = subprocess.Popen([sys.executable, "-m", "http.server", "4175", "-d", "dist"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
URL = "http://localhost:4175/"
COUNT = """
window.__ctxCount = 0;
for (const k of ['AudioContext','webkitAudioContext']) {
  const Orig = window[k]; if (!Orig) continue;
  window[k] = function(...a){ window.__ctxCount++; return new Orig(...a); };
  window[k].prototype = Orig.prototype;
}
"""
results = []
def check(name, ok, detail=""):
    results.append((name, bool(ok), detail)); print(("PASS " if ok else "FAIL ") + name + (("  [" + str(detail) + "]") if detail != "" else ""))

try:
    with sync_playwright() as p:
        b = p.chromium.launch(args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--autoplay-policy=document-user-activation-required"])
        for label, (w, h) in {"phone": (390, 780), "desktop": (1280, 720)}.items():
            ctx = b.new_context(viewport={"width": w, "height": h}, has_touch=(label == "phone"), device_scale_factor=2 if label == "phone" else 1)
            ctx.add_init_script(COUNT)
            pg = ctx.new_page()
            errs = []
            pg.on("console", lambda m: errs.append(m.text) if m.type == "error" else None)
            pg.on("pageerror", lambda e: errs.append("pageerror: " + str(e)))
            pg.goto(URL + "?audio")
            pg.wait_for_function("window.__audio !== undefined", timeout=10000)
            pg.wait_for_timeout(500)
            btn = pg.locator("button.mute-button")
            box = btn.bounding_box()
            check(f"{label}: mute button on screen", box and 0 <= box["x"] and box["x"] + box["width"] <= w and 0 <= box["y"] < h, box)
            check(f"{label}: mute button >= 44 px", box and box["width"] >= 44 and box["height"] >= 44, box and (box["width"], box["height"]))
            check(f"{label}: aria-label and aria-pressed", bool(btn.get_attribute("aria-label")) and btn.get_attribute("aria-pressed") in ("true", "false"), (btn.get_attribute("aria-label"), btn.get_attribute("aria-pressed")))
            check(f"{label}: no AudioContext before the first tap", pg.evaluate("window.__ctxCount") == 0, pg.evaluate("window.__audio.state()"))
            pg.screenshot(path=f"{out}/audio_view_{label}_before_tap.png")
            # first tap anywhere (not on a sound button): empty area of the page
            first = pg.locator("button", has_text="line joined").first
            (first.tap() if label == "phone" else first.click())
            pg.wait_for_timeout(600)
            check(f"{label}: exactly one AudioContext after the first tap", pg.evaluate("window.__ctxCount") == 1, pg.evaluate("[window.__ctxCount, window.__audio.state()]"))
            # every button, tapped
            n = pg.locator("button:visible:not(.mute-button)").count()
            for i in range(n):
                bt = pg.locator("button:visible:not(.mute-button)").nth(i)
                (bt.tap() if label == "phone" else bt.click())
                pg.wait_for_timeout(60)
            pg.wait_for_timeout(300)
            check(f"{label}: all {n} ?audio buttons tapped, no console error, still one context", not errs and pg.evaluate("window.__ctxCount") == 1, errs[:3])
            # stop the music box so it does not run past the test
            pg.screenshot(path=f"{out}/audio_view_{label}.png")
            # mute flips and persists
            before = btn.get_attribute("aria-pressed")
            (btn.tap() if label == "phone" else btn.click())
            pg.wait_for_timeout(300)
            after = btn.get_attribute("aria-pressed")
            check(f"{label}: tap on mute flips aria-pressed", before != after and pg.evaluate("window.__audio.muted()") == (after == "true"), (before, after))
            pg.reload()
            pg.wait_for_function("window.__audio !== undefined", timeout=10000)
            pg.wait_for_timeout(300)
            check(f"{label}: mute state survives a reload", pg.locator("button.mute-button").get_attribute("aria-pressed") == after and pg.evaluate("window.__ctxCount") == 0, pg.locator("button.mute-button").get_attribute("aria-pressed"))
            # unmute again so later pages start clean
            (pg.locator("button.mute-button").tap() if label == "phone" else pg.locator("button.mute-button").click())
            pg.wait_for_timeout(200)
            pg.screenshot(path=f"{out}/audio_view_{label}_after_reload.png")
            # older views with &sound
            for q in ("?stars&sound", "?sky&sound"):
                e2 = []
                p2 = ctx.new_page()
                p2.on("console", lambda m, e2=e2: e2.append(m.text) if m.type == "error" else None)
                p2.on("pageerror", lambda e, e2=e2: e2.append(str(e)))
                p2.goto(URL + q)
                p2.wait_for_timeout(2500)
                bx = p2.locator("button.mute-button").bounding_box()
                check(f"{label}: {q} shows the mute button, no context before a tap, no errors", bx and bx["width"] >= 44 and p2.evaluate("window.__ctxCount") == 0 and not e2, (bx and bx["width"], e2[:2]))
                if label == "phone": p2.screenshot(path=f"{out}/audio_{q[1:].split(chr(38))[0]}_sound_phone.png")
                p2.close()
            # without &sound there must be no mute button (older tools unchanged)
            p3 = ctx.new_page()
            p3.goto(URL + "?stars")
            p3.wait_for_timeout(1500)
            check(f"{label}: ?stars without &sound has no mute button and no context", p3.locator("button.mute-button").count() == 0 and p3.evaluate("window.__ctxCount") == 0)
            p3.close()
            ctx.close()
        b.close()
finally:
    srv.terminate()

bad = [r for r in results if not r[1]]
print(f"\n{len(results) - len(bad)} / {len(results)} passed")
json.dump([dict(name=n, ok=o, detail=str(d)) for n, o, d in results], open(os.path.join(out, "audio_check.json"), "w"), indent=1)
sys.exit(1 if bad else 0)
