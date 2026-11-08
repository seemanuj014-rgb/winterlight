import * as THREE from 'three';
import { makeToon, TOON_LIGHT_INTENSITY } from './material';

/**
 * Phase 3 test rig: a sphere, a bean and a cone at three sizes, in her body colour, to judge the
 * toon ramp, the rim and the ink line. Shown with `?rig` (3x3 grid) or `?rig=big` (the large three only).
 */
export interface Rig {
  group: THREE.Group;
  /** Place the objects and return the camera distance that frames them for this aspect ratio. */
  layout(aspect: number, fovDeg: number): number;
  update(timeSec: number, reduced: boolean): void;
  dispose(): void;
}

export function buildToonRig(mode: 'grid' | 'big'): Rig {
  const group = new THREE.Group();
  const toon = makeToon({ base: '#a7b9c3' });

  const sphere = new THREE.SphereGeometry(1, 40, 28);
  const bean = new THREE.CapsuleGeometry(0.7, 0.9, 10, 28);
  bean.scale(1.12, 1, 0.85);
  const cone = new THREE.ConeGeometry(0.9, 2, 36, 1);
  cone.translate(0, 0, 0);
  const geoms = [sphere, bean, cone];
  const sizes = mode === 'big' ? [1] : [0.3, 0.6, 1];

  const items: { mesh: THREE.Mesh; row: number; col: number; baseRotZ: number }[] = [];
  geoms.forEach((g, row) => {
    sizes.forEach((s, col) => {
      const mesh = toon.mesh(g);
      mesh.scale.setScalar(s);
      const baseRotZ = g === bean ? -0.45 : 0;
      mesh.rotation.z = baseRotZ;
      group.add(mesh);
      items.push({ mesh, row, col, baseRotZ });
    });
  });

  // White key from the front right, intensity PI so the top ramp step equals the base colour exactly.
  const key = new THREE.DirectionalLight('#ffffff', TOON_LIGHT_INTENSITY);
  key.position.set(3, 4, 5);
  group.add(key);

  const CELL = 3.2;
  return {
    group,
    layout(aspect, fovDeg) {
      const cols = sizes.length;
      const rows = geoms.length;
      const portrait = aspect < 1;
      // grid: rows = shapes, cols = sizes. big: the three shapes in a column (portrait) or a row (landscape).
      items.forEach((it) => {
        let gx: number, gy: number;
        if (mode === 'grid') {
          gx = (it.col - (cols - 1) / 2) * CELL;
          gy = ((rows - 1) / 2 - it.row) * CELL;
        } else if (portrait) {
          gx = 0;
          gy = ((rows - 1) / 2 - it.row) * CELL * 1.05;
        } else {
          gx = (it.row - (rows - 1) / 2) * CELL * 1.05;
          gy = 0;
        }
        it.mesh.position.set(gx, gy, 0);
      });
      let w: number, h: number;
      if (mode === 'grid') {
        w = cols * CELL + 0.6;
        h = rows * CELL + 0.6;
      } else if (portrait) {
        w = CELL * 1.0 + 1.2;
        h = rows * CELL * 1.05 + 0.6;
      } else {
        w = rows * CELL * 1.05 + 0.6;
        h = CELL * 1.0 + 1.2;
      }
      const t = Math.tan((fovDeg * Math.PI) / 360);
      return Math.max(h / 2 / t, w / 2 / aspect / t);
    },
    update(timeSec, reduced) {
      for (const it of items) {
        it.mesh.rotation.y = reduced ? 0.35 : 0.35 + Math.sin(timeSec / 1.5 + it.row) * 0.5;
        it.mesh.rotation.x = 0.12;
      }
    },
    dispose() {
      toon.dispose();
      for (const g of geoms) g.dispose();
    },
  };
}
