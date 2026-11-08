import type { ConstellationDef } from '../defs';

// Phase 22 `[A]`: a cat's head (two pointed ears) and a bunny's head (two long ears) side by side, joined by one short line between their cheeks: two friends, nothing more.
// Not a heart, not a pair of anything romantic. Star ids start with `cp`.
export const CAT_AND_BUNNY: ConstellationDef = {
  id: 'cutie-patootie',
  nodes: [
    // the cat (left)
    { id: 'cp1', x: -0.92, y: 0.5 },
    { id: 'cp2', x: -0.62, y: 0.28, size: 0.85 },
    { id: 'cp3', x: -0.32, y: 0.5 },
    { id: 'cp4', x: -0.2, y: -0.05 },
    { id: 'cp5', x: -0.6, y: -0.4, size: 1.15 },
    { id: 'cp6', x: -1.0, y: -0.05 },
    // the bunny (right)
    { id: 'cp7', x: 0.4, y: 0.96 },
    { id: 'cp8', x: 0.6, y: 0.3, size: 0.85 },
    { id: 'cp9', x: 0.8, y: 0.96 },
    { id: 'cp10', x: 0.9, y: 0.4 },
    { id: 'cp11', x: 0.96, y: -0.05 },
    { id: 'cp12', x: 0.6, y: -0.4, size: 1.15 },
    { id: 'cp13', x: 0.24, y: -0.05 },
    { id: 'cp14', x: 0.3, y: 0.4 },
  ],
  edges: [
    ['cp1', 'cp2'],
    ['cp2', 'cp3'],
    ['cp3', 'cp4'],
    ['cp4', 'cp5'],
    ['cp5', 'cp6'],
    ['cp6', 'cp1'],
    ['cp8', 'cp7'],
    ['cp7', 'cp14'],
    ['cp14', 'cp13'],
    ['cp13', 'cp12'],
    ['cp12', 'cp11'],
    ['cp11', 'cp10'],
    ['cp10', 'cp9'],
    ['cp9', 'cp8'],
    ['cp4', 'cp13'],
  ],
};
