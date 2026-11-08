import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createStayInput, keyBelongsToSomethingElse } from '../src/acts/stayInput';
import { createStayWorld } from '../src/acts/stayWorld';
import { createStayAwhileAct } from '../src/acts/stayAwhile';
import { createBus, type WinterEvents } from '../src/state/events';
import { STAY_WORLD } from '../src/acts/stayWorldMath';

// Phase 28 (fifth quarter): the page's hands for stay a while, on fake event targets (no DOM needed). No word of the owner's is used or invented here.

class Fake {
  l = new Map<string, Array<(e: never) => void>>();
  captured: number[] = [];
  addEventListener(t: string, f: (e: never) => void) {
    this.l.set(t, [...(this.l.get(t) ?? []), f]);
  }
  removeEventListener(t: string, f: (e: never) => void) {
    this.l.set(t, (this.l.get(t) ?? []).filter((x) => x !== f));
  }
  setPointerCapture(id: number) {
    this.captured.push(id);
  }
  fire(t: string, e: object) {
    for (const f of this.l.get(t) ?? []) f(e as never);
  }
  count() {
    return [...this.l.values()].reduce((s, a) => s + a.length, 0);
  }
}
const key = (k: string, extra: object = {}) => {
  const e = { key: k, prevented: false, preventDefault() { this.prevented = true; }, ...extra };
  return e as typeof e & { prevented: boolean };
};
const ptr = (pointerId: number, clientX: number, clientY: number, extra: object = {}) => ({ pointerId, clientX, clientY, button: 0, ...extra });

function setup() {
  const bus = createBus<WinterEvents>(() => undefined);
  const stay = createStayAwhileAct({ bus, chainFrom: bus });
  const world = createStayWorld({ stay });
  const stage = new Fake();
  const keys = new Fake();
  const input = createStayInput({ stay, world, stage, keys, width: () => 390 });
  return { stay, world, stage, keys, input };
}

describe('dragging', () => {
  it('does nothing unless she is staying', () => {
    const { world, stage } = setup();
    stage.fire('pointerdown', ptr(1, 100, 100));
    stage.fire('pointermove', ptr(1, 200, 100));
    expect(world.state().pan.yawDeg).toBe(0);
  });
  it('a one-finger drag turns the view with the finger and captures the pointer; letting go ends it', () => {
    const { stay, world, stage } = setup();
    stay.enter();
    stage.fire('pointerdown', ptr(1, 100, 100));
    expect(stage.captured).toEqual([1]);
    stage.fire('pointermove', ptr(1, 139, 100)); // 39 px right
    expect(world.state().pan.yawDeg).toBeCloseTo(-39 * (STAY_WORLD.dragDegPerScreen / 390), 6);
    stage.fire('pointerup', ptr(1, 139, 100));
    const y = world.state().pan.yawDeg;
    stage.fire('pointermove', ptr(1, 300, 100));
    expect(world.state().pan.yawDeg).toBe(y);
  });
  it('a second finger and other buttons are ignored; a cancel ends the drag', () => {
    const { stay, world, stage } = setup();
    stay.enter();
    stage.fire('pointerdown', ptr(1, 100, 100));
    stage.fire('pointerdown', ptr(2, 0, 0));
    stage.fire('pointermove', ptr(2, 50, 0));
    expect(world.state().pan.yawDeg).toBe(0);
    stage.fire('pointercancel', ptr(1, 100, 100));
    stage.fire('pointerdown', ptr(3, 0, 0, { button: 2 }));
    stage.fire('pointermove', ptr(3, 50, 0));
    expect(world.state().pan.yawDeg).toBe(0);
  });
  it('a drag that is going when she leaves stops turning the view', () => {
    const { stay, world, stage } = setup();
    stay.enter();
    stage.fire('pointerdown', ptr(1, 100, 100));
    stay.exit('replay');
    stage.fire('pointermove', ptr(1, 200, 100));
    expect(world.state().pan.yawDeg).toBe(0);
  });
});

describe('keys', () => {
  it('the arrows turn the view and Home recentres, and they are marked handled', () => {
    const { stay, world, keys } = setup();
    stay.enter();
    const e = key('ArrowRight');
    keys.fire('keydown', e);
    expect(e.prevented).toBe(true);
    expect(world.state().pan.yawDeg).toBe(STAY_WORLD.keyStepDeg);
    keys.fire('keydown', key('Home'));
    expect(world.state().pan.yawDeg).toBe(0);
  });
  it('every other key is left alone: Enter, Space, Tab, Escape are never taken', () => {
    const { stay, keys } = setup();
    stay.enter();
    for (const k of ['Enter', ' ', 'Tab', 'Escape', 'a']) {
      const e = key(k);
      keys.fire('keydown', e);
      expect(e.prevented).toBe(false);
    }
  });
  it('not when she is not staying, with a modifier, when already handled, or when a control or dialog has the focus', () => {
    const { stay, world, keys } = setup();
    keys.fire('keydown', key('ArrowRight'));
    expect(world.state().pan.yawDeg).toBe(0);
    stay.enter();
    for (const extra of [{ ctrlKey: true }, { altKey: true }, { metaKey: true }, { defaultPrevented: true }, { target: { closest: () => ({}) } }]) {
      const e = key('ArrowRight', extra);
      keys.fire('keydown', e);
      expect(e.prevented).toBe(false);
    }
    expect(world.state().pan.yawDeg).toBe(0);
    const e = key('ArrowRight', { target: { closest: () => null } });
    keys.fire('keydown', e);
    expect(world.state().pan.yawDeg).toBe(STAY_WORLD.keyStepDeg);
  });
  it('keyBelongsToSomethingElse: no target, a target without closest, or one that throws = the view may have it', () => {
    expect(keyBelongsToSomethingElse(undefined)).toBe(false);
    expect(keyBelongsToSomethingElse({})).toBe(false);
    expect(keyBelongsToSomethingElse({ closest: () => { throw new Error('x'); } })).toBe(false);
    expect(keyBelongsToSomethingElse({ closest: () => ({}) })).toBe(true);
  });
});

describe('never traps', () => {
  it('whatever she drags or presses, both exits stay on offer, and dispose removes every listener', () => {
    const { stay, stage, keys, input } = setup();
    stay.enter();
    for (let i = 0; i < 200; i++) {
      stage.fire('pointerdown', ptr(i, i, i));
      stage.fire('pointermove', ptr(i, i * 9, -i * 9));
      keys.fire('keydown', key(['ArrowUp', 'ArrowLeft', 'Home', 'Enter'][i % 4]!));
      expect(stay.state().exits).toEqual(['letter', 'replay']);
      stage.fire('pointerup', ptr(i, 0, 0));
    }
    expect(stage.count() + keys.count()).toBe(5);
    input.dispose();
    expect(stage.count() + keys.count()).toBe(0);
  });
  it('the file reaches neither the exits nor the letter, draws nothing, and has no sentence', () => {
    const src = readFileSync('src/acts/stayInput.ts', 'utf8').replace(/\/\/[^\n]*/g, '');
    expect(src).not.toMatch(/from 'three'|audio|document\.|window\.|\.exit\(|readAgain/);
    expect(src).not.toMatch(/['"`][A-Z][a-z]+ [a-z]+ [a-z]+[^'"`]*['"`]/);
  });
});
