#!/usr/bin/env python3
"""Phase 7: measure the face of a character reference: each eye as four pixel layers, and the two brow strokes.

Usage:  python3 tools/trace_face.py character/reference/<file>.png
Reads:  character/traced/<name>.features.json (the Phase 5 eye centres, only to place a search window)
Writes: character/traced/<name>.eye_left.png / .eye_right.png  RGBA layers of a CROP of her drawing, CROP px square, centred on the eye:
            R = the eye's body (soft alpha: the near-black disc plus the marks inside it)
            G = the white marks (the rounded triangle and the thin top arc), fixed to the light
            B = the pale-blue tab at the bottom, fixed to the light
            A = the grey tone inside the black (the drawn shading, 0..255), marks painted over from their neighbours
        character/traced/<name>.face.json         (crop boxes, the brows as an ink layer, measured numbers; normalised 0..1, y down)
        character/traced/<name>.face.overlay.png  (what was found, drawn on the reference, for a human to check)
Needs:  pillow numpy scipy scikit-image opencv-python
Nothing is guessed; every value comes from her pixels. No mouth is traced: the lower-face curve is Q1 and stays undecided.
"""
import sys, json, os
import numpy as np
import cv2
from PIL import Image, ImageDraw
from scipy import ndimage as ndi
from skimage import morphology

CROP = 240  # px of her 1080 px drawing around each eye (the eye is about 110 x 150 px; the brow wraps past it)


def order_walk(pts):
    order = [int(np.argmin(pts[:, 0] * 1.0 + 0.0 * pts[:, 1]))]
    left = set(range(len(pts))) - set(order)
    while left:
        last = pts[order[-1]]
        j = min(left, key=lambda k: np.hypot(*(pts[k] - last)))
        if np.hypot(*(pts[j] - last)) > 6:
            break
        order.append(j)
        left.discard(j)
    return pts[order]


def main(path):
    name = os.path.splitext(os.path.basename(path))[0]
    tdir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(path))), "traced")
    feats = json.load(open(os.path.join(tdir, name + ".features.json")))
    img = Image.open(path).convert("RGB")
    im = np.array(img).astype(int)
    H, W, _ = im.shape
    lum = im.sum(axis=2)
    blueness = im[:, :, 2] - im[:, :, 0]
    overlay = img.copy()
    dr = ImageDraw.Draw(overlay)
    out_eyes = []
    for side, blob in zip(("left", "right"), feats["dark_blobs_left_to_right"]):
        cx, cy = blob["full_cx"] * W, blob["full_cy"] * H
        win = np.zeros((H, W), bool)
        win[int(cy - 100):int(cy + 100), int(cx - 100):int(cx + 100)] = True
        core = morphology.opening((lum < 150) & win, morphology.disk(7))  # thin brows are gone
        lab, n = ndi.label(core)
        best = min(range(1, n + 1), key=lambda i: np.hypot(*(np.array(ndi.center_of_mass(lab == i)) - [cy, cx])))
        core = lab == best
        hull = morphology.convex_hull_image(core)
        marks = (lum > 585) & ndi.binary_dilation(hull, iterations=14) & win
        marks = morphology.opening(marks, morphology.disk(1))
        lab2, n2 = ndi.label(marks)
        comps = []
        for i in range(1, n2 + 1):
            m = lab2 == i
            if m.sum() < 60:
                continue
            ys, xs = np.nonzero(m)
            comps.append({"m": m, "cy": ys.mean(), "blue": float(blueness[m].mean())})
        tab = max(comps, key=lambda c: c["blue"])["m"]
        white = np.zeros_like(tab)
        for c in comps:
            if c["blue"] < 12:
                white |= c["m"]
        # the marks reach slightly past the dark disc: grow both by 1 px so their soft edge is kept
        white = ndi.binary_dilation(white, iterations=1) & (lum > 500)
        tab = ndi.binary_dilation(tab, iterations=1) & (lum > 500)
        # brows first: dark ink away from the eye core, above the eye's middle, that touches the eye. The head outline is not a brow.
        ink = morphology.opening((lum < 300) & win & ~ndi.binary_dilation(core, iterations=5), morphology.disk(2))
        lab4, n4 = ndi.label(ink)
        dist_core = ndi.distance_transform_edt(~core)
        ecy_core = ndi.center_of_mass(core)[0]
        brow_mask = np.zeros_like(core)
        brow_comps = []
        ccy, ccx = ndi.center_of_mass(core)
        for i in range(1, n4 + 1):
            m = lab4 == i
            ys, xs = np.nonzero(m)
            if m.sum() < 120 or ys.min() > ccy - 20 or dist_core[m].min() > 12:
                continue
            brow_comps.append(m)
            brow_mask |= m
        print(side, "brow components", [int(m.sum()) for m in brow_comps])
        # ink that hugs the eye (its top rim, the stretch of brow running along its side) is part of the eye and blinks with it; only the
        # stroke beyond that zone is the brow, so a closed eye does not leave a stray line above it
        rim_zone = ndi.binary_dilation(morphology.convex_hull_image(core), iterations=7)
        brow_mask = ndi.binary_dilation(brow_mask & ~rim_zone, iterations=2)
        body = morphology.opening((lum < 330) & ndi.binary_dilation(core, iterations=9) & win & ~brow_mask, morphology.disk(3))
        lab3, _ = ndi.label(body | white | tab)
        body = ndi.binary_fill_holes(lab3 == lab3[int(cy), int(cx)]) if lab3[int(cy), int(cx)] else body
        body = body | white | tab
        # the shade inside the black: the pixel grey where it is not a mark; marks are painted over from their surroundings
        grey = (lum / 3.0).astype(np.float32)
        hole = (white | tab).astype(np.uint8) * 255
        hole = cv2.dilate(hole, np.ones((5, 5), np.uint8))
        grey8 = np.clip(grey, 0, 255).astype(np.uint8)
        filled = cv2.inpaint(np.where(body, grey8, 0).astype(np.uint8), hole, 5, cv2.INPAINT_TELEA)
        ecx, ecy = (int(round(ndi.center_of_mass(body)[1])), int(round(ndi.center_of_mass(body)[0])))
        x0, y0 = ecx - CROP // 2, ecy - CROP // 2
        sl = (slice(y0, y0 + CROP), slice(x0, x0 + CROP))
        soft = np.clip((330 - lum) / 150.0, 0, 1)
        r = np.where(body, np.maximum(soft, 0.0), 0.0)
        r = np.where(white | tab, 1.0, r)
        r = np.where(ndi.binary_dilation(body, iterations=1), np.maximum(r, 0.0), 0)
        g = white.astype(np.float32)
        b = tab.astype(np.float32)
        rgba = np.stack([r[sl], g[sl], b[sl], filled[sl] / 255.0], axis=-1)
        Image.fromarray((rgba * 255 + 0.5).astype(np.uint8), "RGBA").save(os.path.join(tdir, f"{name}.eye_{side}.png"))
        # brow layer: her ink in the brow components, as soft alpha (kept apart from the eye so a blink can move it on its own)
        inkalpha = np.clip((300 - lum) / 150.0, 0, 1)
        brow_a = np.where(ndi.binary_dilation(brow_mask, iterations=1), inkalpha, 0.0)
        Image.fromarray((brow_a[sl] * 255 + 0.5).astype(np.uint8), "L").save(os.path.join(tdir, f"{name}.brow_{side}.png"))
        out_eyes.append({
            "side": side,
            "crop": {"cx": round(ecx / W, 9), "cy": round(ecy / H, 9), "size": round(CROP / W, 9), "px": CROP},
            "body_px": int(body.sum()),
            "body_centroid": [round(ecx / W, 5), round(ecy / H, 5)],
            "body_bbox": [round(float(np.nonzero(body.any(0))[0][0]) / W, 5), round(float(np.nonzero(body.any(1))[0][0]) / H, 5), round(float(np.nonzero(body.any(0))[0][-1]) / W, 5), round(float(np.nonzero(body.any(1))[0][-1]) / H, 5)],
            "white_px": int(white.sum()), "tab_px": int(tab.sum()),
            "brow_px": int((brow_a > 0.5).sum()),
        })
        ov = np.zeros((H, W, 4), np.uint8)
        ov[body] = (255, 0, 255, 60)
        ov[white] = (255, 0, 0, 200)
        ov[tab] = (0, 160, 0, 200)
        ov[brow_a > 0.5] = (0, 0, 255, 160)
        overlay.paste(Image.fromarray(ov, "RGBA"), (0, 0), Image.fromarray(ov, "RGBA"))
        dr = ImageDraw.Draw(overlay)
        dr.rectangle([x0, y0, x0 + CROP, y0 + CROP], outline="blue")
    out = {"source": os.path.basename(path), "eyes": out_eyes, "note": "Measured from pixels. No mouth is traced (Q1). No nose, lashes or blush exist in the drawing."}
    json.dump(out, open(os.path.join(tdir, name + ".face.json"), "w"), indent=1)
    overlay.save(os.path.join(tdir, name + ".face.overlay.png"))
    for e in out_eyes:
        print(e["side"], "body px", e["body_px"], "centroid", e["body_centroid"], "bbox", e["body_bbox"], "white", e["white_px"], "tab", e["tab_px"], "brow px", e["brow_px"])


if __name__ == "__main__":
    main(sys.argv[1])
