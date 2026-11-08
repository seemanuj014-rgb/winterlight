import type { ConstellationDef } from '../defs';

// Phase 22 `[A]` (the owner has not seen this): a strawberry. A wide, flat-topped body that narrows to a point, a leafy crown on top and a short stem.
// The top is flat on purpose (no notch), so it cannot read as a heart. Star ids start with `sb`.
export const STRAWBERRY: ConstellationDef = {
  id: 'strawberry',
  nodes: [
    { id: 'sb1', x: -0.62, y: 0.28 },
    { id: 'sb2', x: -0.28, y: 0.4 },
    { id: 'sb3', x: 0.28, y: 0.4 },
    { id: 'sb4', x: 0.62, y: 0.28 },
    { id: 'sb5', x: 0.44, y: -0.32 },
    { id: 'sb6', x: 0, y: -0.86, size: 1.25 },
    { id: 'sb7', x: -0.44, y: -0.32 },
    { id: 'sb8', x: -0.42, y: 0.7, size: 0.85 },
    { id: 'sb9', x: 0, y: 0.58, size: 1.1 },
    { id: 'sb10', x: 0.42, y: 0.7, size: 0.85 },
    { id: 'sb11', x: 0.04, y: 0.95, size: 0.8 },
  ],
  edges: [
    ['sb1', 'sb2'],
    ['sb2', 'sb3'],
    ['sb3', 'sb4'],
    ['sb4', 'sb5'],
    ['sb5', 'sb6'],
    ['sb6', 'sb7'],
    ['sb7', 'sb1'],
    ['sb2', 'sb8'],
    ['sb8', 'sb9'],
    ['sb9', 'sb10'],
    ['sb10', 'sb3'],
    ['sb9', 'sb11'],
  ],
};
