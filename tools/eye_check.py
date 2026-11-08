#!/usr/bin/env python3
"""Phase 7: score the eyes of a WebGL screenshot (square, from `?face&bg=white&still`) against her drawing.

Usage:  python3 tools/eye_check.py shots7/ref.png [out_dir]
Measures the same things in both images, with the same code: the near-black disc (centre, width, height), the white marks and the
pale-blue tab (centres). Prints a table (reference | render | difference, in fractions of the image) and writes eye_check.json and
eye_overlay50.png (render over her drawing at 50 percent, eye area). Targets: disc centre within 0.01 [A] (the Phase 5 spec).
"""
import sys, json, os
import numpy as np
from PIL import Image
from scipy import ndimage as ndi
from skimage import morphology

REF = "character/reference/chamgadad_ref_01_head_front.png"
FEAT = "character/traced/chamgadad_ref_01_head_front.features.json"


def measure(im, cx, cy):
    a = np.array(im.convert("RGB")).astype(int)
    S = a.shape[0]
    lum = a.sum(axis=2)
    win = np.zeros(lum.shape, bool)
    r = int(0.1 * S)
    win[int(cy * S - r):int(cy * S + r), int(cx * S - r):int(cx * S + r)] = True
    core = morphology.opening((lum < 150) & win, morphology.disk(max(2, int(7 * S / 1080))))
    lab, n = ndi.label(core)
    best = min(range(1, n + 1), key=lambda i: np.hypot(*(np.array(ndi.center_of_mass(lab == i)) / S - [cy, cx])))
    core = lab == best
    hull = morphology.convex_hull_image(core)
    blue = a[:, :, 2] - a[:, :, 0]
    marks = (lum > 585) & ndi.binary_dilation(hull, iterations=int(14 * S / 1080)) & win
    lab2, n2 = ndi.label(marks)
    out = {}
    ys, xs = np.nonzero(core)
    out["disc_cx"], out["disc_cy"] = xs.mean() / S, ys.mean() / S
    out["disc_w"], out["disc_h"] = (xs.max() - xs.min()) / S, (ys.max() - ys.min()) / S
    comps = []
    for i in range(1, n2 + 1):
        m = lab2 == i
        if m.sum() < 60 * (S / 1080) ** 2:
            continue
        yy, xx = np.nonzero(m)
        comps.append((float(blue[m].mean()), xx.mean() / S, yy.mean() / S, int(m.sum())))
    tab = max(comps, key=lambda c: c[0])
    whites = sorted([c for c in comps if c is not tab], key=lambda c: c[2])
    out["arc"] = whites[0][1:3]
    out["triangle"] = max(whites[1:], key=lambda c: c[3])[1:3] if len(whites) > 1 else None
    out["tab"] = tab[1:3]
    return out


def main(shot, outdir="."):
    ref = Image.open(REF)
    s = Image.open(shot)
    feats = json.load(open(FEAT))["dark_blobs_left_to_right"]
    S = s.size[0]
    assert s.size[0] == s.size[1], "the screenshot must be square (shot_views.py does that)"
    rows, ok = [], True
    for side, b in zip(("left", "right"), feats):
        mr = measure(ref, b["full_cx"], b["full_cy"])
        ms = measure(s, b["full_cx"], b["full_cy"])
        for k in ("disc_cx", "disc_cy", "disc_w", "disc_h"):
            rows.append((side, k, mr[k], ms[k], ms[k] - mr[k]))
        for k in ("arc", "triangle", "tab"):
            for j, ax in enumerate("xy"):
                rows.append((side, f"{k}_{ax}", mr[k][j], ms[k][j], ms[k][j] - mr[k][j]))
        d = np.hypot(ms["disc_cx"] - mr["disc_cx"], ms["disc_cy"] - mr["disc_cy"])
        ok &= d <= 0.01
        rows.append((side, "disc centre distance", 0.0, d, d))
    print(f"{'eye':6} {'what':22} {'drawing':>9} {'render':>9} {'diff':>9}")
    for r in rows:
        print(f"{r[0]:6} {r[1]:22} {r[2]:9.4f} {r[3]:9.4f} {r[4]:+9.4f}")
    print("disc centres within 0.01:", "YES" if ok else "NO")
    os.makedirs(outdir, exist_ok=True)
    json.dump([{"eye": r[0], "what": r[1], "drawing": r[2], "render": r[3], "diff": r[4]} for r in rows], open(os.path.join(outdir, "eye_check.json"), "w"), indent=1)
    blend = Image.blend(ref.convert("RGB").resize((S, S)), s.convert("RGB"), 0.5)
    box = (int(0.33 * S), int(0.40 * S), int(0.72 * S), int(0.65 * S))
    blend.crop(box).resize(((box[2] - box[0]) * 2, (box[3] - box[1]) * 2), Image.LANCZOS).save(os.path.join(outdir, "eye_overlay50.png"))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else ".")
