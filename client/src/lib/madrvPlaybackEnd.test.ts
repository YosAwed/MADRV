import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MdrPlaybackClock, SignalDeckAudio, type ScheduledMdrMidiEvent } from "./madrvEngine";

const midiFixture = vi.hoisted(() => ({
  events: [] as ScheduledMdrMidiEvent[],
  loopWindow: undefined as { startSeconds: number; endSeconds: number } | undefined,
}));

// Exercise playMdr's real transport with deterministic converter output, without
// requiring a browser, a SoundFont bank, or the asynchronous WASM download.
vi.mock("/manus-storage/madrv-midi-events-v4_b2d6bf6b.mjs", () => ({
  default: async () => {
    const heap = new Uint8Array(1_048_576);
    let allocation = 8;
    let payload = new Uint8Array();
    return {
      HEAPU8: heap,
      _malloc: (size: number) => { const pointer = allocation; allocation += size; return pointer; },
      _free: () => {},
      _madrv_extract_midi: () => {
        payload = new Uint8Array(4 + midiFixture.events.reduce((size, event) => size + 16 + event.bytes.length, 0));
        const view = new DataView(payload.buffer);
        view.setUint32(0, midiFixture.events.length, true);
        let offset = 4;
        for (const event of midiFixture.events) {
          view.setBigUint64(offset, BigInt(Math.round(event.at * 1_000_000)), true);
          view.setUint32(offset + 8, event.sourceTrack, true);
          view.setUint32(offset + 12, event.bytes.length, true);
          payload.set(event.bytes, offset + 16);
          offset += 16 + event.bytes.length;
        }
        return payload.length;
      },
      _madrv_copy_midi: (pointer: number) => { heap.set(payload, pointer); return payload.length; },
      _madrv_midi_has_song_loop: () => midiFixture.loopWindow ? 1 : 0,
      _madrv_midi_loop_start_seconds: () => midiFixture.loopWindow?.startSeconds,
      _madrv_midi_loop_end_seconds: () => midiFixture.loopWindow?.endSeconds,
    };
  },
}));

type EngineInternals = {
  context: unknown;
  masterGain: unknown;
  gains: unknown;
  gsLoaded: boolean;
  gsSynth: unknown;
  mdrPlayer: unknown;
  mutedMdrTracks: Set<number>;
  playbackGeneration: number;
  mdrMidiTimelineComplete: boolean;
  mdrMidiLastEventAt: number | null;
  mdrSoundFontQueue: { pendingCount: number; latestTargetAt: number | null };
  startMdrMidiTimeline(events: readonly ScheduledMdrMidiEvent[], startsAt: number, loopWindow?: { startSeconds: number; endSeconds: number }): void;
  hasMdrMidiTailElapsed(): boolean;
  isMdrMidiPlaybackDrained(): boolean;
};

function makeMdr() {
  const title = new TextEncoder().encode("Termination regression\r\n\x1aNONE\0");
  const table = new Uint8Array(66);
  const tracks: number[] = [];
  let offset = 66;
  for (let index = 0; index < 32; index += 1) {
    table[2 + index * 2] = offset >> 8;
    table[3 + index * 2] = offset & 0xff;
    const track = index === 0 ? [0xe0, 0xff, 0xe0, 0x08, 0x00, 0x80, 0x03, 0xf1, 0x00] : [0xf1, 0x00];
    tracks.push(...track);
    offset += track.length;
  }
  table[0] = offset >> 8;
  table[1] = offset & 0xff;
  const bytes = new Uint8Array(title.length + table.length + tracks.length);
  bytes.set(title);
  bytes.set(table, title.length);
  bytes.set(tracks, title.length + table.length);
  return bytes.buffer;
}

function createHarness(sampleRate = 48_000) {
  let forcedAudioTime: number | undefined;
  const node = { connect: vi.fn(), disconnect: vi.fn(), onaudioprocess: undefined as ((event: unknown) => void) | undefined };
  const context = {
    get currentTime() { return forcedAudioTime ?? Date.now() / 1000; },
    sampleRate,
    resume: vi.fn(async () => {}),
    createScriptProcessor: vi.fn(() => node),
  };
  const gain = () => ({
    gain: { value: 0.72, cancelScheduledValues: vi.fn(), setValueAtTime: vi.fn(), setTargetAtTime: vi.fn() },
    connect: vi.fn(),
  });
  const synth = { noteOn: vi.fn(), noteOff: vi.fn(), sendMessage: vi.fn(), systemExclusive: vi.fn(), stopAll: vi.fn() };
  const hardware = { milliseconds: undefined as number | null | undefined, terminated: false, terminateOnRender: false, duration: 0.2 };
  const player = {
    getPlayAtMilliseconds: vi.fn(() => hardware.milliseconds === undefined ? context.currentTime * 1000 + 300 : hardware.milliseconds),
    isTerminated: vi.fn(() => hardware.terminated),
    stop: vi.fn(),
    start: vi.fn(),
    setChannelMask: vi.fn(),
    getPcmActiveMask: vi.fn(() => 0),
    getHardwareTrackMidiNote: vi.fn(() => null),
    getTimerB: vi.fn(() => 200),
    load: vi.fn(async () => ({ duration: hardware.duration, format: "MDR / OPM + PDX" })),
    measureDuration: vi.fn((loops: number) => hardware.duration * loops),
    renderInto: vi.fn(() => { if (hardware.terminateOnRender) hardware.terminated = true; return 0; }),
  };
  const engine = new SignalDeckAudio();
  const internal = engine as unknown as EngineInternals;
  Object.assign(internal, { context, masterGain: gain(), gains: { opm: gain(), pcm: gain(), midi: gain() }, gsLoaded: true, gsSynth: synth, mdrPlayer: player });
  return {
    engine, internal, context, synth, hardware, player, node,
    advance: (milliseconds: number) => vi.advanceTimersByTime(milliseconds),
    forceAudioTime: (seconds: number | undefined) => { forcedAudioTime = seconds; },
    process: (playbackTime: number, frames = 2048) => node.onaudioprocess?.({ playbackTime, outputBuffer: { getChannelData: () => new Float32Array(frames) } }),
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date", "performance", "setTimeout", "clearTimeout"] });
  vi.setSystemTime(0);
  vi.stubGlobal("window", globalThis);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => setTimeout(() => callback(performance.now()), 16));
  vi.stubGlobal("cancelAnimationFrame", (handle: ReturnType<typeof setTimeout>) => clearTimeout(handle));
  midiFixture.events = [];
  midiFixture.loopWindow = undefined;
});

afterEach(() => {
  vi.clearAllTimers();
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("MDR playback clock at the hardware ending", () => {
  it("removes the initial hardware buffering offset only once", () => {
    const clock = new MdrPlaybackClock();
    expect(clock.read(0, 300, false)).toBe(0);
    expect(clock.read(0.1, 430, false)).toBeCloseTo(0.13);
    expect(clock.read(0.2, 490, false)).toBeCloseTo(0.19);
  });

  it("continues from the final aligned song position rather than jumping to a skewed wall clock", () => {
    const clock = new MdrPlaybackClock();
    clock.read(0, 300, false);
    expect(clock.read(20, 8300, true)).toBe(8);
    expect(clock.read(20.5, 8300, true)).toBe(8.5);
    // A terminated core can still report advancing counters; ignore them.
    expect(clock.read(21, 9700, true)).toBe(9);
  });

  it("retains raw hardware position for progress and continues it after termination", () => {
    const clock = new MdrPlaybackClock(false);
    expect(clock.read(0, 300, false)).toBe(0.3);
    expect(clock.read(10, 8300, true)).toBe(8.3);
    expect(clock.read(11, 8300, true)).toBe(9.3);
  });

  it("uses the audio clock for GS-only sources with no hardware counter", () => {
    const clock = new MdrPlaybackClock();
    expect(clock.read(0.2, null, false)).toBe(0.2);
    expect(clock.read(1.2, null, false)).toBe(1.2);
    expect(clock.read(2.2, null, true)).toBe(2.2);
    expect(clock.read(3.2, null, true)).toBe(3.2);
  });

  it("continues when hardware already terminated in the first buffered block", () => {
    const clock = new MdrPlaybackClock();
    expect(clock.read(0, 42, true)).toBe(0);
    expect(clock.read(0.5, 42, true)).toBe(0.5);
  });
});

describe("hybrid MIDI draining", () => {
  it("sends a later note-off after OPM/PCM has ended and its counter freezes", () => {
    const h = createHarness();
    h.internal.startMdrMidiTimeline([
      { at: 0, sourceTrack: 16, bytes: [0x90, 60, 100] },
      { at: 1, sourceTrack: 16, bytes: [0x80, 60, 0] },
    ], 0);
    expect(h.synth.noteOn).toHaveBeenCalledOnce();
    h.advance(100);
    h.hardware.milliseconds = 420;
    h.hardware.terminated = true;
    h.advance(900);
    expect(h.synth.noteOff).toHaveBeenCalledOnce();
    expect(h.synth.noteOff.mock.calls[0][2].time).toBeCloseTo(1);
    expect(h.internal.isMdrMidiPlaybackDrained()).toBe(false);
    h.advance(1501);
    expect(h.internal.isMdrMidiPlaybackDrained()).toBe(true);
  });

  it("distinguishes cursor completion, an unsent queue, a future Worklet target, and the release tail", () => {
    const h = createHarness();
    h.internal.startMdrMidiTimeline([{ at: 0.1, sourceTrack: 16, bytes: [0x80, 60, 0] }], 0);
    expect(h.internal.mdrMidiTimelineComplete).toBe(true);
    expect(h.internal.mdrSoundFontQueue.pendingCount).toBe(1);
    expect(h.internal.isMdrMidiPlaybackDrained()).toBe(false);
    h.advance(61);
    expect(h.internal.mdrSoundFontQueue.pendingCount).toBe(0);
    expect(h.synth.noteOff).toHaveBeenCalledWith(0, 60, { time: 0.1 });
    expect(h.context.currentTime).toBeLessThan(0.1);
    expect(h.internal.isMdrMidiPlaybackDrained()).toBe(false);
    h.advance(1538);
    expect(h.internal.isMdrMidiPlaybackDrained()).toBe(false);
    h.advance(2);
    expect(h.internal.isMdrMidiPlaybackDrained()).toBe(true);
  });

  it("extends release time when a delayed main-thread dispatch is clamped to audio now", () => {
    const h = createHarness();
    h.internal.startMdrMidiTimeline([{ at: 0.1, sourceTrack: 16, bytes: [0x80, 60, 0] }], 0);
    h.forceAudioTime(1);
    h.advance(61);
    expect(h.synth.noteOff).toHaveBeenCalledWith(0, 60, { time: 1 });
    expect(h.internal.mdrMidiLastEventAt).toBe(1);
    h.forceAudioTime(2.49);
    expect(h.internal.isMdrMidiPlaybackDrained()).toBe(false);
    h.forceAudioTime(2.5);
    expect(h.internal.isMdrMidiPlaybackDrained()).toBe(true);
  });

  it("preserves a muted track's musical ending without sending notes", () => {
    const h = createHarness();
    h.internal.mutedMdrTracks.add(16);
    h.internal.startMdrMidiTimeline([{ at: 0.1, sourceTrack: 16, bytes: [0x80, 60, 0] }], 0);
    expect(h.internal.mdrMidiTimelineComplete).toBe(true);
    expect(h.internal.mdrSoundFontQueue.pendingCount).toBe(0);
    expect(h.synth.noteOff).not.toHaveBeenCalled();
    expect(h.internal.isMdrMidiPlaybackDrained()).toBe(false);
    h.advance(1601);
    expect(h.internal.isMdrMidiPlaybackDrained()).toBe(true);
  });

  it("clears pending events, deadlines, and the old generation on manual stop", () => {
    const h = createHarness();
    h.internal.startMdrMidiTimeline([{ at: 0.1, sourceTrack: 16, bytes: [0x90, 60, 100] }], 0);
    const generation = h.internal.playbackGeneration;
    expect(h.internal.mdrSoundFontQueue.pendingCount).toBe(1);
    h.engine.stop();
    expect(h.internal.playbackGeneration).toBe(generation + 1);
    expect(h.internal.mdrMidiLastEventAt).toBeNull();
    expect(h.internal.mdrSoundFontQueue.latestTargetAt).toBeNull();
    expect(h.internal.mdrSoundFontQueue.pendingCount).toBe(0);
    h.advance(2000);
    expect(h.synth.noteOn).not.toHaveBeenCalled();
    expect(h.synth.stopAll).toHaveBeenCalledWith(true);
  });

  it("does not add a release wait to a source without MIDI events", () => {
    const h = createHarness();
    h.internal.startMdrMidiTimeline([], 0);
    expect(h.internal.isMdrMidiPlaybackDrained()).toBe(true);
  });

  it("does not mark an infinite MIDI timeline complete at the first pass", () => {
    const h = createHarness();
    h.internal.startMdrMidiTimeline([{ at: 0, sourceTrack: 16, bytes: [0x90, 60, 100] }], 0, { startSeconds: 0, endSeconds: 1 });
    h.advance(3000);
    expect(h.synth.noteOn.mock.calls.length).toBeGreaterThan(1);
    expect(h.internal.mdrMidiTimelineComplete).toBe(false);
    expect(h.internal.isMdrMidiPlaybackDrained()).toBe(false);
  });
});

describe("finite MDR transport completion", () => {
  it("keeps progress and trailing MIDI running after the hardware ends, then finishes naturally", async () => {
    const h = createHarness();
    midiFixture.events = [
      { at: 0, sourceTrack: 16, bytes: [0x90, 60, 100] },
      { at: 1, sourceTrack: 16, bytes: [0x80, 60, 0] },
    ];
    const onEnd = vi.fn();
    const onProgress = vi.fn();
    await h.engine.playMdr(makeMdr(), undefined, 1, onProgress, onEnd);
    h.process(0);
    h.advance(60);
    h.hardware.milliseconds = 380;
    h.hardware.terminateOnRender = true;
    h.process(0.08);
    h.advance(1940);
    expect(h.synth.noteOff).toHaveBeenCalledOnce();
    expect(onProgress.mock.calls.at(-1)![0]).toBeGreaterThan(1);
    expect(onEnd).not.toHaveBeenCalled();
    h.advance(600);
    expect(onEnd).toHaveBeenCalledOnce();
    expect(onProgress).toHaveBeenLastCalledWith(2.5);
  });

  it("waits for the last output block at the actual output sample rate and finishes once", async () => {
    const h = createHarness(44_100);
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    const onEnd = vi.fn();
    await h.engine.playMdr(makeMdr(), undefined, 1, vi.fn(), onEnd);
    h.hardware.terminateOnRender = true;
    h.process(0.2, 4410);
    h.advance(299);
    expect(onEnd).not.toHaveBeenCalled();
    // A later silent callback must not move the already latched end deadline.
    h.process(0.5, 4410);
    h.advance(21);
    expect(onEnd).toHaveBeenCalledOnce();
    expect(h.node.disconnect).toHaveBeenCalledOnce();
    h.advance(61_000);
    expect(onEnd).toHaveBeenCalledOnce();
    expect(warning).toHaveBeenCalledOnce();
    warning.mockRestore();
  });

  it("does not let the finite-loop timer truncate pending MIDI or its late release", async () => {
    const h = createHarness();
    h.hardware.duration = 1;
    midiFixture.events = [{ at: 0.9, sourceTrack: 16, bytes: [0x80, 60, 0] }];
    midiFixture.loopWindow = { startSeconds: 0, endSeconds: 1 };
    const onEnd = vi.fn();
    await h.engine.playMdr(makeMdr(), undefined, 1, vi.fn(), onEnd);
    h.process(0);
    h.advance(760);
    expect(h.internal.mdrSoundFontQueue.pendingCount).toBe(1);
    // Simulate a late queue dispatch at audio t=3 rather than its original 0.9.
    h.forceAudioTime(3);
    h.advance(1800);
    expect(h.synth.noteOff).toHaveBeenCalledOnce();
    expect(h.internal.mdrMidiLastEventAt).toBe(3);
    expect(onEnd).not.toHaveBeenCalled();
    h.forceAudioTime(4.49);
    h.advance(50);
    expect(onEnd).not.toHaveBeenCalled();
    h.forceAudioTime(4.5);
    h.advance(50);
    expect(onEnd).toHaveBeenCalledOnce();
    h.advance(61_000);
    expect(onEnd).toHaveBeenCalledOnce();
  });

  it("never calls the natural ending after a manual stop", async () => {
    const h = createHarness();
    const onEnd = vi.fn();
    await h.engine.playMdr(makeMdr(), undefined, 1, vi.fn(), onEnd);
    h.process(0);
    h.engine.stop();
    h.hardware.terminated = true;
    h.advance(61_000);
    expect(onEnd).not.toHaveBeenCalled();
  });

  it("keeps callbacks from a replaced song from ending the new playback", async () => {
    const h = createHarness();
    const previousEnd = vi.fn();
    const currentEnd = vi.fn();
    await h.engine.playMdr(makeMdr(), undefined, 1, vi.fn(), previousEnd);
    h.process(0);
    h.advance(16);
    await h.engine.playMdr(makeMdr(), undefined, 1, vi.fn(), currentEnd);
    h.hardware.terminateOnRender = true;
    h.process(0.2);
    h.advance(300);
    expect(previousEnd).not.toHaveBeenCalled();
    expect(currentEnd).toHaveBeenCalledOnce();
    h.advance(61_000);
    expect(previousEnd).not.toHaveBeenCalled();
    expect(currentEnd).toHaveBeenCalledOnce();
  });
});
