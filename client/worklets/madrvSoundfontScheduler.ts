/**
 * App-owned, cancellable MIDI scheduling. This queue deliberately does not use
 * SpessaSynth's private eventQueue: events reach the synth only when they are due.
 */
export type MadrvSoundfontMidi = {
  type: "madrv-midi";
  generation: number;
  sourceTrack: number;
  bytes: number[] | Uint8Array;
  targetAt: number;
};

export type MadrvSoundfontTiming = {
  type: "madrv-midi-timing";
  generation: number;
  appliedCount: number;
  /** Applications later than one render quantum, excluding normal quantization. */
  lateCount: number;
  maxLateSeconds: number;
  receivedLateCount: number;
  maxReceiptLateSeconds: number;
  lastTargetAt: number | null;
  lastAppliedAt: number | null;
  pendingCount: number;
};

type SchedulerOptions = {
  sampleRate: number;
  apply(event: MadrvSoundfontMidi): void;
  release(event: MadrvSoundfontMidi): void;
  stopAll(): void;
  report(timing: MadrvSoundfontTiming): void;
};

function isGeneration(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isTrack(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value < 32;
}

function isNoteMessage(event: MadrvSoundfontMidi): boolean {
  const status = event.bytes[0] & 0xf0;
  return status === 0x80 || status === 0x90;
}

function isNoteOn(event: MadrvSoundfontMidi): boolean {
  return (event.bytes[0] & 0xf0) === 0x90 && event.bytes[2] > 0;
}

export class MadrvSoundfontScheduler {
  private generation = 0;
  private queue: MadrvSoundfontMidi[] = [];
  private mutedTracks = new Set<number>();
  private ownedNotes = new Map<number, Set<number>>();
  private appliedCount = 0;
  private lateCount = 0;
  private maxLateSeconds = 0;
  private receivedLateCount = 0;
  private maxReceiptLateSeconds = 0;
  private lastTargetAt: number | null = null;
  private lastAppliedAt: number | null = null;
  private lastReportAt = Number.NEGATIVE_INFINITY;
  private dirty = false;

  constructor(private readonly options: SchedulerOptions) {}

  /** Returns true for app control messages, including invalid/stale ones. */
  handle(message: unknown, receivedAt: number): boolean {
    if (!message || typeof message !== "object") return false;
    const data = message as Record<string, unknown>;
    if (data.type !== "madrv-midi" && data.type !== "madrv-reset" && data.type !== "madrv-mute") return false;
    if (!isGeneration(data.generation)) return true;
    if (data.type === "madrv-reset") {
      if (data.generation < this.generation) return true;
      this.generation = data.generation;
      this.queue = [];
      this.ownedNotes.clear();
      this.appliedCount = 0;
      this.lateCount = 0;
      this.maxLateSeconds = 0;
      this.receivedLateCount = 0;
      this.maxReceiptLateSeconds = 0;
      this.lastTargetAt = null;
      this.lastAppliedAt = null;
      // Preserve transport mute state across a song replacement.
      this.options.stopAll();
      this.dirty = true;
      return true;
    }
    if (data.generation !== this.generation) return true;
    if (data.type === "madrv-mute") {
      if (!Array.isArray(data.tracks) || !data.tracks.every(isTrack)) return true;
      const muted = new Set(data.tracks);
      const newlyMuted = Array.from(muted).filter(track => !this.mutedTracks.has(track));
      this.mutedTracks = muted;
      this.queue = this.queue.filter(event => !muted.has(event.sourceTrack) || !isNoteMessage(event));
      newlyMuted.forEach(track => {
        this.ownedNotes.get(track)?.forEach(key => {
          // MIDI itself cannot independently release the same channel/key for
          // two score tracks. Leave another unmuted owner's shared note alone.
          const shared = Array.from(this.ownedNotes.entries()).some(([owner, notes]) => owner !== track && !muted.has(owner) && notes.has(key));
          if (!shared) this.options.release({
            type: "madrv-midi", generation: this.generation, sourceTrack: track,
            targetAt: receivedAt, bytes: [0x80 | (key >> 7), key & 127, 0],
          });
        });
        this.ownedNotes.delete(track);
      });
      this.dirty = true;
      return true;
    }
    if (!isTrack(data.sourceTrack) || typeof data.targetAt !== "number" || !Number.isFinite(data.targetAt)) return true;
    if ((!Array.isArray(data.bytes) && !(data.bytes instanceof Uint8Array)) || data.bytes.length === 0) return true;
    if (!Array.from(data.bytes).every(byte => Number.isInteger(byte) && byte >= 0 && byte <= 255)) return true;
    const event: MadrvSoundfontMidi = {
      type: "madrv-midi", generation: data.generation, sourceTrack: data.sourceTrack,
      targetAt: data.targetAt, bytes: Uint8Array.from(data.bytes),
    };
    if (this.mutedTracks.has(event.sourceTrack) && isNoteOn(event)) return true;
    const receiptLate = Math.max(0, receivedAt - event.targetAt);
    if (receiptLate > 0.000001) this.receivedLateCount += 1;
    this.maxReceiptLateSeconds = Math.max(this.maxReceiptLateSeconds, receiptLate);
    // Upper-bound insertion preserves MIDI ordering at equal deadlines without
    // shifting later deadlines to compensate for an earlier late message.
    let low = 0;
    let high = this.queue.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (this.queue[middle].targetAt <= event.targetAt) low = middle + 1;
      else high = middle;
    }
    this.queue.splice(low, 0, event);
    this.dirty = true;
    return true;
  }

  /** Called once per output render quantum, using AudioWorklet currentTime. */
  process(audioNow: number, quantumFrames = 128): void {
    const quantumSeconds = quantumFrames / this.options.sampleRate;
    let count = 0;
    while (count < this.queue.length && this.queue[count].targetAt <= audioNow + 1e-9) {
      const event = this.queue[count++];
      if (this.mutedTracks.has(event.sourceTrack) && isNoteOn(event)) continue;
      this.options.apply(event);
      this.rememberNotes(event);
      const lateSeconds = Math.max(0, audioNow - event.targetAt);
      if (lateSeconds > quantumSeconds + 0.000001) this.lateCount += 1;
      this.maxLateSeconds = Math.max(this.maxLateSeconds, lateSeconds);
      this.lastTargetAt = event.targetAt;
      this.lastAppliedAt = audioNow;
      this.appliedCount += 1;
    }
    if (count > 0) {
      this.queue.splice(0, count);
      this.dirty = true;
    }
    // Never post per note: dense pitch bends should not create main-thread UI
    // work. Keep the rate limit across generation changes as well.
    if (this.dirty && audioNow - this.lastReportAt >= 0.25) {
      this.lastReportAt = audioNow;
      this.dirty = false;
      this.options.report(this.snapshot());
    }
  }

  private rememberNotes(event: MadrvSoundfontMidi): void {
    const status = event.bytes[0] & 0xf0;
    const channel = event.bytes[0] & 0x0f;
    if (isNoteMessage(event) && event.bytes.length >= 2) {
      const key = (channel << 7) | (event.bytes[1] & 127);
      if (isNoteOn(event)) {
        const notes = this.ownedNotes.get(event.sourceTrack) ?? new Set<number>();
        notes.add(key);
        this.ownedNotes.set(event.sourceTrack, notes);
      } else {
        this.ownedNotes.get(event.sourceTrack)?.delete(key);
      }
    } else if (status === 0xb0 && (event.bytes[1] === 120 || event.bytes[1] === 123)) {
      // Channel-wide note termination affects every owner on that channel.
      this.ownedNotes.forEach(notes => notes.forEach(key => {
        if ((key >> 7) === channel) notes.delete(key);
      }));
    } else if (event.bytes[0] === 0xff) {
      this.ownedNotes.clear();
    }
  }

  snapshot(): MadrvSoundfontTiming {
    return {
      type: "madrv-midi-timing", generation: this.generation,
      appliedCount: this.appliedCount, lateCount: this.lateCount,
      maxLateSeconds: this.maxLateSeconds, receivedLateCount: this.receivedLateCount,
      maxReceiptLateSeconds: this.maxReceiptLateSeconds,
      lastTargetAt: this.lastTargetAt, lastAppliedAt: this.lastAppliedAt,
      pendingCount: this.queue.length,
    };
  }
}
