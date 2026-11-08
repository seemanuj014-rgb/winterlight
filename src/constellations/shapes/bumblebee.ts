import type { ConstellationDef } from '../defs';

// Phase 22 `[A]`: a bumblebee seen from the side, facing left: an oval body (seven stars), two stripes across it, two wings standing up from the middle of its back, two
// feelers and a stinger. Star ids start with `bb`.
export const BUMBLEBEE: ConstellationDef = {
  id: 'bumblebee',
  nodes: [
    { id: 'bb1', x: -0.72, y: -0.1, size: 1.15 }, // face
    { id: 'bb2', x: -0.4, y: 0.2 },
    { id: 'bb3', x: 0, y: 0.3 }, // middle of the back
    { id: 'bb4', x: 0.4, y: 0.2 },
    { id: 'bb5', x: 0.7, y: -0.1 },
    { id: 'bb6', x: 0.38, y: -0.44 },
    { id: 'bb7', x: -0.38, y: -0.44 },
    { id: 'bb8', x: -0.2, y: 0.84, size: 0.9 }, // wing tips
    { id: 'bb9', x: 0.5, y: 0.72, size: 0.9 },
    { id: 'bb10', x: -1.02, y: 0.2, size: 0.8 }, // feelers
    { id: 'bb11', x: -0.86, y: 0.5, size: 0.8 },
    { id: 'bb12', x: 1.04, y: -0.22, size: 0.85 }, // stinger
  ],
  edges: [
    ['bb1', 'bb2'],
    ['bb2', 'bb3'],
    ['bb3', 'bb4'],
    ['bb4', 'bb5'],
    ['bb5', 'bb6'],
    ['bb6', 'bb7'],
    ['bb7', 'bb1'],
    ['bb2', 'bb7'],
    ['bb4', 'bb6'],
    ['bb3', 'bb8'],
    ['bb8', 'bb2'],
    ['bb3', 'bb9'],
    ['bb9', 'bb4'],
    ['bb1', 'bb10'],
    ['bb1', 'bb11'],
    ['bb5', 'bb12'],
  ],
};
