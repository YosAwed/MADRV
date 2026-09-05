type QueueEntry<Event> = {
  event: Event;
  targetAt: number;
  early: boolean;
};

export type OrderedMidiQueueOptions<Event, TimerHandle> = {
  now(): number;
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
        const delayMs = (entry.targetAt - this.options.now()) * 1000;
        if (!entry.early && delayMs > 0) {
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
