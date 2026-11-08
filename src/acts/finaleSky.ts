import * as THREE from 'three';
import { createConstellationPlay, type Play } from '../constellations';
import { restoreShape } from '../constellations/sky';
import { SHAPES } from '../constellations/shapes';
import { layoutFor } from '../constellations/skyLayoutMath';
import type { Tier } from '../constellations/fx';
import { finalePlacement, layoutMessage, messageAlpha, messageFrame, type MessageLayout } from './finaleSkyMath';
import { STAY_WORLD, homePlacement } from './stayWorldMath';

// Phase 28: the finale's sky, as one object. The five FINISHED shapes (the Phase 22 shapes, drawn complete at once, silently) and ONE flat panel carrying the owner's message.
// It has no input, no hints and no sound; it is moved only by `set(lift, join)` and by the camera it rides with (like the constellation patches, it sits at a sky direction about
// 60 m from the eye and follows the camera's position, never its turning).
//   * the shapes: `finalePlacement` (`acts/finaleSkyMath.ts`) says where each is for a lift and a join
//   * the message: a canvas texture of the owner's string (`finaleMessageFor(credits)`), laid out by `layoutMessage` (wrap at spaces, shrink to fit, grow rather than cut). It draws plain
//     text in the system's own fonts, so Hindi or Hinglish shows as given. 1 draw call. Its alpha is `messageAlpha(join)`.
// Draw calls: the five shapes' own (a handful each, see `fx.stats()`) + 1 for the message.

export interface FinaleSky {
  /** the lift and join progress (0..1 each) from the finale machine */
  set(lift: number, join: number): void;
  /** Phase 28, stay a while: the shapes coming home from the crown to their patches (`homePlacement`, 0 = the crown, 1 = the patches); `null` goes back to `set(lift, join)`. The message fades as they leave. */
  setHome(k: number | null): void;
  /** Phase 28, stay a while: draw the shapes and the panel (true, the default) or none of them (false, the draw-call plan hides the sky while the animals are drawn) */
  setVisible(v: boolean): void;
  /** every frame, after the camera has been placed (the shapes and the panel ride its position) */
  update(dt: number, tSec: number): void;
  resize(widthPx: number, heightPx: number, aspect: number): void;
  setTier(t: Tier): void;
  setPixelRatio(pr: number): void;
  /** the layout the panel was drawn with (a test and the debug line read it) */
  layout(): MessageLayout;
  /** draw calls this object adds */
  drawCalls(): number;
  /** the message as drawn on the panel, line by line (what the screen shows) */
  lines(): string[];
  /** where a shape's first star is on the screen (px in the canvas box), or null when it is off screen (a test reads it) */
  screenOf(id: string): { x: number; y: number } | null;
  /** the message panel's box on the screen (px in the canvas box, clamped values are NOT applied: it may run off the screen), or null while it is invisible */
  messageBox(widthPx: number, heightPx: number): { x0: number; y0: number; x1: number; y1: number } | null;
  readonly messageMesh: THREE.Mesh;
  dispose(): void;
}

export interface FinaleSkyOptions {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /** content/names.json `constellations`, in the order the sky lists them */
  constellations: readonly { id: string; shape: string }[];
  /** the owner's message, as given */
  message: string;
  tier: Tier;
  reducedMotion: boolean;
  pixelRatio?: number;
  aspect: number;
}

const FONT_STACK = '"Noto Sans Devanagari", "Segoe UI", system-ui, -apple-system, "Hiragino Sans", sans-serif';
const CANVAS_W = 1024;

export function createFinaleSky(o: FinaleSkyOptions): FinaleSky {
  const { scene, camera } = o;
  let aspect = o.aspect;
  const plays = new Map<string, Play>();
  const layout0 = layoutFor(aspect);
  for (const c of o.constellations) {
    const def = SHAPES[c.shape];
    if (!def) throw new Error(`no shape "${c.shape}" for constellation "${c.id}"`);
    const play = createConstellationPlay({ scene, camera, def, placement: layout0[c.id]!, tier: o.tier, reducedMotion: o.reducedMotion, pixelRatio: o.pixelRatio });
    play.setHints(false);
    restoreShape(play); // finished, silently
    plays.set(c.id, play);
  }

  // ---- the message panel -----------------------------------------------------------------------------------------------------------------
  const canvas = document.createElement('canvas');
  canvas.width = CANVAS_W;
  canvas.height = 256;
  const g2 = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, toneMapped: false, opacity: 0, side: THREE.FrontSide });
  const geometry = new THREE.PlaneGeometry(1, 1);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'finale-message';
  mesh.renderOrder = 6;
  mesh.frustumCulled = false;
  mesh.visible = false;
  scene.add(mesh);

  let lay: MessageLayout = { lines: [], fontPx: 0, lineHeightPx: 0, heightPx: 0, grew: false };
  const measureAt = (fontPx: number): ((s: string) => number) => {
    if (!g2) return (s) => Array.from(s).length * fontPx * 0.55; // no 2D canvas (a test environment): a plain estimate
    g2.font = `500 ${fontPx}px ${FONT_STACK}`;
    return (s) => g2.measureText(s).width;
  };

  function draw(): void {
    const f = messageFrame(aspect);
    const targetH = Math.round((CANVAS_W * f.maxHeightM) / f.widthM);
    lay = layoutMessage(o.message, measureAt, CANVAS_W, targetH);
    canvas.height = lay.heightPx;
    if (g2) {
      g2.clearRect(0, 0, canvas.width, canvas.height);
      g2.font = `500 ${lay.fontPx}px ${FONT_STACK}`;
      g2.textAlign = 'center';
      g2.textBaseline = 'middle';
      g2.fillStyle = '#fff4dc';
      g2.shadowColor = 'rgba(150, 200, 255, 0.85)';
      g2.shadowBlur = lay.fontPx * 0.3;
      const total = lay.lines.length * lay.lineHeightPx;
      const top = (canvas.height - total) / 2;
      lay.lines.forEach((line, i) => g2.fillText(line, canvas.width / 2, top + lay.lineHeightPx * (i + 0.5)));
    }
    texture.needsUpdate = true;
    mesh.scale.set(f.widthM, (f.widthM * lay.heightPx) / CANVAS_W, 1);
  }
  draw();
  // a system font that arrives late (Devanagari on some phones) changes the widths: lay it out again once the fonts are ready
  try {
    void (document as Document & { fonts?: { ready: Promise<unknown> } }).fonts?.ready.then(() => draw());
  } catch {
    /* no font events: the first draw stands */
  }

  const dir = new THREE.Vector3();
  const corner = new THREE.Vector3();
  let join = 0;
  let lift = 0;
  let home: number | null = null;
  let shown = true;

  function place(): void {
    for (const [id, p] of plays) p.setPlacement(home === null ? finalePlacement(aspect, id, lift, join) : homePlacement(aspect, id, home));
    const f = messageFrame(aspect);
    const az = (f.azDeg * Math.PI) / 180;
    const el = (f.elDeg * Math.PI) / 180;
    dir.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).multiplyScalar(f.distance);
    mesh.position.copy(camera.position).add(dir);
    mesh.lookAt(camera.position);
    material.opacity = messageAlpha(home === null ? join : 1 - Math.min(1, home / STAY_WORLD.acrossShare));
    mesh.visible = shown && material.opacity > 0.003;
  }
  place();

  return {
    set(l, j) {
      lift = Number.isFinite(l) ? l : 0;
      join = Number.isFinite(j) ? j : 0;
    },
    setHome(k) {
      home = k === null ? null : Number.isFinite(k) ? Math.min(1, Math.max(0, k)) : 0;
    },
    setVisible(v) {
      shown = v;
      for (const p of plays.values()) p.fx.root.visible = v;
      mesh.visible = shown && material.opacity > 0.003;
    },
    update(dt, tSec) {
      place();
      for (const p of plays.values()) p.update(dt, tSec);
    },
    resize(w, h, a) {
      const changed = Math.abs(a - aspect) > 1e-6;
      aspect = a;
      for (const p of plays.values()) p.resize(w, h);
      if (changed) draw();
      place();
    },
    setTier: (t) => plays.forEach((p) => p.setTier(t)),
    setPixelRatio: (pr) => plays.forEach((p) => p.setPixelRatio(pr)),
    layout: () => lay,
    drawCalls: () => !shown ? 0 : [...plays.values()].reduce((a, p) => a + p.fx.stats().drawCalls, 0) + (mesh.visible ? 1 : 0),
    lines: () => [...lay.lines],
    screenOf(id) {
      const p = plays.get(id);
      if (!p) return null;
      const s = p.picker.screenOf(p.engine.def.nodes[0]!.id);
      return s ? { x: s.x, y: s.y } : null;
    },
    messageBox(w, h) {
      if (!mesh.visible) return null;
      mesh.updateMatrixWorld(true);
      camera.updateMatrixWorld();
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      for (const [cx, cy] of [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]] as const) {
        corner.set(cx, cy, 0).applyMatrix4(mesh.matrixWorld).project(camera);
        const x = (corner.x * 0.5 + 0.5) * w;
        const y = (1 - (corner.y * 0.5 + 0.5)) * h;
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y);
      }
      return { x0, y0, x1, y1 };
    },
    messageMesh: mesh,
    dispose() {
      for (const p of plays.values()) p.dispose();
      scene.remove(mesh);
      geometry.dispose();
      material.dispose();
      texture.dispose();
    },
  };
}
