#!/usr/bin/env python3
"""Re-measure the character palette from fixed pixel patches and compare it with character/palette.json.

Usage:  python3 tools/sample_palette.py [character/reference/chamgadad_ref_01_head_front.png]
Writes: character/traced/<name>.palette_check.json   (patch, measured median, stored value, per-channel difference)
Prints one line per colour and exits 1 if any measured colour is more than TOL (12) away from the stored one in any channel.
Patches are 5x5 pixels (centre given in 1080x1080 image pixels), chosen by looking at the drawing. Nothing is guessed:
the stored palette is not changed by this script; a mismatch is a question for a human.
Needs: pillow numpy
"""
import sys, os, json
import numpy as np
from PIL import Image

TOL = 12
# role -> (x, y, note). Pixel centres in the 1080x1080 reference.
PATCHES = {
    "body_base": (560, 700, "flat cheek fill"),
    "body_chest": (560, 1010, "flat chest fill"),
    "ear_front_pale_blue": (505, 300, "upright ear, inner, away from the lavender patch"),
    "ear_inner_lavender": (555, 300, "upright ear, lavender-grey patch"),
    "ear_right_pale_blue": (905, 515, "angled ear, inner pale blue"),
    "ear_back_shadow_teal": (800, 430, "angled ear, darker teal-grey back"),
    "eye_black": (520, 580, "left eye, dark area"),
    "eye_highlight_white": (452, 538, "left eye, white rounded-triangle highlight"),
    "eye_lower_pale_blue_tab": (460, 598, "left eye, pale-blue tab at the bottom"),
}
# Measured but NOT compared against a stored value: the warm rim varies across its width.
RIM_ROWS = [(650, 352, 384), (700, 352, 384)]

def hx(c):
    return "#%02x%02x%02x" % tuple(int(v) for v in c)

def main(path):
    name = os.path.splitext(os.path.basename(path))[0]
    im = np.array(Image.open(path).convert("RGB")).astype(int)
    stored = json.load(open("character/palette.json"))["colors"]
    out, bad = {}, 0
    for role, (x, y, note) in PATCHES.items():
        m = np.median(im[y - 2:y + 3, x - 2:x + 3].reshape(-1, 3), axis=0)
        s = stored.get(role)
        diff = None if s is None else [int(m[i]) - int(s[1 + 2 * i:3 + 2 * i], 16) for i in range(3)]
        ok = diff is None or max(abs(d) for d in diff) <= TOL
        bad += 0 if ok else 1
        out[role] = {"patch": [x, y], "note": note, "measured": hx(m), "stored": s, "diff_rgb": diff, "within_tol": ok}
        print(f"{'ok ' if ok else 'BAD'} {role:26s} measured {hx(m)} stored {s} diff {diff}")
    # the rim: lightest pixel and the median of the pale band along two rows across the left edge
    rim = []
    for (y, x0, x1) in RIM_ROWS:
        row = im[y, x0:x1]
        pale = row[(row.sum(axis=1) > 600) & (np.abs(row[:, 0] - row[:, 2]) < 14)]
        if len(pale):
            rim.append({"row": y, "band_median": hx(np.median(pale, axis=0)), "lightest": hx(pale[np.argmax(pale.sum(axis=1))]), "pixels": int(len(pale))})
    out["rim_light_warm_edge_measured"] = {"stored": stored.get("rim_light_warm_edge"), "rows": rim,
        "note": "informational: the stored rim is a median over a patch; the band itself is lighter at its peak"}
    for r in rim:
        print(f"rim row {r['row']}: band median {r['band_median']}, lightest {r['lightest']} ({r['pixels']} px), stored {stored.get('rim_light_warm_edge')}")
    os.makedirs("character/traced", exist_ok=True)
    json.dump({"source": os.path.basename(path), "tolerance_per_channel": TOL, "colors": out}, open(f"character/traced/{name}.palette_check.json", "w"), indent=1)
    print("palette check:", "all within tolerance" if bad == 0 else f"{bad} outside tolerance")
    sys.exit(1 if bad else 0)

if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "character/reference/chamgadad_ref_01_head_front.png")
