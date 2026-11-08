import { describe, it, expect } from 'vitest';
import { replayMusicBox } from '../src/audio/replay';

function fake(over: { muted?: boolean; plays?: number[] } = {}) {
  const log: string[] = [];
  const plays = over.plays ?? [3];
  let muted = over.muted ?? false;
  return {
    log,
    eng: {
      unlock: () => void log.push('unlock'),
      get muted() { return muted; },
      setMuted: (m: boolean) => { muted = m; log.push('setMuted ' + m); },
      birthday: () => { log.push('birthday'); return plays.shift() ?? 0; },
    },
  };
}

describe('replayMusicBox', () => {
  it('unlocks then plays', () => {
    const f = fake();
    expect(replayMusicBox(f.eng, () => {})).toBe('played');
    expect(f.log).toEqual(['unlock', 'birthday']);
  });
  it('un-mutes before playing (a silent replay would look broken)', () => {
    const f = fake({ muted: true });
    replayMusicBox(f.eng, () => {});
    expect(f.log).toEqual(['unlock', 'setMuted false', 'birthday']);
  });
  it('when the first try makes no sound (audio not running yet) it tries once more later', () => {
    const f = fake({ plays: [0, 2] });
    let later: (() => void) | null = null;
    expect(replayMusicBox(f.eng, (fn) => { later = fn; })).toBe('retry');
    later!();
    expect(f.log.filter((x) => x === 'birthday').length).toBe(2);
  });
  it('never throws', () => {
    const eng = { unlock: () => { throw new Error('x'); }, muted: false, setMuted: () => {}, birthday: () => 0 };
    expect(replayMusicBox(eng, () => {})).toBe('unavailable');
  });
});
