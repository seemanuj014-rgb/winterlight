import type { ConstellationDef } from '../defs';

// Phase 22 `[A]`: a diamond for kaaju katli (the sweet is cut in diamonds): a rhombus, a star in the middle and the line across it. The simplest of the five. Ids start with `kk`.
export const DIAMOND: ConstellationDef = {
  id: 'kaaju-katli',
  nodes: [
    { id: 'kk1', x: 0, y: 0.88, size: 1.15 },
    { id: 'kk2', x: 0.72, y: 0 },
    { id: 'kk3', x: 0, y: -0.88, size: 1.15 },
    { id: 'kk4', x: -0.72, y: 0 },
    { id: 'kk5', x: 0, y: 0, size: 1.3 },
  ],
  edges: [
    ['kk1', 'kk2'],
    ['kk2', 'kk3'],
    ['kk3', 'kk4'],
    ['kk4', 'kk1'],
    ['kk4', 'kk5'],
    ['kk5', 'kk2'],
  ],
};
