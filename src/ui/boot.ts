import { runTasks, type BootTask } from '../core/bootTasks';
import { BOOT_TEXT, describeFailure, type FailKind } from './bootText';
import { ProgressEase, stallLevel } from './bootMath';

// Phase 17: the loading screen, as the page's first thing. `index.html` already carries it (markup, styles, the falling snow, a slow creeping bar and the plain-words
// failure messages), so it is on screen while the script is still downloading on a weak connection. This file ADOPTS that markup: it takes the bar over from where the
// creep had got to, drives it with the real boot progress, and fades the screen away when the first frame is up. The snow is CSS (it runs on the compositor), so it
// keeps falling while the heavy parts are being built.
// It never talks to the scene. The app hands it a task list; failures show as plain words with a Reload button.

export interface BootScreen {
  /** run the tasks with the bar following; resolves when all are done (the screen stays up until `finish`); a failing task shows the failure screen and rejects */
  run(tasks: readonly BootTask[]): Promise<void>;
  /** the bar runs to full and the screen fades away; safe to call twice */
  finish(): Promise<void>;
  /** show a failure in plain words (the first failure wins) */
  fail(kind: FailKind): void;
  /** a notice over the picture that can go away again (the 3D context was lost and may come back) */
  notice(kind: FailKind): void;
  clearNotice(): void;
  readonly done: boolean;
}

interface SplashWindow extends Window {
  __splash?: { adopted: boolean; done: boolean; failed: boolean };
}

export function adoptBootScreen(opts: { reducedMotion?: boolean; doc?: Document } = {}): BootScreen {
  const doc = opts.doc ?? document;
  const win = (doc.defaultView ?? window) as SplashWindow;
  const root = doc.getElementById('splash');
  const fill = doc.getElementById('splash-fill') as HTMLElement | null;
  const msg = doc.getElementById('splash-msg');
  const title = doc.getElementById('splash-title');
  const reload = doc.getElementById('splash-reload') as HTMLButtonElement | null;
  const state = (win.__splash ??= { adopted: false, done: false, failed: false });
  state.adopted = true;
  const reduced = !!opts.reducedMotion;

  // take the bar over from where the CSS creep had got to
  const ease = new ProgressEase(fill && fill.offsetWidth > 0 ? fill.getBoundingClientRect().width / fill.offsetWidth : 0);
  if (fill) {
    fill.style.animation = 'none';
    fill.style.transition = 'none';
    fill.style.transform = `scaleX(${ease.shown})`;
    void fill.offsetWidth; // flush, so the next write animates from here
  }
  reload?.addEventListener('click', () => win.location.reload());

  let target = 0;
  let finished = false;
  let failed = state.failed; // the page's own script may have failed already (no WebGL): keep its words, do not paint "getting things ready" over them
  let lastMove = now();
  let last = now();
  let raf = 0;

  function now(): number {
    return (win.performance ?? performance).now() / 1000;
  }
  const setMsg = (text: string): void => {
    if (msg) msg.textContent = text;
  };
  const show = (el: HTMLElement | null, on: boolean): void => {
    if (el) el.hidden = !on;
  };

  function tick(): void {
    raf = 0;
    if (failed || (finished && ease.shown >= 1)) return;
    const t = now();
    const shown = ease.update(t - last, target, finished);
    last = t;
    if (fill) {
      fill.style.transform = `scaleX(${shown})`;
    }
    if (!finished) {
      const st = stallLevel(t - lastMove);
      setMsg(st === 'stuck' ? BOOT_TEXT.stuck : st === 'slow' ? BOOT_TEXT.slow : BOOT_TEXT.loading);
      show(reload, st === 'stuck');
    }
    raf = win.requestAnimationFrame(tick);
  }
  const wake = (): void => {
    if (!raf && !failed) {
      last = now();
      raf = win.requestAnimationFrame(tick);
    }
  };
  wake();

  const paintTurn = (): Promise<void> =>
    new Promise((resolve) => {
      let ok = false;
      const go = (): void => {
        if (!ok) {
          ok = true;
          resolve();
        }
      };
      win.requestAnimationFrame(() => win.setTimeout(go, 0));
      win.setTimeout(go, 120); // a hidden tab never paints: do not wait for it
    });

  function showFailure(kind: FailKind, keepGoing: boolean): void {
    if (state.failed && !keepGoing) return;
    const d = describeFailure(kind);
    if (title) title.textContent = d.title;
    setMsg(d.body);
    show(title, true);
    show(reload, true);
    root?.classList.add('splash-fail');
    if (root) {
      root.hidden = false;
      root.style.opacity = '1';
      root.style.display = '';
    }
  }

  return {
    get done() {
      return finished;
    },
    async run(tasks) {
      try {
        await runTasks(tasks, {
          yieldFn: paintTurn,
          onProgress: (p) => {
            if (p > target) {
              target = p;
              lastMove = now();
            }
          },
        });
      } catch (e) {
        this.fail('script');
        throw e;
      }
    },
    async finish() {
      if (finished || failed) return;
      finished = true;
      target = 1;
      wake();
      state.done = true;
      // let the bar reach full (a short moment), then fade
      await new Promise<void>((r) => win.setTimeout(r, reduced ? 80 : 450));
      if (root) {
        root.style.transition = `opacity ${reduced ? 0.15 : 0.7}s ease`;
        root.style.opacity = '0';
        await new Promise<void>((r) => win.setTimeout(r, reduced ? 180 : 760));
        root.style.display = 'none';
        root.querySelector('.splash-snow')?.replaceChildren(); // the flakes stop costing anything
      }
    },
    fail(kind) {
      if (state.failed) return;
      failed = true;
      state.failed = true;
      showFailure(kind, true);
      if (fill) fill.parentElement!.hidden = true;
    },
    notice(kind) {
      if (state.failed) return;
      const d = describeFailure(kind);
      if (!root) return;
      root.classList.add('splash-notice');
      if (title) title.textContent = d.title;
      setMsg(d.body);
      show(title, true);
      show(reload, true);
      if (fill) fill.parentElement!.hidden = true;
      root.hidden = false;
      root.style.display = '';
      root.style.transition = 'none';
      root.style.opacity = '1';
    },
    clearNotice() {
      if (state.failed || !root || !root.classList.contains('splash-notice')) return;
      root.classList.remove('splash-notice');
      root.style.display = 'none';
      show(title, false);
      show(reload, false);
    },
  };
}
