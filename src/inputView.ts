import * as THREE from 'three';
import type { Stage } from './core/renderer';
import { createInput, createPicker, createTilt, createHaptics, blendParallax, type GesturePayload, type Input, type Picker } from './input';

// Phase 18 test view: `?input` = five plain balls on a dark ground, wired to the whole input layer, with the events printed on the page. TEST ONLY: it is the proof for
// the phase, not part of the card (the acts give gestures their meaning from Phase 19 on).
//   big    (left)    hold it and it lights up; tap it and it pulses
//   mid    (right)   drag it about
//   tiny   (low)     only 20 px across on a phone: the generous touch radius is what makes it hittable
//   speck  (on big)  priority 1, so it wins over the big ball it sits on
//   far    (back)    behind the camera's reach of a tap: a miss test (disabled for the keyboard, picked only by a direct hit)
// Keyboard: Tab / arrows move a ring along the balls, Enter or Space presses, a held Enter is a hold, arrows while it is held drag, Escape cancels.
// Tilt: the camera leans a little with the phone (iOS: press the "tilt" button, it must be a tap); on a desktop the mouse gives a small share instead. `&reduced` = none.
// Every event is also pushed onto `window.__inputLog` (an array of plain objects) so a test run can read it.

export interface InputView {
  update(dt: number): void;
  render(tSec: number): void;
  resize(aspect: number, widthPx: number, heightPx: number): void;
  dispose(): void;
}

interface Ball {
  id: string;
  mesh: THREE.Mesh;
  base: THREE.Vector3;
  pulse: number;
  glow: number;
}

declare global {
  interface Window {
    __inputLog?: Record<string, unknown>[];
    __inputView?: { picker: Picker; input: Input; screen(id: string): { x: number; y: number; radiusPx: number } | null; parallax(): { x: number; y: number }; tiltState(): string };
  }
}

export function createInputView(ctx: { stage: Stage; scene: THREE.Scene; camera: THREE.PerspectiveCamera; canvas: HTMLCanvasElement; reduced: boolean }): InputView {
  const { scene, camera, canvas } = ctx;
  scene.background = new THREE.Color(0x0d1b2e);
  scene.add(new THREE.HemisphereLight('#bcd0ee', '#3a4a6a', 0.9));
  const key = new THREE.DirectionalLight('#ffffff', 2.2);
  key.position.set(-3, 4, 5);
  scene.add(key);

  const balls: Ball[] = [];
  const mk = (id: string, r: number, colour: string, x: number, y: number, z: number): Ball => {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(r, 28, 18), new THREE.MeshStandardMaterial({ color: colour, roughness: 0.8, emissive: '#ffcf8a', emissiveIntensity: 0 }));
    mesh.position.set(x, y, z);
    scene.add(mesh);
    const b: Ball = { id, mesh, base: mesh.position.clone(), pulse: 0, glow: 0 };
    balls.push(b);
    return b;
  };
  mk('big', 0.8, '#a7b9c3', -1.0, 0.3, 0);
  const mid = mk('mid', 0.4, '#9aa6d8', 1.2, 0.6, 0);
  mk('tiny', 0.1, '#f0c27a', 0.1, -1.1, 0.5);
  mk('speck', 0.07, '#e58fa8', -1.0, 1.05, 0.5);
  mk('far', 0.3, '#7fbf9a', 0.3, 1.2, -3);

  const picker = createPicker(camera);
  for (const b of balls) picker.add({ id: b.id, object: b.mesh, ...(b.id === 'speck' ? { priority: 1 } : {}), label: b.id });
  // the keyboard walks only the first four; 'far' is for the mouse and finger tests
  const kbIds = (): string[] => picker.ids().filter((i) => i !== 'far');

  const input = createInput({
    element: canvas,
    resolve: (x, y, kind) => picker.pick(x, y, kind),
    keyboard: { ids: kbIds, positionOf: (id) => picker.screenOf(id) },
    label: 'input test view',
  });
  const tilt = createTilt({ reducedMotion: ctx.reduced });
  const haptics = createHaptics();

  // ---- the page on top: the log, the status, two buttons, the focus ring (test only) ------------------------------------------------
  const ui = document.createElement('div');
  ui.style.cssText = 'position:fixed;left:0;right:0;bottom:0;padding:6px 8px;font:11px/1.35 ui-monospace,Menlo,monospace;color:#d6ecff;background:rgba(5,10,20,.55);pointer-events:none;z-index:5;white-space:pre-wrap';
  const logEl = document.createElement('div');
  const statEl = document.createElement('div');
  const btns = document.createElement('div');
  btns.style.cssText = 'pointer-events:auto;margin-top:4px;display:flex;gap:8px';
  const mkBtn = (id: string, text: string, fn: () => void): void => {
    const b = document.createElement('button');
    b.id = id;
    b.textContent = text;
    b.style.cssText = 'font:inherit;padding:6px 10px;border-radius:6px;border:1px solid #6f86b8;background:#1c3556;color:#d6ecff';
    b.addEventListener('click', fn);
    btns.appendChild(b);
  };
  mkBtn('btn-tilt', 'tilt', () => void tilt.request());
  mkBtn('btn-buzz', 'buzz', () => haptics.pulse('tap'));
  ui.append(logEl, statEl, btns);
  document.body.appendChild(ui);
  const ring = document.createElement('div');
  ring.style.cssText = 'position:fixed;display:none;border:2px solid #ffd9a0;border-radius:50%;pointer-events:none;z-index:4;transform:translate(-50%,-50%)';
  document.body.appendChild(ring);

  const lines: string[] = [];
  const log: Record<string, unknown>[] = (window.__inputLog = []);
  const say = (type: string, g?: GesturePayload, extra: Record<string, unknown> = {}): void => {
    const rec: Record<string, unknown> = { type, ...(g ? { target: g.target, kind: g.kind, x: Math.round(g.x), y: Math.round(g.y), dx: Math.round(g.dx), dy: Math.round(g.dy), ms: Math.round(g.duration), reason: g.reason } : {}), ...extra };
    log.push(rec);
    lines.push(g ? `${type} ${g.target ?? '-'} ${g.kind}${g.reason ? ' (' + g.reason + ')' : ''}` : `${type} ${JSON.stringify(extra)}`);
    while (lines.length > 6) lines.shift();
    logEl.textContent = lines.join('\n');
  };

  const byId = (id: string | null): Ball | undefined => balls.find((b) => b.id === id);
  let holding: Ball | null = null;
  let dragging: Ball | null = null;
  const off = [
    input.on('press', (g) => say('press', g)),
    input.on('tap', (g) => {
      say('tap', g);
      const b = byId(g.target);
      if (b) b.pulse = 1;
      haptics.pulse('tap');
    }),
    input.on('holdstart', (g) => {
      say('holdstart', g);
      holding = byId(g.target) ?? null;
      haptics.pulse('press');
    }),
    input.on('holdend', (g) => {
      say('holdend', g);
      holding = null;
    }),
    input.on('dragstart', (g) => {
      say('dragstart', g);
      dragging = byId(g.target) === mid ? mid : null;
    }),
    input.on('drag', (g) => {
      if (dragging) {
        const px = 1 / Math.max(1, (canvas.clientHeight / 2 / Math.tan((camera.fov * Math.PI) / 360)) / camera.position.z); // metres per px at the balls' depth
        dragging.base.x += g.ddx * px;
        dragging.base.y -= g.ddy * px;
      }
    }),
    input.on('dragend', (g) => {
      say('dragend', g);
      dragging = null;
    }),
    input.on('cancel', (g) => say('cancel', g)),
    input.on('focus', (f) => say('focus', undefined, { id: f.id })),
  ];
  tilt.onState((s) => say('tilt', undefined, { state: s }));

  let par = { x: 0, y: 0 };
  window.__inputView = { picker, input, screen: (id) => picker.screenOf(id), parallax: () => par, tiltState: () => tilt.state };

  return {
    update(dt) {
      tilt.step(dt);
      par = blendParallax({ tilt: tilt.value(), tiltState: tilt.state, pointer: input.pointer, reducedMotion: ctx.reduced });
      for (const b of balls) {
        b.pulse = Math.max(0, b.pulse - dt * 2.5);
        b.glow += ((b === holding ? 1 : 0) - b.glow) * (1 - Math.exp(-dt / (b === holding ? 0.9 : 0.25))); // the light rises slowly while held
        b.mesh.position.copy(b.base);
        b.mesh.scale.setScalar(1 + b.pulse * 0.15 * (ctx.reduced ? 0.4 : 1));
        (b.mesh.material as THREE.MeshStandardMaterial).emissiveIntensity = b.glow * 0.9;
      }
    },
    render() {
      camera.position.set(par.x * 0.3, par.y * 0.18, 6);
      camera.lookAt(0, 0.1, 0);
      statEl.textContent = `tilt ${tilt.state}  parallax ${par.x.toFixed(2)},${par.y.toFixed(2)}  buzz ${haptics.supported ? 'yes' : 'no'}  focus ${input.focusId ?? '-'}`;
      const f = input.focusId ? picker.screenOf(input.focusId) : null;
      if (f) {
        const r = canvas.getBoundingClientRect();
        const d = Math.max(36, f.radiusPx * 2 + 14);
        ring.style.display = 'block';
        ring.style.width = `${d}px`;
        ring.style.height = `${d}px`;
        ring.style.left = `${r.left + f.x}px`;
        ring.style.top = `${r.top + f.y}px`;
      } else ring.style.display = 'none';
    },
    resize(aspect, widthPx, heightPx) {
      picker.resize(widthPx, heightPx);
      camera.aspect = aspect;
      // the balls span about +-2.4 m across; a tall phone needs a wider field so every ball is on screen (half-height 1.9 m, or 2.6 m / aspect)
      camera.fov = (2 * Math.atan(Math.max(1.9, 2.6 / Math.max(0.2, aspect)) / 6) * 180) / Math.PI;
      camera.near = 0.1;
      camera.far = 50;
      camera.position.z = 6;
      camera.updateProjectionMatrix();
    },
    dispose() {
      for (const f of off) f();
      input.dispose();
      tilt.dispose();
      ui.remove();
      ring.remove();
    },
  };
}
