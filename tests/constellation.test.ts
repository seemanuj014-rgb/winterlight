import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { ConstellationMachine, HINT_AFTER, WRONG_COOLDOWN, type EngineEvent } from '../src/constellations/engine';
import { validateDef, DEMO_KITE, DEMO_PATH, DEMO_DEFS, SNAP_DEFAULT, MIN_GAP_FACTOR, type ConstellationDef } from '../src/constellations/defs';

const types = (ev: EngineEvent[]): string[] => ev.map((e) => e.type);
const at = (m: ConstellationMachine, id: string): [number, number] => {
  const p = m.position(id)!;
  return [p.x, p.y];
};
/** drag from star `a` through the listed stars, finger exactly on each */
function dragThrough(m: ConstellationMachine, ids: string[], t0 = 1): EngineEvent[] {
  const out: EngineEvent[] = [];
  out.push(...m.beginDrag(ids[0]!, ...at(m, ids[0]!), t0));
  ids.slice(1).forEach((id, i) => out.push(...m.move(...at(m, id), t0 + 0.1 * (i + 1))));
  return out;
}

describe('validateDef', () => {
  it('the demo shapes are playable', () => {
    for (const d of Object.values(DEMO_DEFS)) expect(validateDef(d)).toEqual({ ok: true, errors: [] });
  });
  const base = (): ConstellationDef => JSON.parse(JSON.stringify(DEMO_KITE));
  it('catches each kind of broken shape', () => {
    const bad = (f: (d: ConstellationDef) => void): string[] => {
      const d = base();
      f(d);
      return validateDef(d).errors;
    };
    expect(bad((d) => (d.id = ''))).toContain('id is empty');
    expect(bad((d) => d.nodes.push({ id: 'a', x: 0.9, y: 0.9 })).join()).toMatch(/duplicate star id a/);
    expect(bad((d) => (d.edges[0] = ['a', 'zzz'])).join()).toMatch(/does not exist/);
    expect(bad((d) => (d.edges[0] = ['a', 'a'])).join()).toMatch(/itself/);
    expect(bad((d) => d.edges.push(['b', 'a'])).join()).toMatch(/repeats/);
    expect(bad((d) => d.nodes.push({ id: 'lonely', x: 0.9, y: 0.9 })).join()).toMatch(/no line/);
    expect(bad((d) => (d.nodes[0]!.x = Number.NaN)).join()).toMatch(/bad position/);
    expect(bad((d) => (d.nodes[0]!.x = 3)).join()).toMatch(/outside the plane/);
    expect(bad((d) => (d.nodes[0]!.size = 4)).join()).toMatch(/size/);
    expect(bad((d) => (d.order = [0, 1])).join()).toMatch(/order/);
    expect(bad((d) => (d.order = [0, 0, 1, 2, 3, 4, 5])).join()).toMatch(/order/);
    expect(bad((d) => (d.snap = 0.9)).join()).toMatch(/snap/);
    expect(bad((d) => (d.nodes[1]!.x = d.nodes[0]!.x + 0.01, d.nodes[1]!.y = d.nodes[0]!.y)).join()).toMatch(/closer than/);
    expect(bad((d) => (d.nodes = d.nodes.slice(0, 1))).join()).toMatch(/at least 2/);
  });
  it('never throws on rubbish', () => {
    for (const x of [null, undefined, 5, 'x', {}, { id: 'a' }, { id: 'a', nodes: 3, edges: 'x' }]) expect(() => validateDef(x as never)).not.toThrow();
    expect(validateDef(null as never).ok).toBe(false);
  });
  it('the constructor refuses an unplayable shape', () => {
    const d = JSON.parse(JSON.stringify(DEMO_KITE)) as ConstellationDef;
    d.edges[0] = ['a', 'a'];
    expect(() => new ConstellationMachine(d)).toThrow(/not playable/);
  });
  it('the gap rule is the one the engine relies on', () => {
    const d = base();
    d.nodes[1]!.x = d.nodes[0]!.x + SNAP_DEFAULT * MIN_GAP_FACTOR + 0.001;
    d.nodes[1]!.y = d.nodes[0]!.y;
    expect(validateDef(d).errors.join()).not.toMatch(/closer than/);
  });
});

describe('dragging a line', () => {
  it('starts on a star that has a line, and says so', () => {
    const m = new ConstellationMachine(DEMO_KITE);
    expect(types(m.beginDrag('a', ...at(m, 'a'), 1))).toEqual(['start']);
    expect(m.state().anchor).toBe('a');
    expect(m.state().dragging).toBe(true);
  });
  it('snaps to the next valid star and the chain goes on from there', () => {
    const m = new ConstellationMachine(DEMO_KITE);
    const ev = dragThrough(m, ['a', 'b', 'c']);
    expect(types(ev)).toEqual(['start', 'connect', 'connect']);
    expect(m.state().drawn).toEqual([0, 1]);
    expect(m.state().anchor).toBe('c');
  });
  it('snaps when the finger is only near the star, not on it', () => {
    const m = new ConstellationMachine(DEMO_KITE);
    m.beginDrag('a', ...at(m, 'a'), 1);
    const [bx, by] = at(m, 'b');
    expect(types(m.move(bx + m.snap * 1.2, by, 1.1))).not.toContain('connect');
    expect(types(m.move(bx + m.snap * 0.9, by, 1.2))).toContain('connect');
  });
  it('chooses the nearest of two valid stars', () => {
    const d: ConstellationDef = { id: 'fork', nodes: [{ id: 'o', x: -0.8, y: 0 }, { id: 'u', x: 0.3, y: 0.14 }, { id: 'v', x: 0.3, y: -0.14 }], edges: [['o', 'u'], ['o', 'v']], snap: 0.16 };
    const m = new ConstellationMachine(d);
    m.beginDrag('o', -0.8, 0, 1);
    const ev = m.move(0.3, -0.01, 1.1); // both are inside the snap circle; v is the nearer
    expect(ev.find((e) => e.type === 'connect')).toMatchObject({ to: 'v' });
  });
  it('can be drawn from either end of a line', () => {
    const m = new ConstellationMachine(DEMO_KITE);
    expect(types(dragThrough(m, ['b', 'a']))).toEqual(['start', 'connect']);
    expect(m.state().drawn).toEqual([0]);
  });
  it('a star with no line left is a soft wrong, not a start', () => {
    const m = new ConstellationMachine(DEMO_KITE);
    dragThrough(m, ['f', 'e']);
    m.release(2);
    const ev = m.beginDrag('f', ...at(m, 'f'), 3);
    expect(ev).toMatchObject([{ type: 'wrong', star: 'f', why: 'done' }]);
    expect(m.state().dragging).toBe(false);
  });
  it('skimming a star with no line to it gives one soft wrong per visit, and the drag carries on', () => {
    const m = new ConstellationMachine(DEMO_KITE);
    m.beginDrag('a', ...at(m, 'a'), 1);
    const ev1 = m.move(...at(m, 'c'), 1.1);
    expect(ev1).toMatchObject([{ type: 'wrong', star: 'c', why: 'noLine' }]);
    expect(m.move(...at(m, 'c'), 1.2)).toEqual([]); // still on it: no second complaint
    m.move(0, 0.3, 1.12); // away
    expect(m.state().dragging).toBe(true);
    // a second visit inside the cooldown is quiet; after it, it speaks again
    expect(m.move(...at(m, 'c'), 1.15)).toEqual([]);
    m.move(0, 0.3, 1.18);
    expect(types(m.move(...at(m, 'c'), 1.1 + WRONG_COOLDOWN + 0.1))).toEqual(['wrong']);
  });
  it('passing a star already joined to this one is a quiet "already"', () => {
    const m = new ConstellationMachine(DEMO_KITE);
    dragThrough(m, ['a', 'b']);
    m.move(0.2, 0.5, 2);
    const ev = m.move(...at(m, 'a'), 2.1);
    expect(types(ev)).toEqual(['already']);
    expect(m.state().drawn).toEqual([0]);
  });
  it('letting go drops the half-made line and keeps what is drawn', () => {
    const m = new ConstellationMachine(DEMO_KITE);
    dragThrough(m, ['a', 'b']);
    m.move(0.5, -0.2, 2);
    expect(m.release(2.1)).toMatchObject([{ type: 'release', partial: true }]);
    const s = m.state();
    expect(s.anchor).toBeNull();
    expect(s.dragging).toBe(false);
    expect(s.finger).toBeNull();
    expect(s.drawn).toEqual([0]);
  });
  it('a second drag carries on from the last star', () => {
    const m = new ConstellationMachine(DEMO_KITE);
    dragThrough(m, ['a', 'b']);
    m.release(2);
    dragThrough(m, ['b', 'c'], 3);
    expect(m.state().drawn).toEqual([0, 1]);
  });
  it('completes exactly once, and then ignores everything', () => {
    const m = new ConstellationMachine(DEMO_KITE);
    const all: EngineEvent[] = [];
    all.push(...dragThrough(m, ['a', 'b', 'c', 'd', 'a'], 1));
    m.release(3);
    all.push(...dragThrough(m, ['c', 'e', 'f'], 4));
    m.release(5);
    all.push(...dragThrough(m, ['e', 'g'], 6));
    expect(all.filter((e) => e.type === 'complete')).toHaveLength(1);
    expect(types(all).slice(-2)).toEqual(['connect', 'complete']);
    expect(m.isComplete).toBe(true);
    expect(m.state().progress).toBe(1);
    expect(m.beginDrag('a', 0, 0.8, 9)).toEqual([]);
    expect(m.tap('a', 10)).toEqual([]);
    expect(m.undo(11)).toEqual([]);
    expect(m.tick(99)).toEqual([]);
  });
});

describe('tap to join', () => {
  it('tap a star, tap its neighbour', () => {
    const m = new ConstellationMachine(DEMO_KITE);
    expect(types(m.tap('a', 1))).toEqual(['select']);
    expect(types(m.tap('b', 2))).toEqual(['connect']);
    expect(m.state().drawn).toEqual([0]);
    expect(m.state().anchor).toBe('b');
    expect(types(m.tap('c', 3))).toEqual(['connect']);
  });
  it('tapping the picked-up star puts it down', () => {
    const m = new ConstellationMachine(DEMO_KITE);
    m.tap('a', 1);
    expect(types(m.tap('a', 2))).toEqual(['deselect']);
    expect(m.state().anchor).toBeNull();
  });
  it('tapping a star that is not joinable moves the pick-up there (no scold) when it has lines left', () => {
    const m = new ConstellationMachine(DEMO_KITE);
    m.tap('a', 1);
    expect(types(m.tap('f', 2))).toEqual(['deselect', 'select']);
    expect(m.state().anchor).toBe('f');
  });
  it('a first tap on a spent star is a soft wrong', () => {
    const m = new ConstellationMachine(DEMO_KITE);
    m.tap('f', 1);
    m.tap('e', 2);
    m.tap('g', 3); // e-g drawn: e still has e-c left, g is spent now
    expect(m.tap('g', 4)).toMatchObject([{ type: 'wrong', star: 'g', why: 'done' }]);
  });
  it('tapping a star already joined to the picked-up one is a quiet already', () => {
    const m = new ConstellationMachine(DEMO_KITE);
    m.tap('a', 1);
    m.tap('b', 2);
    m.tap('a', 3); // picks a back up? b -> a: a-b drawn
    expect(m.log.map((e) => e.type)).toContain('already');
  });
  it('unknown and null stars do nothing', () => {
    const m = new ConstellationMachine(DEMO_KITE);
    expect(m.tap(null, 1)).toEqual([]);
    expect(m.tap('nope', 1)).toEqual([]);
    expect(m.beginDrag('nope', 0, 0, 1)).toEqual([]);
    expect(m.state().dragging).toBe(false);
  });
  it('a tap and a drag can mix', () => {
    const m = new ConstellationMachine(DEMO_KITE);
    m.tap('a', 1);
    m.tap('b', 2);
    m.beginDrag('b', ...at(m, 'b'), 3);
    m.move(...at(m, 'c'), 3.1);
    expect(m.state().drawn).toEqual([0, 1]);
  });
});

describe('undo', () => {
  it('takes back the last line, one at a time, then does nothing', () => {
    const m = new ConstellationMachine(DEMO_KITE);
    dragThrough(m, ['a', 'b', 'c']);
    m.release(2);
    expect(m.undo(3)).toMatchObject([{ type: 'undo', edge: 1, drawn: 1 }]);
    expect(m.undo(4)).toMatchObject([{ type: 'undo', edge: 0, drawn: 0 }]);
    expect(m.undo(5)).toEqual([]);
    expect(m.state().drawn).toEqual([]);
  });
  it('a line that was undone can be drawn again', () => {
    const m = new ConstellationMachine(DEMO_KITE);
    dragThrough(m, ['a', 'b']);
    m.release(2);
    m.undo(3);
    expect(types(dragThrough(m, ['a', 'b'], 4))).toEqual(['start', 'connect']);
  });
  it('undo while dragging drops the half-made line too', () => {
    const m = new ConstellationMachine(DEMO_KITE);
    dragThrough(m, ['a', 'b']);
    m.undo(2);
    expect(m.state()).toMatchObject({ anchor: null, dragging: false, drawn: [] });
  });
  it('reset starts again', () => {
    const m = new ConstellationMachine(DEMO_KITE);
    dragThrough(m, ['a', 'b']);
    m.reset(5);
    expect(m.state()).toMatchObject({ drawn: [], anchor: null, complete: false, progress: 0 });
  });
});

describe('order', () => {
  it('only the next line in order is valid, from either end', () => {
    const m = new ConstellationMachine(DEMO_PATH);
    expect(m.validEdge('p1', 'p2')).toBe(0);
    expect(m.validEdge('p2', 'p1')).toBe(0);
    expect(m.validEdge('p2', 'p3')).toBe(-1);
    expect(m.targetsFrom('p2')).toEqual(['p1']);
  });
  it('a drag out of order does not connect, and says "not next"', () => {
    const m = new ConstellationMachine(DEMO_PATH);
    expect(m.beginDrag('p3', ...at(m, 'p3'), 1)).toMatchObject([{ type: 'wrong', why: 'notNext' }]);
    m.beginDrag('p2', ...at(m, 'p2'), 2);
    expect(m.state().dragging).toBe(true);
    expect(types(m.move(...at(m, 'p3'), 2.1))).not.toContain('connect');
  });
  it('the whole path in order completes', () => {
    const m = new ConstellationMachine(DEMO_PATH);
    const ev = dragThrough(m, ['p1', 'p2', 'p3', 'p4', 'p5']);
    expect(types(ev).filter((x) => x === 'connect')).toHaveLength(4);
    expect(types(ev).slice(-1)).toEqual(['complete']);
  });
  it('tap mode follows the order too', () => {
    const m = new ConstellationMachine(DEMO_PATH);
    m.tap('p2', 1);
    expect(m.tap('p3', 2)).toMatchObject([{ type: 'wrong', star: 'p3', why: 'notNext' }]); // p2-p3 is not the next line
    expect(m.state()).toMatchObject({ drawn: [], anchor: 'p2' });
    expect(types(m.tap('p1', 3))).toEqual(['connect']);
    expect(m.state().drawn).toEqual([0]);
  });
});

describe('hint', () => {
  it('after 8 s of nothing it names a line; any input ends it', () => {
    const m = new ConstellationMachine(DEMO_KITE);
    expect(m.tick(HINT_AFTER - 0.1)).toEqual([]);
    const ev = m.tick(HINT_AFTER + 0.1);
    expect(types(ev)).toEqual(['hint']);
    expect(m.state().hint).not.toBeNull();
    expect(m.tick(HINT_AFTER + 5)).toEqual([]); // once
    expect(types(m.tap('a', 20))).toEqual(['hintEnd', 'select']);
    expect(m.state().hint).toBeNull();
  });
  it('waits another 8 s after the next touch', () => {
    const m = new ConstellationMachine(DEMO_KITE);
    m.tick(9);
    m.tap('a', 10);
    m.tap('b', 11);
    expect(m.tick(18)).toEqual([]);
    expect(types(m.tick(19.1))).toEqual(['hint']);
  });
  it('points at a line that really can be drawn now', () => {
    const m = new ConstellationMachine(DEMO_KITE);
    dragThrough(m, ['a', 'b']);
    m.release(2);
    m.tick(11);
    const h = m.state().hint!;
    expect(m.validEdge(h.from, h.to)).toBeGreaterThanOrEqual(0);
    expect(h.from).toBe('b'); // carries on from where she got to
  });
  it('in ordered mode it names the next line', () => {
    const m = new ConstellationMachine(DEMO_PATH);
    dragThrough(m, ['p1', 'p2']);
    m.release(2);
    m.tick(11);
    expect(m.state().hint).toMatchObject({ from: 'p2', to: 'p3', edge: 1 });
  });
  it('not while a finger is down, and not when complete', () => {
    const m = new ConstellationMachine(DEMO_KITE);
    m.beginDrag('a', ...at(m, 'a'), 1);
    expect(m.tick(50)).toEqual([]);
    const k = new ConstellationMachine(DEMO_PATH);
    dragThrough(k, ['p1', 'p2', 'p3', 'p4', 'p5']);
    expect(k.tick(99)).toEqual([]);
  });
  it('a hint always names an existing, drawable line, over many random partial states', () => {
    let seed = 5;
    const rnd = (): number => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (let run = 0; run < 200; run++) {
      const def = rnd() < 0.5 ? DEMO_KITE : DEMO_PATH;
      const m = new ConstellationMachine(def);
      const steps = Math.floor(rnd() * 12);
      for (let i = 0; i < steps; i++) {
        const id = def.nodes[Math.floor(rnd() * def.nodes.length)]!.id;
        if (rnd() < 0.2) m.undo(i);
        else m.tap(id, i);
        if (m.isComplete) break;
      }
      m.tick(100 + run);
      const h = m.state().hint;
      if (!m.isComplete) {
        expect(h).not.toBeNull();
        expect(m.validEdge(h!.from, h!.to)).toBeGreaterThanOrEqual(0);
      } else expect(h).toBeNull();
    }
  });
});

describe('fuzz', () => {
  it('wild input never throws, never repeats a line, never gives NaN, and the log stays capped', () => {
    let seed = 99;
    const rnd = (): number => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (const def of Object.values(DEMO_DEFS)) {
      const m = new ConstellationMachine(def, { snapScale: 1.3 });
      const ids = [...def.nodes.map((n) => n.id), 'nope', null];
      let t = 0;
      for (let i = 0; i < 3000; i++) {
        t += rnd() * 0.3 - 0.02; // time may even go backwards
        const r = rnd();
        const x = rnd() < 0.03 ? Number.NaN : rnd() * 2.6 - 1.3;
        const y = rnd() * 2.6 - 1.3;
        const id = ids[Math.floor(rnd() * ids.length)] as string | null;
        if (r < 0.15) m.beginDrag(id, x, y, t);
        else if (r < 0.6) m.move(x, y, t);
        else if (r < 0.7) m.release(t);
        else if (r < 0.85) m.tap(id, t);
        else if (r < 0.9) m.undo(t);
        else if (r < 0.92) m.reset(t);
        else m.tick(t + rnd() * 20);
        const s = m.state();
        expect(new Set(s.drawn).size).toBe(s.drawn.length);
        expect(s.progress).toBeGreaterThanOrEqual(0);
        expect(s.progress).toBeLessThanOrEqual(1);
        if (s.finger) expect(Number.isFinite(s.finger.x + s.finger.y)).toBe(true);
        if (s.complete) expect(s.drawn.length).toBe(def.edges.length);
        if (s.dragging) expect(s.anchor).not.toBeNull();
        if (def.order) expect(s.drawn).toEqual(def.order.slice(0, s.drawn.length));
      }
      expect(m.log.length).toBeLessThanOrEqual(400);
    }
  });
  it('a finger that wanders over the whole plane can still finish the shape by dragging along it', () => {
    const m = new ConstellationMachine(DEMO_KITE, { snapScale: 1 });
    // a jittery finger: 0.04 off the line, in 40 small steps per line
    const path = ['a', 'b', 'c', 'd', 'a'];
    m.beginDrag('a', ...at(m, 'a'), 1);
    let t = 1;
    for (let k = 1; k < path.length; k++) {
      const [x0, y0] = at(m, path[k - 1]!);
      const [x1, y1] = at(m, path[k]!);
      for (let s = 1; s <= 40; s++) m.move(x0 + ((x1 - x0) * s) / 40 + 0.04 * Math.sin(s), y0 + ((y1 - y0) * s) / 40 + 0.04 * Math.cos(s), (t += 0.02));
    }
    expect(m.state().drawn).toEqual([0, 1, 2, 3]);
  });
});

describe('purity', () => {
  const pure = ['src/constellations/engine.ts', 'src/constellations/defs.ts'];
  it('the two logic files use no three, DOM, clock or random', () => {
    for (const f of pure) {
      const src = readFileSync(f, 'utf8').replace(/\/\/.*$/gm, '');
      expect(src, f).not.toMatch(/from\s*['"]three/);
      expect(src, f).not.toMatch(/\b(document|window|performance|requestAnimationFrame)\b|Date\.now|Math\.random/);
    }
  });
  it('the demo shapes carry no words (the owner\'s words belong to content/)', () => {
    for (const d of Object.values(DEMO_DEFS)) expect(JSON.stringify(d)).not.toMatch(/name|label|title|wish/i);
  });
});
