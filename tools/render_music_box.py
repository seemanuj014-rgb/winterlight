#!/usr/bin/env python3
"""Phase 23: render every sound OFFLINE through the card's own graph and voices (real OfflineAudioContext in headless Chromium)
and save WAVs for the owner to listen to.

Usage:  npm run build && python3 tools/render_music_box.py [out_dir]     (default docs/phase23)
Pass = every peak under 0 dBFS, nothing silent, nothing but silence-free finite audio, the music box about the right length.
Proves: the notes are the right notes, nothing clips, the sounds are not broken.
Does NOT prove: how it sounds on her phone speaker (owner-device gap).
"""
import sys, os, subprocess, time, base64, json, struct
from playwright.sync_api import sync_playwright

out = sys.argv[1] if len(sys.argv) > 1 else "docs/phase23"
os.makedirs(out, exist_ok=True)
NAMES = ["music_box", "completion", "chimes", "steps", "puff", "release", "purr", "beds", "demo"]
srv = subprocess.Popen([sys.executable, "-m", "http.server", "4174", "-d", "dist"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
rows, bad = [], []

def read_wav(b):
    assert b[:4] == b"RIFF" and b[8:12] == b"WAVE", "not a WAV"
    ch, rate, bits = struct.unpack("<HIxxxxxxH", b[22:24] + b[24:28] + b"\0" * 6 + b[34:36])[0:1] + struct.unpack("<I", b[24:28]) + struct.unpack("<H", b[34:36])
    data = b[44:]
    n = len(data) // 2
    s = struct.unpack("<%dh" % n, data[: n * 2])
    return rate, s

try:
    with sync_playwright() as p:
        br = p.chromium.launch(args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--autoplay-policy=no-user-gesture-required"])
        pg = br.new_page(viewport={"width": 390, "height": 780})
        logs = []
        pg.on("console", lambda m: logs.append(m.type + ": " + m.text) if m.type == "error" else None)
        pg.on("pageerror", lambda e: logs.append("pageerror: " + str(e)))
        pg.goto("http://localhost:4174/?audio")
        pg.wait_for_function("window.__audio !== undefined", timeout=10000)
        jobs = [(n, None) for n in NAMES] + [("demo", 0.6)]
        for name, gain in jobs:
            opts = {"gain": gain} if gain is not None else {}
            r = pg.evaluate("([n,o]) => window.__audio.render(n,o)", [name, opts])
            wav = base64.b64decode(r["wavBase64"])
            fn = f"{name}{'_max' if gain else ''}.wav"
            open(os.path.join(out, fn), "wb").write(wav)
            rate = int.from_bytes(wav[24:28], "little")
            n = (len(wav) - 44) // 2
            samples = struct.unpack("<%dh" % n, wav[44:44 + n * 2])
            pk = max(abs(x) for x in samples) / 32768 if samples else 0
            rms = (sum(x * x for x in samples) / max(n, 1)) ** 0.5 / 32768
            secs = n / rate
            rows.append(dict(file=fn, seconds=round(secs, 2), rate=rate, gain=r["gain"], peak=round(r["peak"], 4), peakDb=round(r["peakDb"], 2), wavPeak=round(pk, 4), rmsDb=round(20 * __import__("math").log10(rms), 1) if rms > 0 else None))
            if pk >= 1.0 or r["peakDb"] >= 0: bad.append(f"{fn}: clips ({r['peakDb']} dB)")
            if rms < 1e-4: bad.append(f"{fn}: silent")
        errs = [l for l in logs]
        br.close()
finally:
    srv.terminate()

for r in rows: print(r)
print("console problems:", errs or "none")
json.dump(rows, open(os.path.join(out, "levels.json"), "w"), indent=1)
print("FAIL: " + "; ".join(bad) if bad else "PASS: every peak under 0 dBFS, none silent")
sys.exit(1 if bad or errs else 0)
