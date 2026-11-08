#!/usr/bin/env python3
"""Phase 6: compare the 3D head with her drawing, and look at it from other sides, without a GPU.

Usage:
  npx tsx tools/dump_head_mesh.ts out/head_mesh.json          # builds the head, writes the meshes
  python3 tools/fidelity.py --mesh out/head_mesh.json --out out/fidelity [--views]
  python3 tools/fidelity.py --shot some_render.png --out out/fidelity   # score an existing PNG instead (e.g. a WebGL screenshot of ?head&bg=white)
  npm run build && python3 tools/fidelity.py --whole --out out/fidelity  # Phase 11 (gate G0): render the WHOLE figure at the reference camera
                                                                         # in headless Chromium (software WebGL), then score, overlay and list the worst deviations

What it does
  * renders the meshes in SOFTWARE with the same orthographic projection as the reference camera (the drawing's 1080 x 1080 plane);
    it paints the ink line as a band of her measured thickness (10.8 px) drawn outward from each part's edge, like the toon hull;
  * writes front.png (the render), overlay50.png (the render over her drawing at 50 percent) and side_by_side.png;
  * scores the silhouette against the traced contour (character/traced/*.silhouette.json) with the Phase 5 regions:
    head and ears (y 0 to 0.72) and neck and chest (y 0.72 to 0.995), and prints and writes fidelity.json;
  * --views also writes views.png: front, three-quarter, side, back and a look from above, to check for spikes, pinching and loose ears.
This is NOT the WebGL render: lighting is a stand-in 4-step ramp, the ink is a flat band, and no frame rate or GPU behaviour is implied.
With --shot the same scoring runs on a real screenshot (a pixel counts as figure when it is not the white background).
Needs: pillow numpy scipy scikit-image
"""
import argparse, json, os
import numpy as np
from PIL import Image
from scipy import ndimage as ndi
from skimage import draw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REF = os.path.join(ROOT, "character/reference/chamgadad_ref_01_head_front.png")
SIL = os.path.join(ROOT, "character/traced/chamgadad_ref_01_head_front.silhouette.json")
REGIONS = {"headAndEars": (0.0, 0.72, 0.97), "neckAndChest": (0.72, 0.995, 0.95)}  # mirrors character/fidelity.json
WORLD = 4.0


def to_px(x, y, size):
    return (x / WORLD + 0.5) * size, (0.5 - y / WORLD) * size


def raster(parts, size, project, light=(3.0, 4.0, 5.0), ink_px=10.8, ink=True):
    """Orthographic z-buffer render. project(P) -> (px_x, px_y, depth) for an (n,3) array of world points; depth larger = nearer."""
    L = np.array(light) / np.linalg.norm(light)
    depth = np.full((size, size), -np.inf)
    rgb = np.ones((size, size, 3))
    pid = np.full((size, size), -1)
    alpha = np.zeros((size, size), bool)
    coverage = []
    for k, p in enumerate(parts):
        P = np.array(p["positions"], float).reshape(-1, 3)
        N = np.array(p["normals"], float).reshape(-1, 3)
        Cc = np.array(p["colors"], float).reshape(-1, 3)
        I = np.array(p["indices"], int).reshape(-1, 3)
        px, py, pz = project(P)
        nview = project.normal(N)
        cov = np.zeros((size, size), bool)
        for a, b, c in I:
            xs, ys = (px[a], px[b], px[c]), (py[a], py[b], py[c])
            x0, x1 = int(max(0, np.floor(min(xs) - 0.5))), int(min(size - 1, np.ceil(max(xs) - 0.5)))
            y0, y1 = int(max(0, np.floor(min(ys) - 0.5))), int(min(size - 1, np.ceil(max(ys) - 0.5)))
            if x1 < x0 or y1 < y0:
                continue
            area = (xs[1] - xs[0]) * (ys[2] - ys[0]) - (xs[2] - xs[0]) * (ys[1] - ys[0])
            if abs(area) < 1e-9:
                continue
            gx, gy = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
            w0 = ((xs[1] - gx) * (ys[2] - gy) - (xs[2] - gx) * (ys[1] - gy)) / area
            w1 = ((xs[2] - gx) * (ys[0] - gy) - (xs[0] - gx) * (ys[2] - gy)) / area
            w2 = 1 - w0 - w1
            inside = (w0 >= -1e-9) & (w1 >= -1e-9) & (w2 >= -1e-9)
            if not inside.any():
                continue
            z = w0 * pz[a] + w1 * pz[b] + w2 * pz[c]
            sl = (slice(y0, y1 + 1), slice(x0, x1 + 1))
            cov[sl] |= inside
            win = inside & (z > depth[sl])
            if not win.any():
                continue
            n = w0[..., None] * nview[a] + w1[..., None] * nview[b] + w2[..., None] * nview[c]
            n = n / (np.linalg.norm(n, axis=-1, keepdims=True) + 1e-9)
            ndl = n @ L
            step = np.select([ndl > 0.55, ndl > 0.25, ndl > -0.05], [1.0, 0.88, 0.76], 0.66)  # stand-in 4-step ramp
            col = (w0[..., None] * Cc[a] + w1[..., None] * Cc[b] + w2[..., None] * Cc[c]) * step[..., None]
            depth[sl] = np.where(win, z, depth[sl])
            rgb[sl] = np.where(win[..., None], col, rgb[sl])
            pid[sl] = np.where(win, k, pid[sl])
            alpha[sl] |= win
        coverage.append((cov, float(np.mean(pz[: p["rimCount"]]))))
    if ink:
        # ink hull: each part's edge grown outward by the ink width, drawn over whatever is behind that part's rim
        r = ink_px * size / 1080.0
        st = ndi.generate_binary_structure(2, 1)
        for k in np.argsort([c[1] for c in coverage]):
            cov, zrim = coverage[k]
            ring = ndi.binary_dilation(cov, structure=st, iterations=max(1, int(round(r)))) & ~cov
            paint = ring & (depth < zrim - 1e-6)
            rgb[paint] = (0.004, 0.004, 0.008)
            alpha |= paint
    return rgb, alpha, pid


class Front:
    def __init__(self, size):
        self.size = size
    def __call__(self, P):
        px, py = to_px(P[:, 0], P[:, 1], self.size)
        return px, py, P[:, 2]
    def normal(self, N):
        return N


class Turn:
    """Rotate about the head centre (yaw about y, then pitch about x), orthographic, fit to the canvas."""
    def __init__(self, size, centre, yaw, pitch, scale):
        self.size, self.scale = size, scale
        cy, sy, cp, sp = np.cos(np.radians(yaw)), np.sin(np.radians(yaw)), np.cos(np.radians(pitch)), np.sin(np.radians(pitch))
        Ry = np.array([[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]])
        Rx = np.array([[1, 0, 0], [0, cp, -sp], [0, sp, cp]])
        self.R = Rx @ Ry
        self.c = np.array(centre)
    def __call__(self, P):
        Q = (P - self.c) @ self.R.T
        return self.size / 2 + Q[:, 0] * self.scale, self.size / 2 - Q[:, 1] * self.scale, Q[:, 2]
    def normal(self, N):
        return N @ self.R.T


def score(mask, size):
    pts = json.load(open(SIL))["points"]
    truth = np.zeros((size, size), bool)
    rr, cc = draw.polygon([p[1] * size for p in pts], [p[0] * size for p in pts], (size, size))
    truth[rr, cc] = True
    res = {}
    for name, (y0, y1, target) in REGIONS.items():
        r0, r1 = int(np.ceil(y0 * size - 0.5)), int(np.ceil(y1 * size - 0.5))
        a, b = mask[r0:r1], truth[r0:r1]
        iou = float((a & b).sum() / max(1, (a | b).sum()))
        res[name] = {"iou": round(iou, 4), "target": target, "pass": iou >= target}
    return res, truth


def render_whole(path, size, query="?behave&view=ref&bg=white&still&at=0"):
    """Phase 11: shoot dist/ (run `npm run build` first) at the reference camera, square, white background. Software WebGL."""
    import subprocess, sys, time
    from playwright.sync_api import sync_playwright
    srv = subprocess.Popen([sys.executable, "-m", "http.server", "4177", "-d", os.path.join(ROOT, "dist")], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1)
    logs = []
    try:
        with sync_playwright() as p:
            b = p.chromium.launch(args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"])
            pg = b.new_page(viewport={"width": size, "height": size})
            pg.on("console", lambda m: logs.append(m.type + ": " + m.text))
            pg.on("pageerror", lambda e: logs.append("pageerror: " + str(e)))
            pg.goto("http://localhost:4177/" + query)
            pg.wait_for_timeout(3000)
            pg.screenshot(path=path)
            b.close()
    finally:
        srv.terminate()
    return [l for l in logs if not l.startswith(("log", "info"))]


def deviations(mask, truth, size, bands=12, top=4):
    """Where do render and drawing disagree? Per horizontal band (share of the image height) and the worst blobs, in fractions of the image."""
    only_r, only_d = mask & ~truth, truth & ~mask
    rows = []
    for i in range(bands):
        r0, r1 = i * size // bands, (i + 1) * size // bands
        rows.append({"y": [round(r0 / size, 3), round(r1 / size, 3)], "render_only_px": int(only_r[r0:r1].sum()), "drawing_only_px": int(only_d[r0:r1].sum()),
                     "iou": round(float((mask[r0:r1] & truth[r0:r1]).sum() / max(1, (mask[r0:r1] | truth[r0:r1]).sum())), 4)})
    blobs = []
    for kind, m in (("render_only", only_r), ("drawing_only", only_d)):
        m2 = ndi.binary_opening(m, iterations=2)  # ignore one-pixel edge noise: what is left is a real bulge or dent
        lab, n = ndi.label(m2)
        for i in range(1, n + 1):
            ys, xs = np.nonzero(lab == i)
            blobs.append({"kind": kind, "px": int(len(ys)), "centre": [round(xs.mean() / size, 3), round(ys.mean() / size, 3)],
                          "box": [round(xs.min() / size, 3), round(ys.min() / size, 3), round(xs.max() / size, 3), round(ys.max() / size, 3)]})
    blobs.sort(key=lambda b: -b["px"])
    return rows, blobs[:top], only_r, only_d


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--whole", action="store_true", help="Phase 11: render the whole figure at the reference camera first (needs npm run build, playwright)")
    ap.add_argument("--mesh")
    ap.add_argument("--shot")
    ap.add_argument("--out", default="out/fidelity")
    ap.add_argument("--size", type=int, default=1080)
    ap.add_argument("--views", action="store_true")
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    size = a.size
    ref = Image.open(REF).convert("RGB").resize((size, size), Image.LANCZOS)
    result = {}
    if a.whole:
        a.shot = os.path.join(a.out, "render_whole.png")
        errs = render_whole(a.shot, size)
        result["console_errors"] = errs
        print("console errors:", errs or "none")
    if a.shot:
        im = np.array(Image.open(a.shot).convert("RGB").resize((size, size)))
        alpha = (im.astype(int).sum(axis=2) < 3 * 250)
        rgb = im / 255.0
        result["source"] = "screenshot: " + os.path.basename(a.shot)
    else:
        dump = json.load(open(a.mesh))
        rgb, alpha, _ = raster(dump["parts"], size, Front(size), ink_px=dump["inkPx"])
        result["source"] = "software render of " + os.path.basename(a.mesh)
    img = (np.where(alpha[..., None], rgb, 1.0) * 255).astype(np.uint8)
    Image.fromarray(img).save(os.path.join(a.out, "front.png"))
    blend = (0.5 * np.array(ref) + 0.5 * img).astype(np.uint8)
    Image.fromarray(blend).save(os.path.join(a.out, "overlay50.png"))
    sbs = Image.new("RGB", (size * 2, size), "white")
    sbs.paste(ref, (0, 0))
    sbs.paste(Image.fromarray(img), (size, 0))
    sbs.save(os.path.join(a.out, "side_by_side.png"))
    # the traced contour includes the ink, so the render's figure (surface plus ink) is what is scored
    res, truth = score(alpha, size)
    result["regions"] = res
    result["pixels"] = {"figure": int(alpha.sum()), "truth": int(truth.sum()), "only_render": int((alpha & ~truth).sum()), "only_drawing": int((truth & ~alpha).sum())}
    rows, blobs, only_r, only_d = deviations(alpha, truth, size)
    result["worst_blobs"] = blobs
    result["bands"] = rows
    dev = np.array(ref).copy()  # deviation map: her drawing faded, render-only pixels red, drawing-only pixels blue
    dev = (dev * 0.35 + 255 * 0.65).astype(np.uint8)
    dev[only_r] = (230, 40, 40)
    dev[only_d] = (40, 80, 230)
    Image.fromarray(dev).save(os.path.join(a.out, "deviation.png"))
    json.dump(result, open(os.path.join(a.out, "fidelity.json"), "w"), indent=1)
    print(json.dumps(result, indent=1))

    if a.views and not a.shot:
        vs = 520
        c = dump["headCentre"] + [dump["headFrontZMax"] / 2]
        sheet = Image.new("RGB", (vs * 3, vs * 2), "white")
        for i, (name, yaw, pitch) in enumerate([("front", 0, 0), ("three-quarter", 35, 8), ("side", 90, 0), ("back", 180, 0), ("three-quarter from the back", 145, 8), ("above", 20, 55)]):
            rgb2, al2, _ = raster(dump["parts"], vs, Turn(vs, c, yaw, pitch, vs / 3.4), ink_px=dump["inkPx"])
            tile = Image.fromarray((np.where(al2[..., None], rgb2, 1.0) * 255).astype(np.uint8))
            sheet.paste(tile, ((i % 3) * vs, (i // 3) * vs))
        sheet.save(os.path.join(a.out, "views.png"))
        print("wrote views.png (front, three-quarter, side / back, three-quarter from the back, above)")


if __name__ == "__main__":
    main()
