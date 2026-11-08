import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { validateDef } from '../src/constellations/defs';
import { ConstellationMachine } from '../src/constellations/engine';
import { SHAPES, SHAPE_ORDER } from '../src/constellations/shapes';
import { SkyRouter, currentShape } from '../src/constellations/routeMath';
import { restoreShape } from '../src/constellations/sky';
import { createProgress, createMemoryStorage, parseProgress, PROGRESS_KEY } from '../src/state/progress';
import names from '../content/names.json';

// Phase 22: the five shapes are playable, every name has a shape and a wish slot, the router sends gestures to the right shape, a finished shape is restored silently, progress persists.
const wishes = JSON.parse(readFileSync('content/wishes.json', 'utf8')) as Record<string, unknown>;
const cons = names.constellations;

describe('the five shapes', () => {
  it('every name in names.json has a shape whose id matches it', () => {
    expect(cons).toHaveLength(5);
    for (const c of cons) {
      const def = SHAPES[c.shape];
      expect(def, `shape "${c.shape}" for ${c.id}`).toBeDefined();
      expect(def!.id).toBe(c.id);
    }
  });
  it('every name has a wish slot in wishes.json (a string; the owner writes it)', () => {
    for (const c of cons) expect(typeof wishes[c.id], `wish for ${c.id}`).toBe('string');
  });
  it('wishes.json has no slot without a name', () => {
    const slots = Object.keys(wishes).filter((k) => !k.startsWith('_'));
    expect(slots.sort()).toEqual(cons.map((c) => c.id).sort());
  });
  it('the discovery order is the order of names.json, and no shape is unused', () => {
    expect(cons.map((c) => c.id)).toEqual([...SHAPE_ORDER]);
    expect(Object.keys(SHAPES).sort()).toEqual(cons.map((c) => c.shape).sort());
  });
  it('each shape is valid and playable', () => {
    for (const [k, d] of Object.entries(SHAPES)) expect(validateDef(d), k).toEqual({ ok: true, errors: [] });
  });
  it('star ids are unique across all five (one picker serves them)', () => {
    const seen = new Set<string>();
    for (const d of Object.values(SHAPES))
      for (const n of d.nodes) {
        expect(seen.has(n.id), n.id).toBe(false);
        seen.add(n.id);
      }
  });
  it('stars stay inside the patch (-1.25..1.25) and every shape has at least 5 stars', () => {
    for (const [k, d] of Object.entries(SHAPES)) {
      expect(d.nodes.length, k).toBeGreaterThanOrEqual(5);
      for (const n of d.nodes) {
        expect(Math.abs(n.x), `${k} ${n.id} x`).toBeLessThanOrEqual(1.25);
        expect(Math.abs(n.y), `${k} ${n.id} y`).toBeLessThanOrEqual(1.25);
      }
    }
  });
  it('each shape can be finished by its own lines, once, and says complete', () => {
    for (const [k, d] of Object.entries(SHAPES)) {
      const m = new ConstellationMachine(d);
      const order = d.order ?? d.edges.map((_, i) => i);
      let t = 1;
      for (const i of order) {
        const [a, b] = d.edges[i]!;
        const pa = m.position(a)!;
        const pb = m.position(b)!;
        m.beginDrag(a, pa.x, pa.y, t);
        m.move(pb.x, pb.y, (t += 0.1));
        m.release((t += 0.1));
      }
      expect(m.state().complete, k).toBe(true);
      expect(m.log.filter((e) => e.type === 'complete'), k).toHaveLength(1);
    }
  });
});

describe('SkyRouter', () => {
  const ids = [...SHAPE_ORDER];
  const owner = (s: string): string | null => {
    for (const [, d] of Object.entries(SHAPES)) if (d.nodes.some((n) => n.id === s)) return d.id;
    return null;
  };
  const star = (id: string): string => SHAPES[cons.find((c) => c.id === id)!.shape]!.nodes[0]!.id;
  const mk = (done: string[] = []) => new SkyRouter({ ownerOf: owner, isDone: (id) => done.includes(id) }, ids);

  it('a tap goes to the shape that owns the star; the others let go', () => {
    const r = mk().tap(star('rose'));
    expect(r).toEqual({ to: 'rose', reshow: null, release: ids.filter((i) => i !== 'rose') });
  });
  it('a tap on a finished shape asks for its wish again and plays nothing', () => {
    const r = mk(['rose']).tap(star('rose'));
    expect(r.to).toBeNull();
    expect(r.reshow).toBe('rose');
    expect(r.release).toEqual(ids);
  });
  it('a tap on nothing, or on an unknown star, releases everyone and plays nothing', () => {
    for (const t of [null, 'zz-nope']) {
      const r = mk().tap(t);
      expect(r).toEqual({ to: null, reshow: null, release: ids });
    }
  });
  it('a drag belongs to the shape it started on, from start to end', () => {
    const r = mk();
    expect(r.dragStart(star('bumblebee')).to).toBe('bumblebee');
    expect(r.dragging).toBe('bumblebee');
    expect(r.dragEnd()).toBe('bumblebee');
    expect(r.dragging).toBeNull();
    expect(r.dragEnd()).toBeNull();
  });
  it('a drag that starts on nothing or on a finished shape goes nowhere', () => {
    expect(mk().dragStart(null).to).toBeNull();
    expect(mk().dragStart('zz-nope').to).toBeNull();
    const r = mk(['strawberry']);
    expect(r.dragStart(star('strawberry')).to).toBeNull();
    expect(r.dragging).toBeNull();
  });
  it('a new drag replaces the old owner', () => {
    const r = mk();
    r.dragStart(star('rose'));
    r.dragStart(star('kaaju-katli'));
    expect(r.dragging).toBe('kaaju-katli');
  });
});

describe('currentShape (the one that may hint)', () => {
  const none = () => 0;
  it('the first unfinished shape in discovery order', () => {
    expect(currentShape(SHAPE_ORDER, () => false, none, null)).toBe('strawberry');
    expect(currentShape(SHAPE_ORDER, (i) => i === 'strawberry', none, null)).toBe('bumblebee');
  });
  it('a half-made shape wins; the last touched half-made one wins over the others', () => {
    const prog = (i: string) => (i === 'rose' || i === 'bumblebee' ? 0.4 : 0);
    expect(currentShape(SHAPE_ORDER, () => false, prog, null)).toBe('bumblebee');
    expect(currentShape(SHAPE_ORDER, () => false, prog, 'rose')).toBe('rose');
  });
  it('a finished or untouched last-touched shape does not count', () => {
    expect(currentShape(SHAPE_ORDER, (i) => i === 'rose', () => 0.5, 'rose')).toBe('strawberry');
    expect(currentShape(SHAPE_ORDER, () => false, none, 'rose')).toBe('strawberry');
  });
  it('null when all five are done', () => {
    expect(currentShape(SHAPE_ORDER, () => true, none, null)).toBeNull();
  });
});

describe('restoring a finished shape (silently)', () => {
  it('replaying the lines finishes each shape and snaps the picture once', () => {
    for (const [k, d] of Object.entries(SHAPES)) {
      const engine = new ConstellationMachine(d);
      const snaps: unknown[] = [];
      restoreShape({ engine, fx: { snapTo: (s: unknown) => snaps.push(s) } } as never);
      expect(engine.state().complete, k).toBe(true);
      expect(engine.state().drawn, k).toHaveLength(d.edges.length);
      expect(snaps, k).toHaveLength(1);
    }
  });
});

describe('progress persistence', () => {
  const known = cons.map((c) => c.id);
  it('a finished shape is still finished after a reload (same storage, new store)', () => {
    const storage = createMemoryStorage();
    const a = createProgress({ storage, knownConstellations: known });
    expect(a.markConstellation('rose')).toBe(true);
    expect(a.markConstellation('rose')).toBe(false);
    const b = createProgress({ storage, knownConstellations: known });
    expect(b.get().constellations).toEqual(['rose']);
  });
  it('ids the card does not know are not saved', () => {
    const p = createProgress({ storage: createMemoryStorage(), knownConstellations: known });
    expect(p.markConstellation('moon-cake')).toBe(false);
    expect(p.get().constellations).toEqual([]);
  });
  it('a saved unknown id is simply ignored by the sky, a corrupt save is a clean start', () => {
    const storage = createMemoryStorage();
    storage.setItem(PROGRESS_KEY, JSON.stringify({ v: 1, constellations: ['rose', 'moon-cake'], letterRead: false, secrets: [] }));
    const got = createProgress({ storage, knownConstellations: known }).get().constellations;
    expect(known.filter((k) => got.includes(k))).toEqual(['rose']);
    expect(parseProgress('{not json').constellations).toEqual([]);
  });
});
