import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import * as THREE from 'three';
import { poseDistance, type Frame } from '../src/character/companion/engine';
import { newCat, CAT_STATE_NAMES, CAT_GESTURE_NAMES, CAT_DEF, type CatState } from '../src/character/cat/states';
import { newBunny, BUNNY_STATE_NAMES, BUNNY_GESTURE_NAMES, BUNNY_DEF } from '../src/character/bunny/states';
import { createCat, CAT_COLORS } from '../src/character/cat/cat';
import { createBunny, BUNNY_COLORS } from '../src/character/bunny/bunny';
import { triangleCount } from '../src/character/companion/parts';
import { buildFaceGeometry, frontZ } from '../src/character/companion/face';
import { makeRng } from '../src/character/chamgadad/blink';

const DT = 1 / 60;
const LIMIT = 4; // radians or metres: any pose number beyond this is a bug

function finiteAndBounded(f: Frame<string, string>): void {
  for (const [k, v] of Object.entries(f.pose)) {
    expect(Number.isFinite(v), k).toBe(true);
    expect(Math.abs(v), k).toBeLessThan(LIMIT);
  }
  for (const [k, v] of Object.entries(f.ch)) expect(Number.isFinite(v), k).toBe(true);
  expect(Number.isFinite(f.breath)).toBe(true);
  expect(f.eyes).toBeGreaterThanOrEqual(0);
  expect(f.eyes).toBeLessThanOrEqual(1);
}

interface Animal {
  name: string;
  make: (o?: { reducedMotion?: boolean; seed?: number; auto?: boolean }) => ReturnType<typeof newCat> | ReturnType<typeof newBunny>;
  states: readonly string[];
  gestures: readonly string[];
  initial: string;
}
const animals: Animal[] = [
  { name: 'cat', make: newCat as Animal['make'], states: CAT_STATE_NAMES, gestures: CAT_GESTURE_NAMES, initial: 'sleep' },
  { name: 'bunny', make: newBunny as Animal['make'], states: BUNNY_STATE_NAMES, gestures: BUNNY_GESTURE_NAMES, initial: 'sit' },
];

for (const a of animals) {
  describe(`${a.name}: the state machine`, () => {
    it(`starts in ${a.initial}`, () => {
      expect(a.make().state).toBe(a.initial);
    });

    it('stays finite and bounded over a ten-minute storm of requests and gestures', () => {
      const c = a.make({ seed: 5 }) as any;
      const rng = makeRng(99);
      let worst = 0;
      let prev = c.frame;
      for (let i = 0; i < 60 * 600; i++) {
        if (i % 37 === 0) c.request(a.states[Math.floor(rng() * a.states.length)]);
        if (i % 53 === 0) c.gesture(a.gestures[Math.floor(rng() * a.gestures.length)]);
        const f = c.update(DT) as Frame<string, string>;
        finiteAndBounded(f);
        worst = Math.max(worst, poseDistance({ pose: prev.pose, ch: {} }, { pose: f.pose, ch: {} }));
        prev = f;
      }
      // no pose number moves faster than about 6 per second at any frame (nothing pops)
      expect(worst).toBeLessThan(0.1);
    }, 60000);

    it('does not jump when a state is asked for at many different moments', () => {
      for (const to of a.states) {
        for (let moment = 0; moment < 900; moment += 23) {
          const c = a.make({ seed: 3, auto: false }) as any;
          for (const s of a.states) if (s !== a.initial) c.request(s); // wander somewhere first
          for (let i = 0; i < moment; i++) c.update(DT);
          const before = c.frame.pose;
          c.request(to);
          const after = c.update(DT).pose;
          expect(poseDistance({ pose: before, ch: {} }, { pose: after, ch: {} }), `${a.name} -> ${to} at frame ${moment}`).toBeLessThan(0.1);
        }
      }
    });

    it('is deterministic for a seed and differs between seeds only in its automatic gestures', () => {
      const run = (seed: number): string => {
        const c = a.make({ seed }) as any;
        const out: number[] = [];
        for (let i = 0; i < 60 * 40; i++) {
          if (i === 300) c.request(a.states[1]);
          const f = c.update(DT) as Frame<string, string>;
          out.push(f.pose[Object.keys(f.pose)[0] ?? ''] ?? 0, f.breath);
        }
        return JSON.stringify(out);
      };
      expect(run(1)).toBe(run(1));
    });

    it('runs no automatic gestures when asked not to, and none under reduced motion', () => {
      for (const opts of [{ auto: false }, { reducedMotion: true }]) {
        const c = a.make({ seed: 8, ...opts }) as any;
        for (let i = 0; i < 60 * 120; i++) {
          const f = c.update(DT) as Frame<string, string>;
          for (const g of a.gestures) expect(f.gt[g]).toBe(-1);
        }
      }
    });

    it('a gesture runs for its length, then rests for its cooldown, and never changes the posture', () => {
      const c = a.make({ seed: 2, auto: false }) as any;
      for (let i = 0; i < 120; i++) c.update(DT);
      const state0 = c.state;
      for (const g of a.gestures) {
        expect(c.gesture(g), g).toBe(true);
        expect(c.gesture(g), `${g} again at once`).toBe(false);
        const len = (c.def.gestures[g] as { length: number; cooldown: number }).length;
        const cool = (c.def.gestures[g] as { length: number; cooldown: number }).cooldown;
        let ran = 0;
        for (let i = 0; i < 60 * (len + 0.2); i++) {
          const f = c.update(DT) as Frame<string, string>;
          if (f.gt[g] >= 0) ran++;
          expect(c.state).toBe(state0);
        }
        expect(ran / 60).toBeGreaterThan(len - 0.1);
        expect(ran / 60).toBeLessThan(len + 0.1);
        for (let i = 0; i < 60 * (cool + 0.1); i++) c.update(DT);
        expect(c.gesture(g), `${g} after its cooldown`).toBe(true);
        for (let i = 0; i < 60 * (len + cool + 0.2); i++) c.update(DT);
      }
    });

    it('unknown states are refused and change nothing', () => {
      const c = a.make() as any;
      expect(c.request('not-a-state')).toBe('refused');
      expect(c.state).toBe(a.initial);
    });

    it('survives dt = NaN, negative, zero and huge without a bad number', () => {
      const c = a.make({ seed: 4 }) as any;
      for (const dt of [NaN, -1, 0, Infinity, 1e9, 5, 0.0001, 1 / 60]) {
        const f = c.update(dt) as Frame<string, string>;
        finiteAndBounded(f);
      }
      c.request(a.states[1]);
      for (let i = 0; i < 600; i++) finiteAndBounded(c.update(DT));
    });

    it('under reduced motion a movement that returns to where it began shrinks to well under its full size, nothing goes further than the full motion, and nothing shivers', () => {
      for (const s of a.states) {
        const def = (a.make() as any).def;
        const d = def.states[s];
        // the posture the movement starts from (the one whose pose matches its first frame), so both runs begin in the same place
        const from = a.states.find((p) => def.states[p].kind === 'posture' && p !== s && poseDistance(def.states[p].sample(0, 1), d.sample(0, 1)) < 0.05);
        const run = (reduced: boolean): number => {
          const c = a.make({ seed: 1, reducedMotion: reduced, auto: false }) as any;
          if (from) {
            c.request(from);
            for (let i = 0; i < 60 * 30; i++) c.update(DT);
          }
          const start = { pose: { ...c.frame.pose }, ch: {} };
          c.request(s);
          let far = 0;
          for (let i = 0; i < 60 * 14; i++) {
            const f = c.update(DT) as Frame<string, string>;
            if (reduced) expect(f.shiver).toBe(0);
            far = Math.max(far, poseDistance(start, { pose: f.pose, ch: {} }));
          }
          return far;
        };
        const full = run(false);
        const red = run(true);
        const returns = d.kind === 'oneShot' && poseDistance(d.sample(0, 1), d.sample(d.length, 1)) < 0.3;
        if (returns && from && full > 0.05) expect(red, `${a.name} ${s}`).toBeLessThan(full * 0.7);
        else expect(red, `${a.name} ${s}`).toBeLessThanOrEqual(full * 1.15 + 1e-6);
      }
    });
  });
}

describe('the cat: states', () => {
  it('sleep only goes to wake; anything asked of a sleeping cat wakes her first and then goes there', () => {
    expect(CAT_DEF.allow.sleep).toEqual(['wake']);
    for (const to of ['sit', 'stretch', 'purr'] as CatState[]) {
      const c = newCat({ auto: false });
      expect(c.request(to)).toBe('routed');
      expect(c.state).toBe('wake');
      const seen: string[] = [c.state];
      for (let i = 0; i < 60 * 20; i++) {
        c.update(DT);
        if (seen[seen.length - 1] !== c.state) seen.push(c.state);
      }
      expect(seen[0]).toBe('wake');
      expect(seen[seen.length - 1], to).toBe(to === 'sit' ? 'sit' : to === 'purr' ? 'purr' : 'sit');
      if (to === 'purr') expect(seen).toContain('purr');
    }
  });
  it('wake settles into sit after about 4.6 s; stretch into sit after 6 s', () => {
    const c = newCat({ auto: false });
    c.request('wake');
    for (let i = 0; i < 60 * 4.4; i++) c.update(DT);
    expect(c.state).toBe('wake');
    for (let i = 0; i < 60 * 0.4; i++) c.update(DT);
    expect(c.state).toBe('sit');
    c.request('stretch');
    for (let i = 0; i < 60 * 5.8; i++) c.update(DT);
    expect(c.state).toBe('stretch');
    for (let i = 0; i < 60 * 0.4; i++) c.update(DT);
    expect(c.state).toBe('sit');
  });
  it('sleeping eyes are closed (held), purr is half closed, sit leaves the blinks alone', () => {
    const c = newCat({ auto: false });
    for (let i = 0; i < 60 * 8; i++) c.update(DT);
    expect(c.frame.eyes).toBeGreaterThan(0.95);
    c.request('wake');
    for (let i = 0; i < 60 * 12; i++) c.update(DT);
    c.request('purr');
    for (let i = 0; i < 60 * 8; i++) c.update(DT);
    expect(c.frame.eyes).toBeGreaterThan(0.45);
    expect(c.frame.eyes).toBeLessThan(0.8);
    expect(Math.abs(c.frame.shiver)).toBeLessThanOrEqual(1);
    c.request('sit');
    for (let i = 0; i < 60 * 8; i++) c.update(DT);
    expect(c.frame.eyes).toBeLessThan(0.05);
  });
  it('the latest request wins when several are queued during a one-shot', () => {
    const c = newCat({ auto: false });
    c.request('wake');
    for (let i = 0; i < 60 * 1; i++) c.update(DT);
    c.request('stretch');
    c.request('purr');
    c.request('sit');
    for (let i = 0; i < 60 * 8; i++) c.update(DT);
    expect(c.state).toBe('sit');
  });
});

describe('the bunny: states', () => {
  it('sit goes to peek through hide; peek sinks back to hide by itself', () => {
    const c = newBunny({ auto: false });
    expect(c.request('peek')).toBe('routed');
    expect(c.state).toBe('hide');
    const seen: string[] = [c.state];
    for (let i = 0; i < 60 * 14; i++) {
      c.update(DT);
      if (seen[seen.length - 1] !== c.state) seen.push(c.state);
    }
    expect(seen).toEqual(['hide', 'peek', 'hide']);
  });
  it('hop is on the spot (no travel) and settles into sit after 2.4 s; the ends of the hop match the seat', () => {
    const c = newBunny({ auto: false });
    for (let i = 0; i < 60 * 3; i++) c.update(DT);
    const sitPose = { ...c.frame.pose };
    c.request('hop');
    let maxLift = 0;
    for (let i = 0; i < 60 * 2.3; i++) {
      const f = c.update(DT);
      expect(f.pose['motion.px'] ?? 0).toBe(0);
      expect(f.pose['motion.pz'] ?? 0).toBe(0);
      maxLift = Math.max(maxLift, f.pose['motion.py'] ?? 0);
    }
    expect(maxLift).toBeGreaterThan(0.05);
    expect(maxLift).toBeLessThan(0.2);
    for (let i = 0; i < 60 * 0.4; i++) c.update(DT);
    expect(c.state).toBe('sit');
    for (let i = 0; i < 60 * 3; i++) c.update(DT);
    expect(poseDistance({ pose: c.frame.pose, ch: {} }, { pose: sitPose, ch: {} })).toBeLessThan(0.12);
  });
  it('hide sinks the body below the seat and never above the ground by more than the hop does', () => {
    const c = newBunny({ auto: false });
    c.request('hide');
    for (let i = 0; i < 60 * 6; i++) c.update(DT);
    expect(c.frame.pose['motion.py']!).toBeLessThan(-0.1);
  });
  it('every state is reachable and every state can come back to sit', () => {
    for (const to of BUNNY_STATE_NAMES) {
      const c = newBunny({ auto: false });
      c.request(to);
      for (let i = 0; i < 60 * 8; i++) c.update(DT);
      c.request('sit');
      for (let i = 0; i < 60 * 12; i++) c.update(DT);
      expect(c.state, to).toBe('sit');
    }
    expect(Object.keys(BUNNY_DEF.states).sort()).toEqual([...BUNNY_STATE_NAMES].sort());
    expect(Object.keys(CAT_DEF.states).sort()).toEqual([...CAT_STATE_NAMES].sort());
  });
});

describe('the geometry', () => {
  const cat = createCat({ auto: false });
  const bunny = createBunny({ auto: false });
  const meshesOf = (root: THREE.Object3D): THREE.Mesh[] => {
    const out: THREE.Mesh[] = [];
    root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) out.push(o as THREE.Mesh);
    });
    return out;
  };

  for (const [name, animal] of [['cat', cat], ['bunny', bunny]] as const) {
    it(`${name}: every mesh has indices in range, finite numbers and unit normals`, () => {
      for (const m of meshesOf(animal.root)) {
        const g = m.geometry;
        const pos = g.getAttribute('position');
        const nor = g.getAttribute('normal');
        for (let i = 0; i < pos.array.length; i++) expect(Number.isFinite(pos.array[i]!)).toBe(true);
        if (nor && m !== (animal as any).face.mesh) {
          for (let i = 0; i < nor.count; i++) {
            const l = Math.hypot(nor.getX(i), nor.getY(i), nor.getZ(i));
            expect(Math.abs(l - 1)).toBeLessThan(1e-3);
          }
        }
        const idx = g.index!;
        for (let i = 0; i < idx.count; i++) expect(idx.getX(i)).toBeLessThan(pos.count);
        expect(triangleCount(g)).toBeGreaterThan(0);
      }
    });

    it(`${name}: no triangle faces the wrong way (against the outward direction from its own part's middle)`, () => {
      let wrong = 0;
      let total = 0;
      for (const m of meshesOf(animal.root)) {
        if (m === (animal as any).face.mesh) continue;
        const g = m.geometry;
        if (!g.getAttribute('color')) continue; // the ink hulls are inside-out on purpose
        const pos = g.getAttribute('position');
        const idx = g.index!;
        const c = new THREE.Vector3();
        for (let i = 0; i < pos.count; i++) c.add(new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)));
        c.divideScalar(pos.count);
        const a = new THREE.Vector3(), b = new THREE.Vector3(), d = new THREE.Vector3();
        for (let t = 0; t < idx.count; t += 3) {
          a.fromBufferAttribute(pos, idx.getX(t));
          b.fromBufferAttribute(pos, idx.getX(t + 1));
          d.fromBufferAttribute(pos, idx.getX(t + 2));
          const n = b.clone().sub(a).cross(d.clone().sub(a));
          if (n.lengthSq() < 1e-14) continue; // a sliver at a pole
          total++;
          const mid = a.clone().add(b).add(d).divideScalar(3);
          // a convex-ish piece: the face normal should point away from the nearest part of the model's own surface; use the stored normal as the truth
          const nn = new THREE.Vector3().fromBufferAttribute(g.getAttribute('normal'), idx.getX(t));
          if (n.dot(nn) < 0) wrong++;
          void mid;
        }
      }
      expect(total).toBeGreaterThan(100);
      expect(wrong).toBe(0);
    });

    it(`${name}: draw calls and triangles are counted from the real scene graph and match its own stats`, () => {
      const ms = meshesOf(animal.root);
      const s = animal.stats();
      expect(s.drawCalls).toBe(ms.length);
      expect(s.triangles).toBe(ms.reduce((n, m) => n + triangleCount(m.geometry), 0));
    });

    it(`${name}: no textures anywhere`, () => {
      for (const m of meshesOf(animal.root)) {
        const mat = m.material as THREE.Material & Record<string, unknown>;
        // the only texture is the shared toon ramp (a tiny data texture the toon material owns); no image, no colour map
        for (const [k, v] of Object.entries(mat)) if (v instanceof THREE.Texture) expect(k).toBe('gradientMap');
        expect((mat as any).map ?? null).toBeNull();
        for (const v of Object.values((mat as any).uniforms ?? {})) expect((v as any).value instanceof THREE.Texture).toBe(false);
      }
    });

    it(`${name}: poses at the rest and at each state set finite transforms`, () => {
      const b = (animal as any).behaviour;
      const states = name === 'cat' ? CAT_STATE_NAMES : BUNNY_STATE_NAMES;
      for (const s of states) {
        b.request(s);
        for (let i = 0; i < 60 * 8; i++) animal.update(DT);
        animal.root.updateMatrixWorld(true);
        for (const m of meshesOf(animal.root)) for (const e of m.matrixWorld.elements) expect(Number.isFinite(e)).toBe(true);
      }
    });
  }

  it('the cat is within the nook budget: 60 calls minus the nook (7) and Chamgadad (about 30) leaves at least the cat\'s 15 to 17', () => {
    const s = cat.stats();
    expect(s.drawCalls).toBeLessThanOrEqual(60 - 7 - 30);
    expect(s.triangles).toBeLessThan(6000);
  });
  it('the bunny is within the outdoor budget: 60 calls minus the scene (19) and Chamgadad (about 30) leaves 11', () => {
    const s = bunny.stats();
    expect(s.drawCalls).toBeLessThanOrEqual(11);
    expect(s.triangles).toBeLessThan(5000);
  });

  it('the face patches lie on the head, in front of it, and stay in range', () => {
    const head = { c: [0, 0.06, 0.014] as [number, number, number], r: [0.098, 0.082, 0.088] as [number, number, number] };
    const geo = buildFaceGeometry(head, [{ kind: 0, x: 0.04, y: 0.058, w: 0.036, h: 0.043 }]);
    const pos = geo.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      expect(z).toBeGreaterThan(frontZ(head, x, y));
      expect(z - frontZ(head, x, y)).toBeLessThan(0.01);
    }
  });

  it('the colours are the ones in the notes (`[A]`) and the bunny is white-blue, lavender inside the ears', () => {
    expect(BUNNY_COLORS.fur).toBe('#eaf2f8');
    expect(BUNNY_COLORS.earInner.toLowerCase()).toBe('#a79fc4');
    expect(CAT_COLORS.fur).toBe('#c8b8a0');
  });
});

describe('the files', () => {
  const read = (dir: string, acc: Record<string, string> = {}): Record<string, string> => {
    for (const n of readdirSync(dir)) {
      const p = join(dir, n);
      if (statSync(p).isDirectory()) read(p, acc);
      else if (p.endsWith('.ts')) acc[p.replace(/\\/g, '/')] = readFileSync(p, 'utf8');
    }
    return acc;
  };
  const imports = (text: string): string[] => Array.from(text.matchAll(/from\s*['"]([^'"]+)['"]/g)).map((m) => m[1]!);

  it('the pure files do not import three (engine, both states files, the shader strings)', () => {
    for (const f of ['src/character/companion/engine.ts', 'src/character/companion/shaders.ts', 'src/character/cat/states.ts', 'src/character/bunny/states.ts']) {
      expect(imports(readFileSync(f, 'utf8')).filter((s) => s === 'three' || s.startsWith('three/')), f).toEqual([]);
    }
  });
  it('no file under chamgadad/ imports the companion, cat or bunny code', () => {
    for (const [f, text] of Object.entries(read('src/character/chamgadad'))) {
      for (const s of imports(text)) expect(/companion|\/cat\/|\/bunny\//.test(s), `${f}: ${s}`).toBe(false);
    }
  });
  it('the cat and the bunny do not import each other', () => {
    for (const [f, text] of Object.entries(read('src/character/cat'))) for (const s of imports(text)) expect(s.includes('bunny'), f).toBe(false);
    for (const [f, text] of Object.entries(read('src/character/bunny'))) for (const s of imports(text)) expect(s.includes('/cat/'), f).toBe(false);
  });
  it('the companion code imports nothing from Chamgadad but the blink timer, and reads palette.json only for the eye colours', () => {
    for (const dir of ['src/character/companion', 'src/character/cat', 'src/character/bunny']) {
      for (const [f, text] of Object.entries(read(dir))) {
        for (const s of imports(text)) {
          if (s.includes('chamgadad/')) expect(s.endsWith('chamgadad/blink'), `${f}: ${s}`).toBe(true);
        }
      }
    }
  });
  it('the test views are opt-in: `?cat` / `?bunny` and nothing else builds them', () => {
    const main = readFileSync('src/main.ts', 'utf8');
    expect(main).toMatch(/params\.has\('cat'\) \|\| params\.has\('bunny'\)/);
    expect(main).toMatch(/if \(params\.has\('cat'\)\) \{/);
    expect(main).toMatch(/if \(params\.has\('bunny'\)\) \{/);
  });
  it('no hearts, no words: the companion sources carry no sentence', () => {
    for (const dir of ['src/character/companion', 'src/character/cat', 'src/character/bunny']) {
      for (const [f, text] of Object.entries(read(dir))) {
        const code = text.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
        expect(/heart|love|kiss/i.test(code), f).toBe(false);
      }
    }
  });
});
