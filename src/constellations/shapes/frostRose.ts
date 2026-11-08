import type { ConstellationDef } from '../defs';

// Phase 22 `[A]`: ONE frost rose (one flower, not a bouquet): a cup of petals (seven stars), a small curl inside it, a stem with a single leaf. Star ids start with `rs`.
export const FROST_ROSE: ConstellationDef = {
  id: 'rose',
  nodes: [
    { id: 'rs1', x: -0.58, y: 0.52 },
    { id: 'rs2', x: -0.3, y: 0.86 },
    { id: 'rs3', x: 0.3, y: 0.86 },
    { id: 'rs4', x: 0.58, y: 0.52 },
    { id: 'rs5', x: 0.34, y: 0.1 },
    { id: 'rs6', x: 0, y: -0.06, size: 1.2 },
    { id: 'rs7', x: -0.34, y: 0.1 },
    { id: 'rs8', x: -0.12, y: 0.62, size: 0.9 },
    { id: 'rs9', x: 0.16, y: 0.48, size: 0.9 },
    { id: 'rs10', x: -0.04, y: 0.26, size: 0.85 },
    { id: 'rs11', x: 0, y: -0.46 },
    { id: 'rs12', x: 0.02, y: -0.94 },
    { id: 'rs13', x: 0.46, y: -0.62, size: 0.9 },
  ],
  edges: [
    ['rs1', 'rs2'],
    ['rs2', 'rs3'],
    ['rs3', 'rs4'],
    ['rs4', 'rs5'],
    ['rs5', 'rs6'],
    ['rs6', 'rs7'],
    ['rs7', 'rs1'],
    ['rs2', 'rs8'],
    ['rs8', 'rs9'],
    ['rs9', 'rs10'],
    ['rs6', 'rs11'],
    ['rs11', 'rs12'],
    ['rs11', 'rs13'],
    ['rs13', 'rs12'],
  ],
};
