type QueueEntry<Event> = {
  event: Event;
  targetAt: number;
  early: boolean;
};

export type OrderedMidiQueueOptions<Event, TimerHandle> = {
  now(): number;
  /**
   * Optional amount of time by which an event may be handed to the audio
   * scheduler before its deadline. The event keeps its original targetAt;
   * only the main-thread dispatch is moved earlier.
   */
  dispatchLeadSeconds?(): number;
  schedule(callback: () => void, delayMs: number): TimerHandle;
  cancel(handle: TimerHandle): void;
  dispatch(event: Event, targetAt: number): void;
};

/** Keeps MIDI messages in score order when live-clock corrections move deadlines backwards. */
export class OrderedMidiQueue<Event, TimerHandle = number> {
  private entries: QueueEntry<Event>[] = [];
  private head = 0;
  private lastTargetAt = Number.NEGATIVE_INFINITY;
  private timer: { handle: TimerHandle } | undefined;
  private timerGeneration = 0;
  private draining = false;

  constructor(
    private readonly options: OrderedMidiQueueOptions<Event, TimerHandle>
  ) {}

  /** Messages not yet handed to the audio scheduler; zero does not mean they have played. */
  get pendingCount(): number {
    return this.entries.length - this.head;
  }

  /** Latest effective playback deadline, retained after dispatch until clear(). */
  get latestTargetAt(): number | null {
    return this.lastTargetAt === Number.NEGATIVE_INFINITY ? null : this.lastTargetAt;
  }

  /** Early events may be handed to an audio scheduler as soon as all prior messages are dispatched. */
  enqueue(event: Event, targetAt: number, early = false): void {
    const finiteTarget = Number.isFinite(targetAt)
      ? targetAt
      : this.options.now();
    const effectiveTarget = Math.max(this.lastTargetAt, finiteTarget);
    this.lastTargetAt = effectiveTarget;
    this.entries.push({ event, targetAt: effectiveTarget, early });
    this.drain();
  }

  clear(): void {
    this.timerGeneration += 1;
    if (this.timer) this.options.cancel(this.timer.handle);
    this.timer = undefined;
    this.entries = [];
    this.head = 0;
    this.lastTargetAt = Number.NEGATIVE_INFINITY;
  }

  private drain(): void {
    if (this.draining || this.timer) return;
    this.draining = true;
    try {
      while (this.head < this.entries.length) {
        const entry = this.entries[this.head]!;
        const leadSeconds = this.options.dispatchLeadSeconds?.() ?? 0;
        const safeLeadSeconds = Number.isFinite(leadSeconds) ? Math.max(0, leadSeconds) : 0;
        const delayMs = (entry.targetAt - this.options.now() - safeLeadSeconds) * 1000;
        // Treat sub-millisecond rounding noise as due. Without this guard a
        // timer scheduled for `targetAt - lead` can wake a few floating-point
        // ulps early and immediately schedule another 1 ms timer.
        if (!entry.early && delayMs > 0.5) {
          const generation = ++this.timerGeneration;
          const handle = this.options.schedule(
            () => {
              if (generation !== this.timerGeneration) return;
              this.timer = undefined;
              this.drain();
            },
            Math.max(1, delayMs)
          );
          this.timer = { handle };
          break;
        }
        this.head += 1;
        this.options.dispatch(entry.event, entry.targetAt);
      }
      if (this.head === this.entries.length) {
        this.entries = [];
        this.head = 0;
      } else if (this.head >= 1024 && this.head * 2 >= this.entries.length) {
        this.entries = this.entries.slice(this.head);
        this.head = 0;
      }
    } finally {
      this.draining = false;
    }
  }
}
