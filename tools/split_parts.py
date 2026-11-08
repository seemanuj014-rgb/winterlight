#!/usr/bin/env python3
"""Phase 6: split the traced silhouette into head, two ears (flap + bowl) and neck outlines, measured from the drawing.

Usage:  python3 tools/split_parts.py character/reference/chamgadad_ref_01_head_front.png
Reads:  character/traced/<name>.silhouette.json   (Phase 0/5 outer contour; never changed here)
Writes: character/traced/<name>.parts.json        (normalised 0..1, y down: the outlines Phase 6 extrudes)
        character/traced/<name>.parts.overlay.png (every part drawn on the reference, for a human to check)
Needs:  pillow numpy scipy scikit-image

What is measured and what is a closure (flagged `closure` in the JSON, always hidden behind something):
  * free edges (left of the head, the outside of both ears, the right of the neck) are the traced contour points, unchanged;
  * the head's top and right edge, where it overlaps the ears, is the OUTER edge of the head's own ink line, found by
    casting rays from the head centre inside a +-34 px window around a hand-placed guide (the window only picks which
    ink line; the position comes from the pixels);
  * the chin curve is the lower edge of the ink curve under the face (a boundary between head and neck; whether it is a
    smile or a chin edge is Q1 and is NOT decided here);
  * each ear's fold stroke is the skeleton of the dark pixels inside the ear, away from the outline;
  * the parts of each outline that run into the head or the neck are closures: straight or short curved edges placed
    inside the part that hides them. They are never visible from the front.
"""
import sys, json, os
import warnings
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as ndi
from skimage import morphology, draw

# Contour indices of the junctions (Phase 0 contour, 147 points). Chosen by looking at an indexed overlay; see PHASE_STATUS.
J_NOTCH = 21      # chin meets the left outline
J_EAR_UP_L = 39   # upright ear, left base, where its outline runs into the head arc
J_EAR_UP_R = 69   # upright ear, right base
J_EAR_AN_T = 78   # angled ear, upper base
J_EAR_AN_B = 122  # angled ear, lower base on the head's right edge (its outline forks into the head's line here)
ARC_END = (824.0, 548.0)  # where the head's own ink line is last clear of the ear's lower outline; the arc stops here
J_HEAD_R = 123    # first contour point below the fork: the head's right edge continues along the contour from here
INK_PX = 10.8     # her ink thickness (median along the contour, Phase 3): Phase 6 insets every rim by this and lets the ink hull grow back out
J_NECK_R = 134    # right edge: head and neck share this edge above it, neck alone below


def smooth_closed_free(pts, k=5):
    """Moving average on an open polyline, ends kept."""
    p = np.asarray(pts, float)
    if len(p) < k + 2:
        return p
    out = p.copy()
    h = k // 2
    for i in range(1, len(p) - 1):
        a, b = max(0, i - h), min(len(p), i + h + 1)
        out[i] = p[a:b].mean(axis=0)
    return out


def hermite(p0, t0, p1, t1, n=12):
    s = np.linspace(0, 1, n)[:, None]
    h00, h10, h01, h11 = 2 * s**3 - 3 * s**2 + 1, s**3 - 2 * s**2 + s, -2 * s**3 + 3 * s**2, s**3 - s**2
    return h00 * p0 + h10 * t0 + h01 * p1 + h11 * t1


warnings.filterwarnings('ignore', category=FutureWarning)


def main(path):
    name = os.path.splitext(os.path.basename(path))[0]
    tdir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(path))), "traced")
    sil = json.load(open(os.path.join(tdir, name + ".silhouette.json")))
    W, H = sil["width"], sil["height"]
    C = np.array(sil["points"], float) * [W, H]
    img = Image.open(path).convert("RGB")
    im = np.array(img).astype(int)
    ink = im.sum(axis=2) < 200

    def is_ink(x, y):
        xi, yi = int(round(x)), int(round(y))
        return 0 <= xi < W and 0 <= yi < H and ink[yi, xi]

    # ---- head arc: outer edge of the head's ink line from the left ear junction over the top to the right ear junction
    c0 = np.array([585.0, 620.0])
    guide = np.array([C[J_EAR_UP_L], (520, 378), (580, 362), (640, 358), (700, 368), (753, 400), (790, 438), (815, 500), ARC_END], float)
    gang = np.unwrap(np.arctan2(guide[:, 1] - c0[1], guide[:, 0] - c0[0]))
    grad = np.hypot(guide[:, 0] - c0[0], guide[:, 1] - c0[1])
    thetas = np.linspace(gang[0], gang[-1], 160)
    rg = np.interp(thetas, gang, grad)
    radii = []
    for th, r_guess in zip(thetas, rg):
        found = None
        r = r_guess - 34
        inrun = False
        while r < r_guess + 34:
            x, y = c0[0] + r * np.cos(th), c0[1] + r * np.sin(th)
            if is_ink(x, y):
                inrun = True
                found = r
            elif inrun:
                break
            r += 0.5
        radii.append(found if found is not None else np.nan)
    radii = np.array(radii)
    bad = int(np.isnan(radii).sum())
    good = ~np.isnan(radii)
    radii = np.interp(thetas, thetas[good], radii[good])
    radii = ndi.median_filter(radii, size=5, mode="nearest")
    radii = ndi.uniform_filter1d(radii, size=5, mode="nearest")
    arc = np.stack([c0[0] + radii * np.cos(thetas), c0[1] + radii * np.sin(thetas)], axis=1)
    arc[0] = C[J_EAR_UP_L]  # start exactly on the contour; the arc ends at ARC_END

    # ---- chin curve: lower edge of the dark curve under the face, from the notch to its free right end
    chin = []
    for x in range(int(C[J_NOTCH][0]) + 3, 760):
        y = 690
        while y < 900 and not ink[y, x]:
            y += 1
        if y >= 900:
            continue
        while ink[y + 1, x]:
            y += 1
        chin.append((x, y))
    chin = np.array(chin, float)
    # the free end is where the curve stops being one connected run: cut at the first gap of 4+ px in x
    gaps = np.where(np.diff(chin[:, 0]) > 3)[0]
    if len(gaps):
        chin = chin[: gaps[0] + 1]
    # trim the left end: within ~18 px of the notch the scanned edge climbs back up the head outline (a hairpin spur), not the chin
    chin = chin[chin[:, 0] >= C[J_NOTCH][0] + 18]
    chin = smooth_closed_free(chin, 9)[::6]
    chin = np.vstack([chin, smooth_closed_free(chin, 9)[-1:]]) if len(chin) else chin
    p_end = chin[-1]
    t_end = chin[-1] - chin[-4]
    t_end = t_end / np.linalg.norm(t_end) * 70
    t_contour = (C[J_NECK_R - 2] - C[J_NECK_R]) / np.linalg.norm(C[J_NECK_R - 2] - C[J_NECK_R]) * 70  # up the right edge
    closure_chin = hermite(p_end, t_end, C[J_NECK_R], t_contour, 12)  # arrives moving up the edge, so walking the other way it continues down the edge[1:-1]

    # ---- head polygon, clockwise on screen: notch, up the left, arc over the top, down the right, closure, chin back to the notch
    # closure_chin goes from the chin end to the contour; we need contour -> chin end, so reverse it
    head = np.vstack([C[J_NOTCH:J_EAR_UP_L + 1], arc[1:], C[J_HEAD_R:J_NECK_R + 1], closure_chin[::-1], chin[::-1]])

    # ---- ears (flap = the whole ear outline), closures sit inside the head
    up_closure = np.array([(672, 420), (590, 440), (505, 432)], float)
    ear_up = np.vstack([C[J_EAR_UP_L:J_EAR_UP_R + 1], up_closure])
    an_closure = np.array([(790, 560), (770, 480), (738, 430)], float)
    ear_an = np.vstack([C[J_EAR_AN_T:J_EAR_AN_B + 1], an_closure])

    # ---- neck, closure inside the head
    neck_closure = np.array([(480, 650), (590, 640), (700, 630)], float)  # narrower than the head so the neck tapers into it (hidden behind the head from the front)  # left to right: the contour ends at the left notch
    neck = np.vstack([C[J_NECK_R:], C[:J_NOTCH + 1], neck_closure])

    # ---- fold strokes: skeleton of dark pixels inside each ear, away from its outline
    def fold_path(poly, rim_px=16):
        m = np.zeros((H, W), bool)
        rr, cc = draw.polygon(poly[:, 1], poly[:, 0], (H, W))
        m[rr, cc] = True
        inner = morphology.binary_erosion(m, morphology.disk(rim_px))
        # keep the part of the ear that is outside the head: drop everything below the head arc by removing pixels inside the head polygon
        hm = np.zeros((H, W), bool)
        rr, cc = draw.polygon(head[:, 1], head[:, 0], (H, W))
        hm[rr, cc] = True
        hm = morphology.binary_dilation(hm, morphology.disk(10))
        stroke = ink & inner & ~hm
        lab, n = ndi.label(stroke)
        if n == 0:
            raise SystemExit("no fold stroke found")
        sizes = ndi.sum(stroke, lab, range(1, n + 1))
        stroke = lab == (1 + int(np.argmax(sizes)))
        sk = morphology.skeletonize(stroke)
        ys, xs = np.nonzero(sk)
        pts = set(zip(xs.tolist(), ys.tolist()))
        # endpoints = skeleton pixels with exactly one neighbour; walk the longest chain between two of them
        def nbrs(p):
            return [(p[0] + dx, p[1] + dy) for dx in (-1, 0, 1) for dy in (-1, 0, 1) if (dx or dy) and (p[0] + dx, p[1] + dy) in pts]
        ends = [p for p in pts if len(nbrs(p)) == 1]
        if len(ends) < 2:
            raise SystemExit("fold skeleton has no clear ends")
        best = None
        for s in ends:
            prev, cur, path = None, s, [s]
            seen = {s}
            while True:
                nx = [q for q in nbrs(cur) if q not in seen]
                if not nx:
                    break
                nx.sort(key=lambda q: abs(q[0] - cur[0]) + abs(q[1] - cur[1]))
                cur = nx[0]
                seen.add(cur)
                path.append(cur)
            if best is None or len(path) > len(best):
                best = path
        return np.array(best, float)

    f_up = smooth_closed_free(fold_path(ear_up), 9)
    f_an = smooth_closed_free(fold_path(ear_an), 9)

    def snap_to_contour_or_arc(p, direction):
        """Extend a fold end along its tangent until it reaches the ear outline or the head arc (within 8 px)."""
        ref = np.vstack([C, arc])
        q = p.copy()
        for _ in range(60):
            if np.min(np.hypot(ref[:, 0] - q[0], ref[:, 1] - q[1])) < 8:
                break
            q = q + direction
        return q

    def extend(path):
        d0 = path[0] - path[min(6, len(path) - 1)]
        d1 = path[-1] - path[max(-7, -len(path))]
        d0, d1 = d0 / np.linalg.norm(d0), d1 / np.linalg.norm(d1)
        return np.vstack([snap_to_contour_or_arc(path[0], d0), path, snap_to_contour_or_arc(path[-1], d1)])

    f_up, f_an = extend(f_up), extend(f_an)

    def nearest_idx(ref, p):
        return int(np.argmin(np.hypot(ref[:, 0] - p[0], ref[:, 1] - p[1])))

    # upright ear: which fold end is at the top? the one with the smaller y
    if f_up[0][1] > f_up[-1][1]:
        f_up = f_up[::-1]
    t_up, b_up = f_up[0], f_up[-1]
    k_up = nearest_idx(C[: J_EAR_UP_R + 1], t_up)
    k_up = max(k_up, J_EAR_UP_L)
    # bowl = the left part: fold top -> fold base, drop straight into the head, across to the left closure point, up the left outline to the top
    bowl_up = np.vstack([f_up, [b_up[0], 432], [505, 432], C[J_EAR_UP_L:k_up + 1]])

    # angled ear: bowl = the lower-right part. fold end nearest the head (smaller x) is the base end
    if f_an[0][0] > f_an[-1][0]:
        f_an = f_an[::-1]
    b_an, t_an = f_an[0], f_an[-1]
    k_an = nearest_idx(C[J_EAR_AN_T:J_EAR_AN_B + 1], t_an) + J_EAR_AN_T
    bowl_an = np.vstack([f_an, C[k_an:J_EAR_AN_B + 1], [790, 560], [b_an[0] - 20, b_an[1] + 12]])

    # The fold stroke was measured as a centreline, but the bowl's rim becomes an ink line drawn outward from the bowl's edge (toward the flap)
    # after the whole outline is inset by one ink width. So the stroke must be covered by [rim, rim + ink]: pre-shift the bowl's fold edge half an
    # ink width toward the flap, so that after the uniform inset it sits half an ink width on the bowl side of the centreline.
    def shift_fold(bowl, nfold):
        c = bowl.mean(axis=0)
        fold = bowl[:nfold]
        t = np.gradient(fold, axis=0)
        t = t / (np.linalg.norm(t, axis=1, keepdims=True) + 1e-9)
        nrm = np.stack([-t[:, 1], t[:, 0]], axis=1)
        sign = np.sign((((fold - c) * nrm).sum(axis=1)).mean()) or 1.0  # normals pointing away from the bowl's middle = toward the flap
        out = bowl.copy()
        out[:nfold] = fold + nrm * sign * (INK_PX / 2)
        return out

    bowl_up = shift_fold(bowl_up, len(f_up))
    bowl_an = shift_fold(bowl_an, len(f_an))

    # ---- lavender patch: ellipse fitted to pixels close to the measured patch colour, inside each ear
    def patch(poly):
        m = np.zeros((H, W), bool)
        rr, cc = draw.polygon(poly[:, 1], poly[:, 0], (H, W))
        m[rr, cc] = True
        target = np.array([0x87, 0x88, 0x9c])
        # the drawn patch fades out; take where it is at least halfway from the ear blue to the patch colour
        blue = np.array([0xc4, 0xd6, 0xe1])
        t = ((im - blue) @ (target - blue)) / np.dot(target - blue, target - blue)
        sel = m & (t > 0.5) & ~ink
        sel = morphology.binary_opening(sel, morphology.disk(3))
        lab, n = ndi.label(sel)
        if n == 0:
            return None
        sizes = ndi.sum(sel, lab, range(1, n + 1))
        sel = lab == (1 + int(np.argmax(sizes)))
        ys, xs = np.nonzero(sel)
        cov = np.cov(np.stack([xs, ys]))
        ev, evec = np.linalg.eigh(cov)
        ang = float(np.arctan2(evec[1, 1], evec[0, 1]))
        return {"cx": float(xs.mean()), "cy": float(ys.mean()), "rx": float(2 * np.sqrt(ev[1])), "ry": float(2 * np.sqrt(ev[0])), "angle_rad": ang, "area_px": int(len(xs))}

    p_up, p_an = patch(bowl_up), patch(bowl_an)

    def norm(a):
        return [[round(float(x) / W, 5), round(float(y) / H, 5)] for x, y in a]

    def normp(p):
        return None if p is None else {"cx": round(p["cx"] / W, 5), "cy": round(p["cy"] / H, 5), "rx": round(p["rx"] / W, 5), "ry": round(p["ry"] / H, 5), "angle_rad": round(p["angle_rad"], 4), "area_px": p["area_px"]}

    parts = {
        "source": os.path.basename(path), "width": W, "height": H,
        "units": "normalised 0..1, y down, same frame as the silhouette; points run clockwise on screen",
        "head": {"points": norm(head)},
        "ear_upright": {"points": norm(ear_up), "bowl": norm(bowl_up), "fold": norm(f_up),
                        "base": norm([C[J_EAR_UP_L], C[J_EAR_UP_R]]), "pivot": norm([(C[J_EAR_UP_L] + C[J_EAR_UP_R]) / 2])[0], "patch": normp(p_up)},
        "ear_angled": {"points": norm(ear_an), "bowl": norm(bowl_an), "fold": norm(f_an),
                       "base": norm([C[J_EAR_AN_T], C[J_EAR_AN_B]]), "pivot": norm([(C[J_EAR_AN_T] + C[J_EAR_AN_B]) / 2])[0], "patch": normp(p_an)},
        "neck": {"points": norm(neck)},
        "junction_indices": {"notch": J_NOTCH, "ear_up_left": J_EAR_UP_L, "ear_up_right": J_EAR_UP_R, "ear_angled_top": J_EAR_AN_T, "ear_angled_bottom": J_EAR_AN_B, "neck_right": J_NECK_R},
        "measured_vs_closure": "free edges = traced contour points; head arc and chin = measured ink edges; fold = skeleton of the fold stroke; the edges that run inside the head or the neck (ear and neck closures, the short head-to-neck join at the right) are closures and never visible from the front",
        "arc_rays_without_ink": bad,
    }
    json.dump(parts, open(os.path.join(tdir, name + ".parts.json"), "w"))

    # ---- overlay
    ov = img.copy().convert("RGBA")
    d = ImageDraw.Draw(ov, "RGBA")
    cols = {"head": (230, 30, 30), "ear_up": (30, 120, 230), "ear_an": (20, 170, 60), "neck": (230, 140, 0)}
    for key, poly in (("head", head), ("ear_up", ear_up), ("ear_an", ear_an), ("neck", neck)):
        d.line([tuple(p) for p in poly] + [tuple(poly[0])], fill=cols[key] + (255,), width=3)
    for poly in (bowl_up, bowl_an):
        d.line([tuple(p) for p in poly] + [tuple(poly[0])], fill=(160, 0, 200, 255), width=2)
    for f in (f_up, f_an):
        for p in f[::4]:
            d.ellipse([p[0] - 2, p[1] - 2, p[0] + 2, p[1] + 2], fill=(255, 0, 255, 255))
    for p in (p_up, p_an):
        if p:
            d.ellipse([p["cx"] - p["rx"], p["cy"] - p["ry"], p["cx"] + p["rx"], p["cy"] + p["ry"]], outline=(255, 255, 0, 255), width=2)
    ov.convert("RGB").save(os.path.join(tdir, name + ".parts.overlay.png"))
    print("rays without ink:", bad, "| head pts", len(head), "| ear_up", len(ear_up), "| ear_an", len(ear_an), "| neck", len(neck))
    print("fold up: top", t_up.round(), "base", b_up.round(), "| fold angled: base", b_an.round(), "top", t_an.round())
    print("patches", p_up, p_an)


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "character/reference/chamgadad_ref_01_head_front.png")
