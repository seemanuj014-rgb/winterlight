// Phase 21: the data format of a constellation, and the check that a definition is playable. Pure (no three, no DOM).
// A `ConstellationDef` is just data: stars (nodes) at points on a flat plane, lines (edges) between them, and optionally an order. The five real shapes (Phase 22) are
// five of these; this phase ships only a plain demo so the engine has something to run on. Nothing here says what a shape is OF.
//
// Plane: x to the right, y UP, both about -1..1 (the placement in the sky scales it). Edges are undirected: a line can be drawn from either end.

export interface StarNode {
  id: string;
  x: number;
  y: number;
  /** how big the star looks, 0.6..1.6, default 1 (a visual hint only; picking is generous whatever it is) */
  size?: number;
}

export interface ConstellationDef {
  /** matches an id in content/names.json for the five real ones; any string for a test shape */
  id: string;
  nodes: StarNode[];
  /** pairs of node ids */
  edges: [string, string][];
  /** optional: edge indices in the order they must be drawn. Absent = any order. Must list every edge once. */
  order?: number[];
  /** `[A]` how close (plane units) a finger must come to a star to snap onto it. Default SNAP_DEFAULT. */
  snap?: number;
}

/** `[A]` 0.11 of a plane whose stars sit within about -1..1: a finger's snap circle is about a tenth of the shape's half-width. */
export const SNAP_DEFAULT = 0.11;
/** `[A]` the closest two stars may be, as a multiple of the snap radius, so a finger never snaps to the wrong one of a pair */
export const MIN_GAP_FACTOR = 1.7;
export const MAX_NODES = 40;

export interface DefReport {
  ok: boolean;
  errors: string[];
}

/** Everything that would make a shape unplayable, in plain words. Never throws, never returns NaN. */
export function validateDef(def: ConstellationDef): DefReport {
  const errors: string[] = [];
  if (!def || typeof def !== 'object') return { ok: false, errors: ['not an object'] };
  if (typeof def.id !== 'string' || def.id === '') errors.push('id is empty');
  const nodes = Array.isArray(def.nodes) ? def.nodes : [];
  const edges = Array.isArray(def.edges) ? def.edges : [];
  if (nodes.length < 2) errors.push('needs at least 2 stars');
  if (nodes.length > MAX_NODES) errors.push(`more than ${MAX_NODES} stars`);
  if (edges.length < 1) errors.push('needs at least 1 line');
  const ids = new Set<string>();
  for (const n of nodes) {
    if (typeof n?.id !== 'string' || n.id === '') errors.push('a star has no id');
    else if (ids.has(n.id)) errors.push(`duplicate star id ${n.id}`);
    else ids.add(n.id);
    if (!Number.isFinite(n?.x) || !Number.isFinite(n?.y)) errors.push(`star ${n?.id} has a bad position`);
    else if (Math.abs(n.x) > 1.25 || Math.abs(n.y) > 1.25) errors.push(`star ${n.id} is outside the plane (-1.25..1.25)`);
    if (n?.size !== undefined && !(n.size >= 0.6 && n.size <= 1.6)) errors.push(`star ${n.id} size must be 0.6..1.6`);
  }
  const seen = new Set<string>();
  const touched = new Set<string>();
  edges.forEach((e, i) => {
    if (!Array.isArray(e) || e.length !== 2) return void errors.push(`line ${i} is not a pair`);
    const [a, b] = e;
    if (!ids.has(a) || !ids.has(b)) return void errors.push(`line ${i} names a star that does not exist`);
    if (a === b) return void errors.push(`line ${i} joins a star to itself`);
    const k = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (seen.has(k)) errors.push(`line ${i} repeats ${a}-${b}`);
    seen.add(k);
    touched.add(a);
    touched.add(b);
  });
  for (const id of ids) if (!touched.has(id)) errors.push(`star ${id} has no line`);
  if (def.order !== undefined) {
    const o = def.order;
    const okOrder = Array.isArray(o) && o.length === edges.length && new Set(o).size === o.length && o.every((v) => Number.isInteger(v) && v >= 0 && v < edges.length);
    if (!okOrder) errors.push('order must list every line index exactly once');
  }
  const snap = def.snap ?? SNAP_DEFAULT;
  if (!(snap > 0.02 && snap < 0.4)) errors.push('snap must be between 0.02 and 0.4');
  else {
    const gap = snap * MIN_GAP_FACTOR;
    for (let i = 0; i < nodes.length; i++)
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i]!;
        const b = nodes[j]!;
        if (Number.isFinite(a.x + a.y + b.x + b.y) && Math.hypot(a.x - b.x, a.y - b.y) < gap) errors.push(`stars ${a.id} and ${b.id} are closer than ${gap.toFixed(2)}`);
      }
  }
  return { ok: errors.length === 0, errors };
}

/** a test shape: seven stars, a kite with a tail, any order */
export const DEMO_KITE: ConstellationDef = {
  id: 'demo-kite',
  nodes: [
    { id: 'a', x: 0, y: 0.8, size: 1.3 },
    { id: 'b', x: 0.55, y: 0.15 },
    { id: 'c', x: 0, y: -0.35, size: 1.15 },
    { id: 'd', x: -0.55, y: 0.15 },
    { id: 'e', x: 0.1, y: -0.62 },
    { id: 'f', x: -0.3, y: -0.9, size: 0.85 },
    { id: 'g', x: 0.35, y: -0.95, size: 0.85 },
  ],
  edges: [
    ['a', 'b'],
    ['b', 'c'],
    ['c', 'd'],
    ['d', 'a'],
    ['c', 'e'],
    ['e', 'f'],
    ['e', 'g'],
  ],
};

/** the same kind of shape, but a single path that must be drawn in order (for the ordered mode) */
export const DEMO_PATH: ConstellationDef = {
  id: 'demo-path',
  nodes: [
    { id: 'p1', x: -0.85, y: -0.4 },
    { id: 'p2', x: -0.45, y: 0.3 },
    { id: 'p3', x: 0.05, y: -0.2, size: 1.3 },
    { id: 'p4', x: 0.5, y: 0.5 },
    { id: 'p5', x: 0.85, y: -0.3 },
  ],
  edges: [
    ['p1', 'p2'],
    ['p2', 'p3'],
    ['p3', 'p4'],
    ['p4', 'p5'],
  ],
  order: [0, 1, 2, 3],
};

export const DEMO_DEFS: Record<string, ConstellationDef> = { kite: DEMO_KITE, path: DEMO_PATH };
