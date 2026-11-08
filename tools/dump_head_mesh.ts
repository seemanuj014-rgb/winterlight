// Phase 6: writes the built head (all parts, world space) to JSON so tools/fidelity.py can render it without a GPU.
// Pure: it uses only src/character/chamgadad/parts.ts (no three).
// Run:  npx tsx tools/dump_head_mesh.ts out/head_mesh.json
// (In the Phase 6 sandbox, which had no network, this file was bundled with esbuild and run with node instead; tsx itself was not run.)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { buildHeadParts, patchWeight, INK_PX, INK_WORLD, type PartsJson, type BuiltEar } from '../src/character/chamgadad/parts';
import { computeNormals, type InflatedMesh } from '../src/character/chamgadad/inflate';

const out = process.argv[2] ?? 'out/head_mesh.json';
const parts = JSON.parse(readFileSync('character/traced/chamgadad_ref_01_head_front.parts.json', 'utf8')) as PartsJson;
const C = (JSON.parse(readFileSync('character/palette.json', 'utf8')) as { colors: Record<string, string> }).colors;
const built = buildHeadParts(parts);

const hex = (h: string): [number, number, number] => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];
const solid = (m: InflatedMesh, c: string): number[] => Array.from({ length: m.positions.length / 3 }, () => hex(c)).flat();
const bowlColors = (m: InflatedMesh, ear: BuiltEar, base: string): number[] => {
  const a = hex(base), b = hex(C.ear_inner_lavender!);
  const res: number[] = [];
  for (let v = 0; v < m.positions.length / 3; v++) {
    const w = ear.patch ? patchWeight(m.positions[v * 3]!, m.positions[v * 3 + 1]!, ear.patch) : 0;
    res.push(a[0] + (b[0] - a[0]) * w, a[1] + (b[1] - a[1]) * w, a[2] + (b[2] - a[2]) * w);
  }
  return res;
};
const part = (name: string, m: InflatedMesh, colors: number[]) => ({
  name,
  positions: Array.from(m.positions),
  normals: Array.from(computeNormals(m.positions, m.indices)),
  indices: Array.from(m.indices),
  colors,
  rimCount: m.rim.length,
  frontZMax: m.frontZMax,
  backZMin: m.backZMin,
});

const dump = {
  note: 'Phase 6 head, world space (x right, y up, z to viewer). Reference frame: 4 units square, u = x/4 + 0.5, v = 0.5 - y/4.',
  inkPx: INK_PX,
  inkWorld: INK_WORLD,
  headCentre: built.head.centre,
  headFrontZMax: built.head.frontZMax,
  parts: [
    part('neck', built.neck, solid(built.neck, C.body_chest!)),
    part('ear-upright-flap', built.earUpright.flap, solid(built.earUpright.flap, C.ear_back_shadow_teal!)),
    part('ear-upright-bowl', built.earUpright.bowl, bowlColors(built.earUpright.bowl, built.earUpright, C.ear_front_pale_blue!)),
    part('ear-angled-flap', built.earAngled.flap, solid(built.earAngled.flap, C.ear_back_shadow_teal!)),
    part('ear-angled-bowl', built.earAngled.bowl, bowlColors(built.earAngled.bowl, built.earAngled, C.ear_right_pale_blue!)),
    part('head', built.head, solid(built.head, C.body_base!)),
  ],
};
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify(dump));
console.log(`wrote ${out}: ${dump.parts.map((p) => `${p.name} ${p.indices.length / 3} tris`).join(', ')}`);
