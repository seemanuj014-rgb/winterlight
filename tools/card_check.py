#!/usr/bin/env python3
"""Phase 28 (session 13): (1) keyboard petting in ?stay (the B key), (2) the whole card chain in ?card (reduced motion, software WebGL):
sky handed over (from the sky: five names done) -> cake -> release -> envelope/letter -> finale -> stay a while -> the ending exit plays the finale again and comes back.
Usage: npm run build && python3 tools/card_check.py [out_dir]"""
import sys, subprocess, time, os
from playwright.sync_api import sync_playwright

out = sys.argv[1] if len(sys.argv) > 1 else "docs/phase28/card"
os.makedirs(out, exist_ok=True)
port = os.environ.get("PORT", "4193")
srv = subprocess.Popen([sys.executable, "-m", "http.server", port, "-d", "dist"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
res = []
def check(name, ok, extra=""):
    res.append(bool(ok)); print(("PASS " if ok else "FAIL ") + name + (" :: " + str(extra)[:200] if extra != "" else ""), flush=True)
def real(logs): return [l for l in logs if "ReadPixels" not in l and "GPU stall" not in l]
ARGS = ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"]
def page(b, w, h, q):
    ctx = b.new_context(viewport={"width": w, "height": h}, device_scale_factor=1)
    pg = ctx.new_page(); logs = []
    pg.on("console", lambda m: logs.append(m.type + ": " + m.text) if m.type == "error" else None)
    pg.on("pageerror", lambda e: logs.append("pageerror: " + str(e)))
    pg.goto(f"http://localhost:{port}/?{q}")
    pg.wait_for_function("getComputedStyle(document.getElementById('splash')).display === 'none'", timeout=120000)
    return pg, logs

try:
    with sync_playwright() as p:
        b = p.chromium.launch(args=ARGS)
        # ---- 1. keyboard pet
        for (w, h, rd) in ([] if os.environ.get('ONLY3') else [(390, 780, False), (1280, 720, True)]):
            tag = f"{w}x{h}" + ("-reduced" if rd else "")
            pg, logs = page(b, w, h, "stay&at=8&nopost&tier=low" + ("&reduced" if rd else ""))
            pg.wait_for_function("window.__stay && window.__stay.cast().ready", timeout=60000)
            pg.wait_for_timeout(1200)
            pan0 = pg.evaluate("window.__stay.pan()")
            pg.keyboard.down("b"); pg.wait_for_timeout(120)
            check(f"[{tag}] B down: she is being petted (activity pet, pressing)", pg.evaluate("window.__stay.activity()") == "pet" and pg.evaluate("window.__stay.pet().pressing"), pg.evaluate("window.__stay.activity()"))
            pg.keyboard.up("b"); pg.wait_for_timeout(1200)
            st = pg.evaluate("window.__stay.pet()")
            check(f"[{tag}] a quick B is a tap: she reacts (not idle at once) and the activity is back", pg.evaluate("window.__stay.activity()") == "wander" and st["mode"] != "idle", st)
            pg.wait_for_timeout(6000)
            pg.keyboard.down("b"); pg.wait_for_timeout(5000)
            st = pg.evaluate("window.__stay.pet()")
            pg.keyboard.up("b"); pg.wait_for_timeout(300)
            check(f"[{tag}] B held: still pressing, she answers (hop seen or a mode other than idle)", st["pressing"] and (st["hopsSeen"] > 0 or st["mode"] != "idle" or rd), st)
            check(f"[{tag}] B never turned the view", pg.evaluate("window.__stay.pan()") == pan0)
            check(f"[{tag}] both exits still on offer", pg.evaluate("window.__stay.exits()") == ["letter", "replay"], pg.evaluate("window.__stay.exits()"))
            # focus on a control: B is not ours
            pg.wait_for_timeout(4000)
            pg.locator(".wl-replay-finale:visible").first.focus()
            pg.keyboard.down("b"); pg.wait_for_timeout(100)
            check(f"[{tag}] B with a button focused does nothing", not pg.evaluate("window.__stay.pet().pressing"))
            pg.keyboard.up("b")
            check(f"[{tag}] console clean", not real(logs), real(logs)[:2])
            pg.context.close()
        # ---- 2. the chain
        w, h = 390, 780
        pg, logs = page(b, w, h, "card&from=cake&nopost&tier=low&reduced&debug")
        seen = []
        def stage(): return pg.evaluate("window.__card.stage()")
        def wait_stage(s, secs):
            t0 = time.time()
            while time.time() - t0 < secs:
                if stage() == s: return True
                if stage() == "cake": pg.evaluate("window.__cake && window.__cake.machine.tap(null)")
                pg.wait_for_timeout(400)
            return False
        check("card starts at cake with &from=cake", stage() == "cake", stage())
        pg.wait_for_timeout(1500); pg.screenshot(path=f"{out}/1_cake.png")
        ok = wait_stage("release", 90); check("cake done (candles out) -> release", ok, stage())
        pg.wait_for_timeout(2500); pg.screenshot(path=f"{out}/2_release.png")
        ok = wait_stage("envelope", 120); check("release done -> envelope", ok, stage())
        pg.wait_for_function("window.__envelope && window.__envelope.state().phase === 'waiting'", timeout=90000)
        pg.screenshot(path=f"{out}/3_envelope.png")
        check("nothing moved on by itself while the envelope waits", (pg.wait_for_timeout(2500) or True) and stage() == "envelope")
        pg.evaluate("window.__envelope.open()")
        pg.wait_for_function("window.__envelope.isReaderOpen()", timeout=60000)
        pg.screenshot(path=f"{out}/4_reader.png")
        check("the reader is open and the card stays on the letter", stage() == "envelope")
        pg.keyboard.press("Escape")
        ok = wait_stage("finale", 30); check("letter put away -> finale", ok, stage())
        pg.wait_for_timeout(2000); pg.screenshot(path=f"{out}/5_finale.png")
        ok = wait_stage("stay", 60); check("finale done -> stay a while", ok, stage())
        pg.wait_for_function("window.__stay !== undefined", timeout=30000); pg.wait_for_timeout(1500)
        pg.screenshot(path=f"{out}/6_stay.png")
        check("stay: both exits on offer", pg.evaluate("window.__stay.exits()") == ["letter", "replay"], pg.evaluate("window.__stay.exits()"))
        pg.locator(".wl-replay-finale:visible").first.click()
        ok = wait_stage("finale", 15); check("the ending exit plays the finale's PICTURE again (card goes back to the finale stage)", ok, stage())
        ok = wait_stage("stay", 60); check("and brings her back to stay a while", ok, stage())
        pg.wait_for_function("window.__stay !== undefined", timeout=30000); pg.wait_for_timeout(1000)
        check("both exits still on offer after the replay", pg.evaluate("window.__stay.exits()") == ["letter", "replay"])
        log = pg.evaluate("window.__card.log().map(x => x.stage)")
        check("order of stages seen", log == ["cake", "release", "envelope", "finale", "stay", "finale", "stay"], log)
        check("console clean for the whole chain", not real(logs), real(logs)[:3])
        b.close()
        # ---- 3. the sky hands over at five (and not before)
        b = p.chromium.launch(args=ARGS)
        four = "strawberry,bumblebee,rose,kaaju-katli"
        pg, logs = page(b, 390, 780, "card&from=sky&nopost&tier=low&reduced&done=" + four)
        pg.wait_for_timeout(2500)
        check("sky with four names done stays on the sky", pg.evaluate("window.__card.stage()") == "sky" and pg.evaluate("window.__sky.done().length") == 4)
        pg.context.close()
        pg, logs = page(b, 390, 780, "card&from=sky&nopost&tier=low&reduced&done=" + four + ",cutie-patootie")
        pg.wait_for_function("window.__card.stage() === 'cake'", timeout=20000)
        check("sky with all five done hands over to the cake", pg.evaluate("window.__card.stage()") == "cake")
        pg.wait_for_timeout(1500); pg.screenshot(path=f"{out}/0_sky_to_cake.png")
        check("console clean (sky to cake)", not real(logs), real(logs)[:3])
        b.close()
finally:
    srv.terminate()
print(f"{sum(res)} / {len(res)}")
sys.exit(0 if all(res) else 1)
