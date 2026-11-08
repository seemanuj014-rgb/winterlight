import * as THREE from 'three';
import { DOOR } from './cabinMath';

// Phase 14: two optional door props: a small plaque and a hanging sign. They are OFF by default and they carry NO text of their own: the words are passed in by
// the caller (from `content/`, once the owner has said yes), so nothing the owner has not approved is in the shipped code. A prop with no text cannot be shown.
// Built lazily: nothing is created (no canvas, no texture, no mesh) until it is shown the first time. When shown, each costs 2 draw calls.

export interface DoorPropsText {
  plaque?: string;
  sign?: string;
}

export interface DoorProps {
  /** which props exist (have text) */
  has(kind: 'plaque' | 'sign'): boolean;
  visible(kind: 'plaque' | 'sign'): boolean;
  setVisible(kind: 'plaque' | 'sign', on: boolean): void;
  dispose(): void;
}

function labelTexture(text: string, w: number, h: number, bg: string, fg: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);
  g.fillStyle = fg;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  let px = Math.floor(h * 0.6);
  const font = (p: number): string => `600 ${p}px "Trebuchet MS", system-ui, sans-serif`;
  g.font = font(px);
  while (g.measureText(text).width > w * 0.88 && px > 8) {
    px -= 2;
    g.font = font(px);
  }
  g.fillText(text, w / 2, h / 2 + px * 0.04);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 2;
  return t;
}

/** `door` is the cabin's door pivot (hinge at the origin, panel along +x, front toward +z). The props swing with it. */
export function createDoorProps(door: THREE.Group, text: DoorPropsText): DoorProps {
  const made: Partial<Record<'plaque' | 'sign', THREE.Group>> = {};
  const disposables: { dispose(): void }[] = [];
  const spec = {
    plaque: { text: text.plaque?.trim(), w: 0.42, h: 0.2, x: DOOR.w / 2, y: DOOR.h * 0.9, tex: [168, 80], hang: false },
    sign: { text: text.sign?.trim(), w: 0.62, h: 0.26, x: DOOR.w / 2, y: DOOR.h * 0.5, tex: [248, 104], hang: true },
  } as const;

  function build(kind: 'plaque' | 'sign'): THREE.Group | undefined {
    const s = spec[kind];
    if (!s.text) return undefined;
    const group = new THREE.Group();
    group.name = `door-${kind}`;
    group.position.set(s.x, s.y, DOOR.t / 2 + 0.025);
    const board = new THREE.Mesh(new THREE.BoxGeometry(s.w + 0.04, s.h + 0.04, 0.03), new THREE.MeshBasicMaterial({ color: 0x3d2f2a }));
    const tex = labelTexture(s.text, s.tex[0], s.tex[1], '#d9cdb8', '#2b2f38');
    const face = new THREE.Mesh(new THREE.PlaneGeometry(s.w, s.h), new THREE.MeshBasicMaterial({ map: tex }));
    face.position.z = 0.017;
    group.add(board, face);
    disposables.push(board.geometry, board.material as THREE.Material, face.geometry, face.material as THREE.Material, tex);
    if (s.hang) {
      // two thin cords up to a nail
      for (const dx of [-0.2, 0.2]) {
        const cord = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.16, 0.012), new THREE.MeshBasicMaterial({ color: 0x2b2f38 }));
        cord.position.set(dx, s.h / 2 + 0.08, 0);
        group.add(cord);
        disposables.push(cord.geometry, cord.material as THREE.Material);
      }
    }
    group.visible = false;
    door.add(group);
    return group;
  }

  return {
    has: (k) => Boolean(spec[k].text),
    visible: (k) => made[k]?.visible ?? false,
    setVisible(k, on) {
      if (on && !made[k]) made[k] = build(k);
      const g = made[k];
      if (g) g.visible = on;
    },
    dispose() {
      for (const g of Object.values(made)) g?.removeFromParent();
      for (const d of disposables) d.dispose();
    },
  };
}
