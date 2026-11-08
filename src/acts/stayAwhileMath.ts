// Phase 28: "stay a while" as a small machine. Pure (no three, no DOM, no clock, no random).
//
//   idle --enter()--> staying --exit('letter' | 'replay')--> left --enter()--> staying ...
//
// Rules, kept here so a test can pin them (the phase's own check: "stay-a-while never traps the user"):
//   * There is NO timer and NO ending: she can stay for ever and nothing happens by itself.
//   * From the moment she is staying, BOTH exits are on offer in every state and every activity: back to the letter and the replay. Nothing she is doing (petting, wandering, a
//     wish card, a constellation) removes an exit, and `exit()` never refuses while she is staying.
//   * Activities are only labels of what she is doing (wander, pet, constellations, wishes, secrets). They add no mechanic and gate nothing.
//   * `enter()` works again after an exit, so the replay and the letter can both lead back here.
// Every name is plain and functional; nothing here is a sentence for her to read.

export type StayPhase = 'idle' | 'staying' | 'left';
export type StayExit = 'letter' | 'replay';
export type StayActivity = 'wander' | 'pet' | 'constellations' | 'wishes' | 'secrets';

/** the exits, in the order a control should list them */
export const STAY_EXITS: readonly StayExit[] = ['letter', 'replay'];
export const STAY_ACTIVITIES: readonly StayActivity[] = ['wander', 'pet', 'constellations', 'wishes', 'secrets'];

export type StayEvent = { type: 'enter' } | { type: 'exit'; to: StayExit } | { type: 'activity'; activity: StayActivity };

export interface StayOptions {
  onEvent?: (e: StayEvent) => void;
}

export class StayAwhileMachine {
  private p: StayPhase = 'idle';
  private act: StayActivity = 'wander';
  private visits = 0;
  readonly log: StayEvent[] = [];
  private readonly onEvent: (e: StayEvent) => void;

  constructor(o: StayOptions = {}) {
    this.onEvent = o.onEvent ?? (() => undefined);
  }

  get phase(): StayPhase {
    return this.p;
  }
  get staying(): boolean {
    return this.p === 'staying';
  }
  get activity(): StayActivity {
    return this.act;
  }
  /** how many times she has come into stay a while */
  get timesEntered(): number {
    return this.visits;
  }
  /** the exits on offer right now: both, always, while she is staying; none when she is not here */
  get exits(): readonly StayExit[] {
    return this.p === 'staying' ? STAY_EXITS : [];
  }

  private emit(e: StayEvent): void {
    this.log.push(e);
    if (this.log.length > 100) this.log.shift();
    try {
      this.onEvent(e);
    } catch {
      /* one bad listener never traps her */
    }
  }

  /** Begin (the finale is done, or she came back). A second call while staying does nothing. */
  enter(): boolean {
    if (this.p === 'staying') return false;
    this.p = 'staying';
    this.act = 'wander';
    this.visits++;
    this.emit({ type: 'enter' });
    return true;
  }

  /** She goes to the letter or to the replay. Always works while she is staying; unknown names are refused. */
  exit(to: StayExit): boolean {
    if (this.p !== 'staying') return false;
    if (!STAY_EXITS.includes(to)) return false;
    this.p = 'left';
    this.emit({ type: 'exit', to });
    return true;
  }

  /** A label for what she is doing now (for the card to listen to). Never gates anything and never changes the exits. */
  setActivity(a: StayActivity): boolean {
    if (this.p !== 'staying' || !STAY_ACTIVITIES.includes(a)) return false;
    if (a === this.act) return true;
    this.act = a;
    this.emit({ type: 'activity', activity: a });
    return true;
  }
}
