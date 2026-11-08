#!/usr/bin/env python3
"""Trace a character reference image into data the 3D build can use.

Usage:  python tools/trace_silhouette.py character/reference/<file>.png
Writes: character/traced/<name>.silhouette.json  (outer contour, normalised 0..1, y down)
        character/traced/<name>.features.json    (eye blobs, measured, normalised)
        character/traced/<name>.overlay.png      (contour + eyes drawn on the reference, for a human to check)
Needs:  pillow numpy scipy scikit-image
Nothing here guesses: every number is measured from the pixels, and the overlay lets the owner confirm it.
"""
import sys, json, os
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as ndi
from skimage import measure, morphology

def main(path):
    name = os.path.splitext(os.path.basename(path))[0]
    img = Image.open(path).convert("RGB")
    im = np.array(img).astype(int)
    H, W, _ = im.shape
    nonwhite = np.abs(im - 255).sum(axis=2) > 40
    closed = morphology.closing(nonwhite, morphology.disk(3))
    mask = ndi.binary_fill_holes(closed)
    lab, n = ndi.label(mask)
    sizes = ndi.sum(mask, lab, range(1, n + 1))
    keep = lab == (1 + int(np.argmax(sizes)))
    contours = measure.find_contours(keep.astype(float), 0.5)
    c = max(contours, key=len)
    c = measure.approximate_polygon(c, tolerance=1.2)
    pts = [[round(float(x) / W, 5), round(float(y) / H, 5)] for y, x in c]
    touches_bottom = bool(keep[-1, :].any())
    sil = {
        "source": os.path.basename(path), "width": W, "height": H,
        "points": pts, "point_count": len(pts),
        "cropped_at_bottom": touches_bottom,
        "note": "Normalised 0..1, y points down. cropped_at_bottom=true means the drawing is cut off: the body below is NOT measured.",
    }
    dark = (im.sum(axis=2) < 60) & keep
    dark = morphology.opening(dark, morphology.disk(6))
    dl, dn = ndi.label(dark)
    blobs = []
    for i in range(1, dn + 1):
        ys, xs = np.where(dl == i)
        if len(xs) < 1500:
            continue
        # Phase 5: the full drawn eye = the dark blob plus the white highlight and pale tab that touch it.
        # (cx, cy, rx, ry above are the dark pixels only, so they sit a little right of and below the full eye.)
        blob = dl == i
        # white highlight (#f7f8fa, sum ~742) within 26 px; pale-blue tab (#c0d2dc: sum > 600 and blue well above red) within 10 px.
        # The warm rim (#d7d9d5) is neither, so it is left out.
        tot = im.sum(axis=2)
        white = (tot > 690) & ndi.binary_dilation(blob, structure=morphology.disk(26)) & keep
        tab = (tot > 600) & ((im[:, :, 2] - im[:, :, 0]) > 20) & ndi.binary_dilation(blob, structure=morphology.disk(10)) & keep
        full = morphology.convex_hull_image(blob | morphology.closing(white | tab, morphology.disk(2)))
        fy, fx = np.where(full)
        blobs.append({"cx": round(float(xs.mean()) / W, 5), "cy": round(float(ys.mean()) / H, 5),
                      "rx": round(float(xs.max() - xs.min()) / 2 / W, 5), "ry": round(float(ys.max() - ys.min()) / 2 / H, 5),
                      "area_px": int(len(xs)),
                      "full_cx": round(float((fx.min() + fx.max()) / 2) / W, 5), "full_cy": round(float((fy.min() + fy.max()) / 2) / H, 5),
                      "full_rx": round(float(fx.max() - fx.min()) / 2 / W, 5), "full_ry": round(float(fy.max() - fy.min()) / 2 / H, 5)})
    blobs.sort(key=lambda b: b["cx"])
    os.makedirs("character/traced", exist_ok=True)
    json.dump(sil, open(f"character/traced/{name}.silhouette.json", "w"))
    json.dump({"source": os.path.basename(path), "dark_blobs_left_to_right": blobs}, open(f"character/traced/{name}.features.json", "w"), indent=1)
    ov = img.copy(); d = ImageDraw.Draw(ov)
    d.line([(x * W, y * H) for x, y in pts] + [(pts[0][0] * W, pts[0][1] * H)], fill=(255, 0, 80), width=3)
    for b in blobs:
        d.ellipse([(b["cx"] - b["rx"]) * W, (b["cy"] - b["ry"]) * H, (b["cx"] + b["rx"]) * W, (b["cy"] + b["ry"]) * H], outline=(0, 160, 255), width=3)
        d.rectangle([(b["full_cx"] - b["full_rx"]) * W, (b["full_cy"] - b["full_ry"]) * H, (b["full_cx"] + b["full_rx"]) * W, (b["full_cy"] + b["full_ry"]) * H], outline=(0, 200, 90), width=2)
    ov.save(f"character/traced/{name}.overlay.png")
    print(name, "points:", len(pts), "eyes found:", len(blobs), "cropped_at_bottom:", touches_bottom)

if __name__ == "__main__":
    main(sys.argv[1])
