import { TiltFilter, nextTiltState, type TiltEvent, type TiltState } from './tiltMath';

// Phase 18: the gyro. Asks permission the way iOS wants it (from a tap), stays off quietly everywhere else (desktop, denied, insecure page, switched off),
// and never throws. `value()` is a gentle -1..1 per axis for the camera's parallax; the meaning is the director's and the acts'.

export interface Tilt {
  readonly state: TiltState;
  /** per frame, after `step` the value is current */
  step(dt: number): void;
  value(): { x: number; y: number };
  /** Call from a tap or a click (iOS refuses otherwise). Resolves to the state afterwards. On Android and desktop it just starts listening. */
  request(): Promise<TiltState>;
  /** switch it off (value goes to zero) / back on */
  disable(): void;
  enable(): void;
  setReducedMotion(on: boolean): void;
  onState(cb: (s: TiltState) => void): () => void;
  dispose(): void;
}

interface IosOrientationEvent {
  requestPermission?: () => Promise<'granted' | 'denied'>;
}

const NO_SENSOR_MS = 2000;

export function createTilt(opts: { reducedMotion: boolean }): Tilt {
  const filter = new TiltFilter({}, opts.reducedMotion);
  const subs = new Set<(s: TiltState) => void>();
  let state: TiltState = 'off';
  let listening = false;
  let timer = 0;

  const go = (ev: TiltEvent): void => {
    const next = nextTiltState(state, ev);
    if (next === state) return;
    state = next;
    for (const cb of [...subs]) cb(state);
  };

  const angle = (): number => {
    const o = typeof screen !== 'undefined' ? screen.orientation : undefined;
    if (o && Number.isFinite(o.angle)) return o.angle;
    const w = (window as unknown as { orientation?: number }).orientation;
    return typeof w === 'number' ? w : 0;
  };

  const onEvent = (e: DeviceOrientationEvent): void => {
    if (filter.push(e.gamma, e.beta, angle())) {
      window.clearTimeout(timer);
      go('sample');
    }
  };

  function listen(): void {
    if (listening) return;
    listening = true;
    window.addEventListener('deviceorientation', onEvent);
    go('init-listen');
    // a desktop browser may fire one event with nulls, or none at all: no valid reading within two seconds means no sensor
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      if (state === 'waiting') {
        unlisten();
        go('timeout');
      }
    }, NO_SENSOR_MS);
  }
  function unlisten(): void {
    if (!listening) return;
    listening = false;
    window.removeEventListener('deviceorientation', onEvent);
    window.clearTimeout(timer);
  }

  // first look: is there a sensor API, and is this page allowed to use it (secure context)? The machine starts at 'off' and the first event moves it.
  state = 'off';
  const Ctor = (typeof window !== 'undefined' ? (window as unknown as { DeviceOrientationEvent?: IosOrientationEvent }).DeviceOrientationEvent : undefined) as IosOrientationEvent | undefined;
  if (!Ctor || window.isSecureContext === false) go('init-unsupported');
  else if (typeof Ctor.requestPermission === 'function') go('init-needs-permission'); // iOS: only a tap may ask
  else listen(); // Android and desktop: just start listening; no valid reading in two seconds means no sensor

  return {
    get state() {
      return state;
    },
    step: (dt) => filter.step(dt),
    value: () => ({ x: filter.x, y: filter.y }),
    async request() {
      try {
        if (state === 'needs-permission' || state === 'denied') {
          const ask = Ctor?.requestPermission;
          if (typeof ask !== 'function') return state;
          const answer = await ask.call(Ctor);
          if (answer === 'granted') {
            go('granted');
            listen();
          } else go('refused');
        } else if (state === 'off') {
          this.enable();
        }
      } catch {
        go('refused'); // iOS throws if this was not called from a tap
      }
      return state;
    },
    disable() {
      unlisten();
      filter.reset();
      go('disable');
    },
    enable() {
      if (state !== 'off') return;
      go('enable');
      listen();
    },
    setReducedMotion: (on) => filter.setReduced(on),
    onState(cb) {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    dispose() {
      unlisten();
      subs.clear();
    },
  };
}
