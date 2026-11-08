// Phase 17: the boot sequence's task runner. Pure: no three, no DOM, so it is unit-tested.
// A boot is a list of tasks (build the sky, build the cabin, wait for the eye images, warm up the shaders ...). They run one after another, and between them
// the page gets a turn to paint (so the falling snow and the progress bar keep moving while the heavy parts are built a piece at a time, instead of one long freeze).
// Progress is weighted by how long each task is expected to take. The first task that throws stops the boot and is named in the error.

export type Report = (fractionOfThisTask: number) => void;

export interface BootTask {
  id: string;
  /** how big a share of the bar this task is (default 1) */
  weight?: number;
  run(report: Report): void | Promise<void>;
}

export class BootError extends Error {
  constructor(readonly taskId: string, readonly causeValue: unknown) {
    super(`boot task "${taskId}" failed: ${causeValue instanceof Error ? causeValue.message : String(causeValue)}`);
    this.name = 'BootError';
  }
}

export interface RunOptions {
  /** called with the overall progress 0..1 (never goes down) and the id of the task that just moved it */
  onProgress?: (p: number, taskId: string) => void;
  /** gives the page a turn between tasks; the default is a zero timeout, the UI passes one tied to the next paint */
  yieldFn?: () => Promise<void>;
}

const nextTurn = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
const clamp01 = (x: number): number => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0);

export async function runTasks(tasks: readonly BootTask[], opts: RunOptions = {}): Promise<void> {
  const yieldFn = opts.yieldFn ?? nextTurn;
  const weights = tasks.map((t) => (Number.isFinite(t.weight) && (t.weight as number) > 0 ? (t.weight as number) : 1));
  const total = weights.reduce((a, b) => a + b, 0);
  let shown = 0;
  const emit = (p: number, id: string): void => {
    shown = Math.max(shown, clamp01(p));
    opts.onProgress?.(shown, id);
  };
  let before = 0;
  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i]!;
    const w = weights[i]!;
    await yieldFn();
    try {
      await t.run((f) => emit((before + w * clamp01(f)) / total, t.id));
    } catch (e) {
      throw new BootError(t.id, e);
    }
    before += w;
    emit(before / total, t.id);
  }
  if (tasks.length === 0) emit(1, '');
}
