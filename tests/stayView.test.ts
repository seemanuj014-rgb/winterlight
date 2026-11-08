import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// Phase 28 (sixth quarter): source-level checks for the `?stay` picture view and its door in the finale sky. The picture itself is checked by eye / in a browser (not here).

const view = readFileSync('src/acts/stayView.ts', 'utf8');
const sky = readFileSync('src/acts/finaleSky.ts', 'utf8');
const main = readFileSync('src/main.ts', 'utf8');
const code = (s: string): string => s.replace(/\/\/[^\n]*/g, '');

describe('the ?stay view', () => {
  it('is driven only by the stay world: the camera, the pan and the shapes\' home progress', () => {
    expect(view).toMatch(/world\.camera\(aspect\)/);
    expect(view).toMatch(/sky\.setHome\(world\.state\(\)\.home\)/);
    expect(view).toMatch(/createStayInput\(\{ stay, world, stage: canvas, keys: window/);
    expect(view).toMatch(/canvas\.style\.touchAction = 'none'/);
  });
  it('starts staying at once, with the shapes in the crown and the aurora at its fullest, as the finale ended', () => {
    expect(view).toMatch(/sky\.set\(1, 1\);\s*sky\.setHome\(0\);/);
    expect(view).toMatch(/stay\.enter\(\)/);
    expect(view).toMatch(/auroraGain\(1\)/);
  });
  it('the wishes button shows every wish through the one card, and the card sets and clears the activity', () => {
    expect(view).toMatch(/replay\.add\('wishes'/);
    expect(view).toMatch(/text\.showWish\(c\.id\)/);
    expect(view).toMatch(/wishes: content\.wishes/);
    expect(view).toMatch(/stay\.setActivity\('wishes'\)/);
  });
  it('has no Chamgadad, no audio, no exit logic of its own (the exits are createStayControls\'), and no sentence', () => {
    expect(code(view)).not.toMatch(/character\/|audio|\.exit\(|readAgain/);
    expect(code(view)).not.toMatch(/['"`][A-Z][a-z]+ [a-z]+ [a-z]+[^'"`]*['"`]/);
  });
  it('the owner\'s message comes only through finaleMessageFor', () => {
    expect(view).toMatch(/message: finaleMessageFor\(content\.credits\)/);
  });
  it('main.ts opens it on ?stay with the post pass and the finale\'s glow gain, and handles resize, update, render and tier', () => {
    expect(main).toMatch(/else if \(stayParam\) \{\s*stayView = createStayView/);
    expect(main).toMatch(/stayView\.resize\(aspect, width, height\)/);
    expect(main).toMatch(/else if \(stayView\) stayView\.update\(dt\)/);
    expect(main).toMatch(/stayView\?\.render\(t\)/);
    expect(main).toMatch(/stayView\?\.setTier\(tier\)/);
  });
});

describe('the finale sky\'s home mode', () => {
  it('setHome moves the shapes by homePlacement and fades the message as they leave the crown; null goes back to the finale\'s own', () => {
    expect(sky).toMatch(/home === null \? finalePlacement\(aspect, id, lift, join\) : homePlacement\(aspect, id, home\)/);
    expect(sky).toMatch(/messageAlpha\(home === null \? join : 1 - Math\.min\(1, home \/ STAY_WORLD\.acrossShare\)\)/);
    expect(sky).toMatch(/setHome\(k\)/);
  });
  it('the finale view never uses it, so the finale\'s pictures are unchanged', () => {
    expect(readFileSync('src/acts/finaleView.ts', 'utf8')).not.toMatch(/setHome/);
  });
});

describe('the ?stay view: the two exits (session 9)', () => {
  it('wires the letter and the ending through createStayControls on ONE shared bus, as the card does', () => {
    expect(view).toMatch(/const bus = createBus<WinterEvents>\(\)/);
    expect(view).toMatch(/createFinaleAct\(\{ bus, chainFrom: bus/);
    expect(view).toMatch(/createStayAwhileAct\(\{ bus, chainFrom: bus \}\)/);
    expect(view).toMatch(/createLetterFlow\(\{ act: letter, letter: content\.letter, credits: content\.credits/);
    expect(view).toMatch(/createStayControls\(\{ stay, letter, controls: replay \}\)/);
  });
  it('shows the letter exactly as content/letter.md gives it (no override, no edit)', () => {
    expect(view).not.toMatch(/params\.get\('text'\)/);
    expect(code(view)).not.toMatch(/content\.letter\.|content\.letter\)\.|\(content\.letter\b[^,]/);
    expect((code(view).match(/content\.letter\b/g) ?? []).length).toBe(1);
  });
  it('drives the letter and the ending to their ends silently BEFORE she is staying, so she arrives after them', () => {
    expect(view.indexOf('letter.close()')).toBeGreaterThan(0);
    expect(view.indexOf('letter.close()')).toBeLessThan(view.indexOf('createStayAwhileAct({'));
    expect(view.indexOf('finale.machine.finished')).toBeLessThan(view.indexOf('createStayAwhileAct({'));
  });
  it('gives the letter button focus back when the letter is put away (Phase 24 rule), in the flow and not by a hack in the view', () => {
    const flow = readFileSync('src/acts/letterFlow.ts', 'utf8');
    expect(flow).toMatch(/readAgainButton\.focus\(/);
    expect(view).not.toMatch(/\.focus\(/);
  });
});

describe('the replay column keeps focus when another button appears (session 9)', () => {
  it('moves a button only when it is out of place (re-appending a focused node drops its focus)', () => {
    const rc = readFileSync('src/ui/replayControls.ts', 'utf8');
    expect(rc).toMatch(/bar\.children\[i\] !== b/);
    expect(rc).not.toMatch(/for \(const k of order\) \{\s*const b = buttons\.get\(k\);\s*if \(b\) bar\.appendChild\(b\);/);
  });
});
