// The card's progress (constellations done, letter read, secrets found).
// localStorage, wrapped in try/catch, falling back to memory. No DOM types beyond Storage, no three.

export const PROGRESS_KEY = 'winterlight.progress.v1';
const SECRET_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface Progress {
  v: 1;
  constellations: string[];
  letterRead: boolean;
  secrets: string[];
}

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function emptyProgress(): Progress {
  return { v: 1, constellations: [], letterRead: false, secrets: [] };
}

export function createMemoryStorage(): KeyValueStorage {
  const m = new Map<string, string>();
  return {
    getItem: (k) => (m.has(k) ? m.get(k)! : null),
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
  };
}

/** localStorage if it really works (private mode, blocked cookies and full disks can all throw), else memory. */
export function pickStorage(): { storage: KeyValueStorage; persistent: boolean } {
  try {
    const s = window.localStorage;
    const probe = PROGRESS_KEY + '.probe';
    s.setItem(probe, '1');
    s.removeItem(probe);
    return { storage: s, persistent: true };
  } catch {
    return { storage: createMemoryStorage(), persistent: false };
  }
}

function ids(v: unknown, ok: (s: string) => boolean): string[] {
  if (!Array.isArray(v)) return [];
  return [...new Set(v.filter((x): x is string => typeof x === 'string' && ok(x)))];
}

/** Anything unreadable or odd becomes a clean default; a bad save must never break the card. */
export function parseProgress(raw: string | null): Progress {
  if (!raw) return emptyProgress();
  try {
    const o: unknown = JSON.parse(raw);
    if (typeof o !== 'object' || o === null) return emptyProgress();
    const r = o as Record<string, unknown>;
    return {
      v: 1,
      constellations: ids(r.constellations, (s) => SECRET_ID_RE.test(s)),
      letterRead: r.letterRead === true,
      secrets: ids(r.secrets, (s) => SECRET_ID_RE.test(s)),
    };
  } catch {
    return emptyProgress();
  }
}

export interface ProgressStore {
  get(): Progress;
  /** True if this was newly marked. Unknown ids (when `knownConstellations` is given) are ignored and return false. */
  markConstellation(id: string): boolean;
  markLetterRead(): boolean;
  markSecret(id: string): boolean;
  reset(): void;
  subscribe(fn: (p: Progress) => void): () => void;
  /** false when running from memory only (storage blocked, or a write failed): progress will not survive a reload. */
  readonly persistent: boolean;
}

export interface ProgressOptions {
  /** Defaults to pickStorage(). */
  storage?: KeyValueStorage;
  key?: string;
  /** If given, only these constellation ids can be marked. */
  knownConstellations?: readonly string[];
}

export function createProgress(opts: ProgressOptions = {}): ProgressStore {
  const key = opts.key ?? PROGRESS_KEY;
  const picked = opts.storage ? { storage: opts.storage, persistent: true } : pickStorage();
  let storage = picked.storage;
  let persistent = picked.persistent;
  const listeners = new Set<(p: Progress) => void>();

  let state: Progress;
  try {
    state = parseProgress(storage.getItem(key));
  } catch {
    // Reading threw: fall back to memory and start clean.
    storage = createMemoryStorage();
    persistent = false;
    state = emptyProgress();
  }

  function snapshot(): Progress {
    return { v: 1, constellations: [...state.constellations], letterRead: state.letterRead, secrets: [...state.secrets] };
  }

  function commit(): void {
    try {
      storage.setItem(key, JSON.stringify(state));
    } catch {
      // Write failed (quota, blocked mid-session): keep going from memory, remember we are no longer saving.
      const mem = createMemoryStorage();
      mem.setItem(key, JSON.stringify(state));
      storage = mem;
      persistent = false;
    }
    const snap = snapshot();
    for (const fn of [...listeners]) {
      try {
        fn(snap);
      } catch (err) {
        console.error(err);
      }
    }
  }

  return {
    get: snapshot,
    markConstellation(id) {
      if (!SECRET_ID_RE.test(id)) return false;
      if (opts.knownConstellations && !opts.knownConstellations.includes(id)) return false;
      if (state.constellations.includes(id)) return false;
      state.constellations.push(id);
      commit();
      return true;
    },
    markLetterRead() {
      if (state.letterRead) return false;
      state.letterRead = true;
      commit();
      return true;
    },
    markSecret(id) {
      if (!SECRET_ID_RE.test(id) || state.secrets.includes(id)) return false;
      state.secrets.push(id);
      commit();
      return true;
    },
    reset() {
      state = emptyProgress();
      try {
        storage.removeItem(key);
      } catch {
        persistent = false;
      }
      const snap = snapshot();
      for (const fn of [...listeners]) fn(snap);
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },
    get persistent() {
      return persistent;
    },
  };
}
