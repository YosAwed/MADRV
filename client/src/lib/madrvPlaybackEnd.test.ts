import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MdrPlaybackClock, SignalDeckAudio, type ScheduledMdrMidiEvent } from "./madrvEngine";

const midiFixture = vi.hoisted(() => ({
  events: [] as ScheduledMdrMidiEvent[],
  loopWindow: undefined as { startSeconds: number; endSeconds: number } | undefined,
  sampleRate: 0,
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
      _madrv_extract_midi: (_pointer: number, _size: number, _loops: number, sampleRate: number) => {
        midiFixture.sampleRate = sampleRate;
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
  gsMidiPort?: { postMessage(message: unknown): void };
  pendingMidiRestore?: { generation: number; requestId: number; resolve(): void };
  mdrPreparationGeneration?: number;
  assertSoundFontCanBeReplaced(): void;
  midiOutput?: { send: ReturnType<typeof vi.fn> };
  mdrPlayer: unknown;
  mutedMdrTracks: Set<number>;
  playbackGeneration: number;
  mdrMidiTimelineComplete: boolean;
  mdrMidiLastEventAt: number | null;
  mdrSoundFontQueue: { pendingCount: number; latestTargetAt: number | null };
  mdrHardwareTrackIndexes: number[];
  mdrHardwareTrackRawIndexes: Map<number, number>;
  mdrHardwareVisualQueue: { pendingCount: number; latestTargetAt: number | null };
  reportHardwareTrackKeysFromRaw(rawNotes: unknown): void;
  renderMdrOutputBlock(left: Float32Array, right: Float32Array, blockPlaybackTime: number): number;
  startMdrMidiTimeline(events: readonly ScheduledMdrMidiEvent[], startsAt: number, loopWindow?: { startSeconds: number; endSeconds: number }): void;
  hasMdrMidiTailElapsed(): boolean;
  isMdrMidiPlaybackDrained(): boolean;
};

function makeMdr(activeTrack = 0) {
  const title = new TextEncoder().encode("Termination regression\r\n\x1aNONE\0");
  const table = new Uint8Array(66);
  const tracks: number[] = [];
  let offset = 66;
  for (let index = 0; index < 32; index += 1) {
    table[2 + index * 2] = offset >> 8;
    table[3 + index * 2] = offset & 0xff;
    const track = index === activeTrack ? [0xe0, 0xff, 0xe0, 0x08, activeTrack >= 16 ? 0x80 : 0, 0x80, 0x03, 0xf1, 0x00]
      : index === 0 ? [0xe0, 0xff, 0xf1, 0x00] : [0xf1, 0x00];
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
    getPcmSampleNumbers: vi.fn((): (number | null)[] => []),
    getPcmPans: vi.fn((): (number | null)[] => []),
    getHardwareTrackMidiNote: vi.fn(() => null),
    getTimerB: vi.fn(() => 200),
    load: vi.fn(async () => ({ duration: hardware.duration, format: "MDR / OPM + PDX" })),
    loadMdx: vi.fn(async () => ({ duration: hardware.duration, format: "MDX / OPM + PDX" })),
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
  midiFixture.sampleRate = 0;
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

describe("hardware-only seek transport", () => {
  it("resets MDX mutes on a new playback without requiring the UI to clear them", async () => {
    const h = createHarness();
    await h.engine.playMdx(new ArrayBuffer(0), undefined, 1, vi.fn(), vi.fn());
    h.engine.setMdrMutedTracks([0, 8]);
    expect(h.player.setChannelMask).toHaveBeenLastCalledWith(257);
    await h.engine.playMdx(new ArrayBuffer(0), undefined, 1, vi.fn(), vi.fn());
    expect(h.player.setChannelMask).toHaveBeenLastCalledWith(0);
    expect([...h.internal.mutedMdrTracks]).toEqual([]);
    h.engine.stop();
  });

  it.each(["mdx", "mdr"])("reuses the measured two-pass duration for %s playback and seeking", async format => {
    const h = createHarness();
    h.hardware.duration = 10;
    h.player.measureDuration.mockImplementation(loops => 10 + (loops - 1) * 7);
    const info = format === "mdx"
      ? await h.engine.playMdx(new ArrayBuffer(0), undefined, 2, vi.fn(), vi.fn())
      : await h.engine.playMdr(makeMdr(), undefined, 2, vi.fn(), vi.fn());
    expect(info.duration).toBe(10);
    expect(h.player.measureDuration.mock.calls).toEqual([[2]]);
    h.player.measureDuration.mockClear();
    await h.engine.seekTo(5);
    expect(h.player.measureDuration.mock.calls).toEqual([[2]]);
    h.engine.stop();
  });

  it("rebuilds MDX at the requested position and ends after the remaining duration", async () => {
    const h = createHarness();
    h.hardware.duration = 10;
    const progress = vi.fn();
    const ended = vi.fn();
    await h.engine.playMdx(new ArrayBuffer(0), undefined, 1, progress, ended);
    h.process(0);
    h.advance(1000);
    expect(h.engine.canSeek()).toBe(true);
    h.player.renderInto.mockClear();
    await h.engine.seekTo(8);
    const skipped = h.player.renderInto.mock.calls.reduce((sum, args) => sum + (args[0] as Float32Array).length, 0);
    expect(skipped).toBe(8 * 48_000);
    expect(progress).toHaveBeenLastCalledWith(8);
    h.process(h.context.currentTime);
    h.advance(1900);
    expect(ended).not.toHaveBeenCalled();
    h.advance(400);
    expect(ended).toHaveBeenCalledOnce();
    expect(h.engine.canSeek()).toBe(false);
    h.advance(15_000);
    expect(ended).toHaveBeenCalledOnce();
  });

  it("preserves mute state and resets the display when seeking backwards to zero", async () => {
    const h = createHarness();
    h.hardware.duration = 10;
    const progress = vi.fn();
    await h.engine.playMdx(new ArrayBuffer(0), undefined, 1, progress, vi.fn());
    h.engine.setMdrMutedTracks([0, 3]);
    await h.engine.seekTo(8);
    expect(h.player.setChannelMask).toHaveBeenLastCalledWith(9);
    await h.engine.seekTo(0);
    expect(progress).toHaveBeenLastCalledWith(0);
    expect(h.player.setChannelMask).toHaveBeenLastCalledWith(9);
    h.engine.stop();
  });

  it("seeks in the current pass without resetting the remaining finite loop count", async () => {
    const h = createHarness();
    h.hardware.duration = 10;
    const ended = vi.fn();
    await h.engine.playMdx(new ArrayBuffer(0), undefined, 3, vi.fn(), ended);
    h.process(0);
    h.advance(21_000);
    h.player.renderInto.mockClear();
    await h.engine.seekTo(8);
    const skipped = h.player.renderInto.mock.calls.reduce((sum, args) => sum + (args[0] as Float32Array).length, 0);
    expect(skipped).toBe(28 * 48_000);
    expect(h.player.start).toHaveBeenLastCalledWith(3);
    h.process(h.context.currentTime);
    h.advance(2400);
    expect(ended).toHaveBeenCalledOnce();
  });

  it("does not reconnect or publish progress when STOP supersedes seek preparation", async () => {
    const h = createHarness();
    h.hardware.duration = 10;
    const progress = vi.fn();
    const ended = vi.fn();
    await h.engine.playMdx(new ArrayBuffer(0), undefined, 1, progress, ended);
    let finishLoad!: (value: { duration: number; format: string }) => void;
    h.player.loadMdx.mockImplementationOnce(() => new Promise(resolve => { finishLoad = resolve; }));
    const pending = h.engine.seekTo(8);
    await Promise.resolve();
    h.engine.stop();
    progress.mockClear();
    h.node.connect.mockClear();
    finishLoad({ duration: 10, format: "MDX / OPM + PDX" });
    await expect(pending).rejects.toThrow("superseded");
    h.advance(15_000);
    expect(progress).not.toHaveBeenCalled();
    expect(ended).not.toHaveBeenCalled();
    expect(h.node.connect).not.toHaveBeenCalled();
    expect(h.engine.canSeek()).toBe(false);
  });

  it("uses the shorter repeat length after an MDX intro and seeks within that pass", async () => {
    const h = createHarness();
    h.hardware.duration = 10;
    h.player.measureDuration.mockImplementation(loops => 10 + (loops - 1) * 7);
    const progress = vi.fn();
    await h.engine.playMdx(new ArrayBuffer(0), undefined, 3, progress, vi.fn());
    h.process(0);
    h.advance(18_000);
    expect(progress.mock.calls.at(-1)?.[1]).toBe(7);
    h.player.renderInto.mockClear();
    const info = await h.engine.seekTo(6);
    const skipped = h.player.renderInto.mock.calls.reduce((sum, args) => sum + (args[0] as Float32Array).length, 0);
    expect(skipped).toBe(23 * 48_000);
    expect(info.duration).toBe(7);
    expect(progress).toHaveBeenLastCalledWith(6, 7);
    h.engine.stop();
  });

  it("waits for the final MDX audio block to reach output after a near-end seek", async () => {
    const h = createHarness();
    h.hardware.duration = 10;
    const ended = vi.fn();
    await h.engine.playMdx(new ArrayBuffer(0), undefined, 1, vi.fn(), ended);
    await h.engine.seekTo(9.9);
    h.hardware.terminateOnRender = true;
    h.process(0.3, 8192);
    h.advance(450);
    expect(ended).not.toHaveBeenCalled();
    h.advance(100);
    expect(ended).toHaveBeenCalledOnce();
  });

  it("supports MDR with hardware tracks and no MIDI events", async () => {
    const h = createHarness();
    h.hardware.duration = 10;
    const progress = vi.fn();
    await h.engine.playMdr(makeMdr(), undefined, 1, progress, vi.fn());
    expect(h.engine.canSeek()).toBe(true);
    h.player.renderInto.mockClear();
    await h.engine.seekTo(5);
    const skipped = h.player.renderInto.mock.calls.reduce((sum, args) => sum + (args[0] as Float32Array).length, 0);
    expect(skipped).toBe(5 * 48_000);
    expect(progress).toHaveBeenLastCalledWith(5);
    expect(h.synth.noteOn).not.toHaveBeenCalled();
    h.engine.stop();
  });

  it("leaves external MIDI playback running when a seek is rejected", async () => {
    const h = createHarness();
    h.hardware.duration = 10;
    h.internal.midiOutput = { send: vi.fn() };
    midiFixture.events = [{ at: 1, sourceTrack: 16, bytes: [0x90, 60, 100] }];
    await h.engine.playMdr(makeMdr(), undefined, 1, vi.fn(), vi.fn());
    expect(h.engine.canSeek()).toBe(false);
    const generation = h.internal.playbackGeneration;
    await expect(h.engine.seekTo(5)).rejects.toThrow("位置移動を利用できません");
    expect(h.internal.playbackGeneration).toBe(generation);
    h.engine.stop();
  });

  it.each([-500, 0, 500])("chases internal MIDI settings and resumes at the delayed boundary (%s ms)", async delayMs => {
    const h = createHarness();
    h.hardware.duration = 10;
    h.engine.setSoundFontMdrDelayMs(delayMs);
    const postMessage = vi.fn((message: any) => {
      if (message.type === "madrv-restore") h.internal.pendingMidiRestore!.resolve();
    });
    h.internal.gsMidiPort = { postMessage };
    midiFixture.events = [
      { at: 0, sourceTrack: 16, bytes: [0xc0, 42] },
      { at: 1, sourceTrack: 16, bytes: [0x90, 60, 100] },
      { at: 2, sourceTrack: 16, bytes: [0xb0, 64, 127] },
      { at: 5 - delayMs / 1000, sourceTrack: 16, bytes: [0x90, 62, 100] },
      { at: 7, sourceTrack: 16, bytes: [0x80, 62, 0] },
    ];
    await h.engine.playMdr(makeMdr(), undefined, 1, vi.fn(), vi.fn());
    expect(h.engine.canSeek()).toBe(true);
    await h.engine.seekTo(5);
    const restores = postMessage.mock.calls.map(([m]) => m).filter(m => m.type === "madrv-restore");
    expect(restores).toHaveLength(2);
    expect(restores[1].messages).toEqual([[0xc0, 42], [0xb0, 64, 127]]);
    h.process(0.1);
    const notes = postMessage.mock.calls.map(([m]) => m).filter(m => m.type === "madrv-midi");
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ bytes: [0x90, 62, 100], targetAt: 0.1 });
    await h.engine.seekTo(0);
    expect(postMessage.mock.calls.map(([m]) => m).filter(m => m.type === "madrv-restore")).toHaveLength(3);
    h.engine.stop();
  });

  it("cancels an unacknowledged MIDI restoration before reconnecting audio", async () => {
    const h = createHarness();
    h.hardware.duration = 10;
    h.internal.gsMidiPort = { postMessage: vi.fn() };
    midiFixture.events = [{ at: 8, sourceTrack: 16, bytes: [0x90, 60, 100] }];
    await h.engine.playMdr(makeMdr(), undefined, 1, vi.fn(), vi.fn());
    h.node.connect.mockClear();
    const pending = h.engine.seekTo(5);
    const rejected = expect(pending).rejects.toThrow("中止");
    for (let i = 0; i < 20 && !h.internal.pendingMidiRestore; i++) await Promise.resolve();
    expect(h.internal.pendingMidiRestore).toBeDefined();
    h.engine.stop();
    await rejected;
    expect(h.node.connect).not.toHaveBeenCalled();
    expect(h.internal.pendingMidiRestore).toBeUndefined();
  });

  it.each([0, 1])("continues ordered MIDI after an A/B timing change following a seek (%s blocks rendered)", async initialBlocks => {
    const h = createHarness();
    h.hardware.duration = 10;
    h.engine.setSoundFontMdrDelayMs(500);
    const postMessage = vi.fn((message: any) => {
      if (message.type === "madrv-restore") h.internal.pendingMidiRestore!.resolve();
    });
    h.internal.gsMidiPort = { postMessage };
    midiFixture.events = [
      { at: 4.6, sourceTrack: 16, bytes: [0xc0, 42] },
      { at: 4.6, sourceTrack: 16, bytes: [0x90, 60, 100] },
      { at: 5.2, sourceTrack: 16, bytes: [0x80, 60, 0] },
      { at: 5.4, sourceTrack: 16, bytes: [0x90, 64, 100] },
      { at: 6, sourceTrack: 16, bytes: [0x80, 64, 0] },
    ];
    await h.engine.playMdr(makeMdr(), undefined, 1, vi.fn(), vi.fn());
    await h.engine.seekTo(5);
    if (initialBlocks) { h.process(0.1); h.advance(43); }
    h.engine.setSoundFontMdrDelayMs(0);
    const sent = () => postMessage.mock.calls.map(([m]) => m).filter(m => m.type === "madrv-midi");
    expect(sent()).toHaveLength(0);
    h.process(0.1 + initialBlocks * 2048 / 48000);
    // Expired settings/notes join the first audible block, in score order.
    // Future note-offs must still wait for their own rendered audio blocks.
    expect(sent().map(m => m.bytes)).toEqual(midiFixture.events.slice(0, 2).map(e => e.bytes));
    expect(sent().map(m => m.targetAt)).toEqual([0.1, 0.1]);
    for (let i = initialBlocks + 1; i < 50; i++) { h.process(0.1 + i * 2048 / 48000); h.advance(43); }
    expect(sent().map(m => m.bytes)).toEqual(midiFixture.events.map(e => e.bytes));
    expect(sent().at(-1).targetAt).toBeCloseTo(1.1);
    expect(h.internal.mdrMidiTimelineComplete).toBe(true);
    h.engine.stop();
  });

  it("blocks bank replacement throughout preparation and preserves the newer preparation after cancellation", async () => {
    const h = createHarness();
    h.hardware.duration = 10;
    const result = { duration: 10, format: "MDR / OPM + PDX" };
    let finishFirst!: (value: typeof result) => void;
    let finishSecond!: (value: typeof result) => void;
    h.player.load.mockImplementationOnce(() => new Promise(resolve => { finishFirst = resolve; }));
    h.player.load.mockImplementationOnce(() => new Promise(resolve => { finishSecond = resolve; }));
    const first = h.engine.playMdr(makeMdr(), undefined, 1, vi.fn(), vi.fn(), 5);
    const cancelled = expect(first).rejects.toThrow();
    while (!finishFirst) await Promise.resolve();
    expect(h.internal.pendingMidiRestore).toBeUndefined();
    await expect(h.engine.loadSoundFontData(new ArrayBuffer(8))).rejects.toThrow("再生を停止してからSoundFontを変更");
    const second = h.engine.playMdr(makeMdr(), undefined, 1, vi.fn(), vi.fn(), 6);
    while (!finishSecond) await Promise.resolve();
    finishFirst(result);
    await cancelled;
    expect(h.internal.mdrPreparationGeneration).toBe(h.internal.playbackGeneration);
    expect(() => h.internal.assertSoundFontCanBeReplaced()).toThrow("再生を停止してからSoundFontを変更");
    finishSecond(result);
    await second;
    expect(h.internal.mdrPreparationGeneration).toBeUndefined();
    h.engine.stop();
    expect(() => h.internal.assertSoundFontCanBeReplaced()).not.toThrow();
  });

  it("releases the bank guard on preparation failure or STOP while preparation is pending", async () => {
    const h = createHarness();
    h.context.resume.mockRejectedValueOnce(new Error("resume failed"));
    await expect(h.engine.playMdr(makeMdr(), undefined, 1, vi.fn(), vi.fn())).rejects.toThrow("resume failed");
    expect(h.internal.mdrPreparationGeneration).toBeUndefined();
    expect(() => h.internal.assertSoundFontCanBeReplaced()).not.toThrow();
    let resume!: () => void;
    h.context.resume.mockImplementationOnce(() => new Promise(resolve => { resume = resolve; }));
    const pending = h.engine.playMdr(makeMdr(), undefined, 1, vi.fn(), vi.fn());
    const cancelled = expect(pending).rejects.toThrow();
    expect(h.internal.mdrPreparationGeneration).toBe(h.internal.playbackGeneration);
    h.engine.stop();
    expect(h.internal.mdrPreparationGeneration).toBeUndefined();
    expect(() => h.internal.assertSoundFontCanBeReplaced()).not.toThrow();
    resume();
    await cancelled;
  });

  it("fails safely when the worklet never acknowledges and does not restart audio", async () => {
    const h = createHarness();
    h.hardware.duration = 10;
    h.internal.gsMidiPort = { postMessage: vi.fn() };
    midiFixture.events = [{ at: 8, sourceTrack: 16, bytes: [0x90, 60, 100] }];
    await h.engine.playMdr(makeMdr(), undefined, 1, vi.fn(), vi.fn());
    h.node.connect.mockClear();
    const pending = h.engine.seekTo(5);
    const rejected = expect(pending).rejects.toThrow("タイムアウト");
    await vi.advanceTimersByTimeAsync(5001);
    await rejected;
    expect(h.node.connect).not.toHaveBeenCalled();
    expect(h.engine.canSeek()).toBe(false);
    h.engine.stop();
  });

  it.each([false, true])("resumes late MIDI after hardware termination or a previous hardware song (GS only: %s)", async gsOnly => {
    const h = createHarness();
    h.hardware.duration = 1;
    h.hardware.milliseconds = 1000;
    h.hardware.terminated = true;
    h.internal.gsMidiPort = { postMessage: vi.fn((message: any) => {
      if (message.type === "madrv-restore") h.internal.pendingMidiRestore!.resolve();
    }) };
    midiFixture.events = [{ at: 5.5, sourceTrack: 16, bytes: [0x90, 60, 100] }];
    const progress = vi.fn();
    const ended = vi.fn();
    await h.engine.playMdr(makeMdr(gsOnly ? 16 : 0), undefined, 1, progress, ended);
    await h.engine.seekTo(5);
    if (!gsOnly) h.process(0.1);
    h.advance(800);
    expect(progress.mock.calls.at(-1)![0]).toBeGreaterThan(5.5);
    const sent = (h.internal.gsMidiPort.postMessage as ReturnType<typeof vi.fn>).mock.calls.map(([m]) => m).filter(m => m.type === "madrv-midi");
    expect(sent.at(-1)?.bytes).toEqual([0x90, 60, 100]);
    expect(ended).not.toHaveBeenCalled();
    h.advance(2000);
    expect(ended).toHaveBeenCalledOnce();
  });

  it("disables seeking if the active MIDI output is changed to an external device", async () => {
    const h = createHarness();
    h.hardware.duration = 10;
    h.internal.gsMidiPort = { postMessage: vi.fn() };
    midiFixture.events = [{ at: 8, sourceTrack: 16, bytes: [0x90, 60, 100] }];
    await h.engine.playMdr(makeMdr(), undefined, 1, vi.fn(), vi.fn());
    expect(h.engine.canSeek()).toBe(true);
    h.internal.midiOutput = { send: vi.fn() };
    expect(h.engine.canSeek()).toBe(false);
    const generation = h.internal.playbackGeneration;
    await expect(h.engine.seekTo(0)).rejects.toThrow("位置移動を利用できません");
    expect(h.internal.playbackGeneration).toBe(generation);
    h.engine.stop();
  });

  it("silences callbacks left over from the old MDX position", async () => {
    const h = createHarness();
    h.hardware.duration = 10;
    await h.engine.playMdx(new ArrayBuffer(0), undefined, 1, vi.fn(), vi.fn());
    const stale = h.node.onaudioprocess!;
    await h.engine.seekTo(5);
    h.player.renderInto.mockClear();
    const samples = new Float32Array(128).fill(1);
    stale({ playbackTime: 0, outputBuffer: { getChannelData: () => samples } });
    expect(h.player.renderInto).not.toHaveBeenCalled();
    expect(samples.every(sample => sample === 0)).toBe(true);
    h.engine.stop();
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
  it.each([1, 2, 4, 0])("reports one-pass progress independently of loop count %s without changing playback limits", async loops => {
    const h = createHarness();
    h.hardware.duration = 4;
    midiFixture.loopWindow = { startSeconds: 4, endSeconds: 8 };
    midiFixture.events = [{ at: 8, sourceTrack: 16, bytes: [0x80, 60, 0] }];
    const onProgress = vi.fn();
    const onEnd = vi.fn();
    const info = await h.engine.playMdr(makeMdr(), undefined, loops, onProgress, onEnd);
    expect(info.duration).toBe(4);
    expect(h.player.start).toHaveBeenCalledWith(loops);
    h.process(0);
    for (const [at, expected] of [[3900, 3.9], [4100, 0.1], [7900, 3.9], [8100, 0.1], [12100, 0.1]]) {
      h.hardware.milliseconds = at;
      h.advance(220);
      const [elapsed, duration] = onProgress.mock.calls.at(-1)!;
      expect(elapsed).toBeCloseTo((loops === 1 || loops === 2) && at >= 8000 ? 4 : expected);
      expect(duration).toBe(4);
    }
    expect(onEnd).not.toHaveBeenCalled();
    h.engine.stop();
  });

  it("maps routed MDR hardware mutes to MXDRV channels", () => {
    const h = createHarness();
    h.internal.mdrHardwareTrackIndexes = [16];
    h.internal.mdrHardwareTrackRawIndexes = new Map([[16, 0]]);

    h.engine.setMdrMutedTracks([16]);

    expect(h.player.setChannelMask).toHaveBeenCalledWith(1);
  });

  it("reports OPM notes under their MDR track after routed channel remapping", () => {
    const h = createHarness();
    h.internal.mdrHardwareTrackIndexes = [16];
    h.internal.mdrHardwareTrackRawIndexes = new Map([[16, 0]]);
    const keys = vi.fn();
    h.engine.setMdrTrackKeyListener(keys);
    keys.mockClear();

    h.internal.reportHardwareTrackKeysFromRaw([57 * 64]);
    h.advance(34);
    expect(keys).toHaveBeenLastCalledWith({ 16: [60] });
    h.internal.reportHardwareTrackKeysFromRaw([-1]);
    h.advance(34);
    expect(keys).toHaveBeenLastCalledWith({});
  });

  it("preserves short PCM gaps and captured sample numbers inside mobile audio blocks", () => {
    const h = createHarness();
    const activity = vi.fn();
    const samples = vi.fn();
    const pans = vi.fn();
    h.engine.setPcmActivityListener(activity);
    h.engine.setPcmSampleListener(samples);
    h.engine.setPcmPanListener(pans);
    activity.mockClear(); samples.mockClear(); pans.mockClear();
    let slice = -1;
    const masks = [1, 0, 1, 0, 1, 0, 1, 0];
    h.player.renderInto = vi.fn(() => { slice++; return 0; });
    h.player.getPcmActiveMask = vi.fn(() => masks[slice]);
    h.player.getPcmSampleNumbers = vi.fn(() => [masks[slice] ? slice / 2 : null]);
    h.player.getPcmPans = vi.fn(() => [masks[slice] ? (slice / 2) % 3 + 1 : null]);
    h.forceAudioTime(undefined);
    h.internal.renderMdrOutputBlock(new Float32Array(16384), new Float32Array(16384), 0);
    expect(h.player.renderInto).toHaveBeenCalledTimes(8);
    expect(activity).not.toHaveBeenCalled();
    h.advance(350);
    expect(activity.mock.calls.map(([mask]) => mask)).toEqual(masks);
    expect(samples.mock.calls.map(([snapshot]) => snapshot[0])).toEqual([0, null, 1, null, 2, null, 3, null]);
    expect(pans.mock.calls.map(([snapshot]) => snapshot[0])).toEqual([1, null, 2, null, 3, null, 1, null]);
    // A mute followed by unmute must not revive already buffered PCM hits.
    slice = -1;
    h.internal.renderMdrOutputBlock(new Float32Array(2048), new Float32Array(2048), 1);
    h.engine.setMdrMutedTracks([8]);
    h.engine.setMdrMutedTracks([]);
    activity.mockClear(); samples.mockClear(); pans.mockClear();
    h.advance(1000);
    expect(activity).not.toHaveBeenCalled();
    expect(samples).not.toHaveBeenCalled();
    expect(pans).not.toHaveBeenCalled();
  });

  it("publishes OPM key transitions inside a large output block", () => {
    const h = createHarness();
    h.internal.mdrHardwareTrackIndexes = [0];
    let renderCalls = 0;
    let note: number | null = 60;
    h.player.getHardwareTrackMidiNote = vi.fn(() => note);
    h.player.renderInto = vi.fn((left: Float32Array, right: Float32Array) => {
      renderCalls += 1;
      left.fill(0);
      right.fill(0);
      note = renderCalls === 1 ? 60 : null;
      return 0;
    });
    const keys = vi.fn();
    h.engine.setMdrTrackKeyListener(keys);
    keys.mockClear();
    h.forceAudioTime(0);

    h.internal.renderMdrOutputBlock(new Float32Array(4096), new Float32Array(4096), 0);

    expect(renderCalls).toBe(2);
    expect(h.internal.mdrHardwareVisualQueue.pendingCount).toBe(2);
    h.forceAudioTime(0.05);
    h.advance(43);
    expect(keys).toHaveBeenLastCalledWith({ 0: [60] });
    h.forceAudioTime(0.1);
    h.advance(43);
    expect(keys).toHaveBeenLastCalledWith({});
  });

  it("keeps the loaded SoundFont and pending notes intact when replacement is requested during playback", async () => {
    const h = createHarness();
    h.internal.gsMidiPort = { postMessage: vi.fn() };
    midiFixture.events = [{ at: 0.1, sourceTrack: 16, bytes: [0x90, 60, 100] }];
    await h.engine.playMdr(makeMdr(), undefined, 1, vi.fn(), vi.fn());
    h.process(0.5, 16_384);
    const generation = h.internal.playbackGeneration;
    await expect(h.engine.loadSoundFontData(new ArrayBuffer(0))).rejects.toThrow("再生を停止してからSoundFontを変更");
    expect(h.internal.playbackGeneration).toBe(generation);
    expect(h.internal.gsSynth).toBe(h.synth);
    expect(h.node.disconnect).not.toHaveBeenCalled();
  });

  it("uses exact Timer-B extraction without changing the actual output sample rate", async () => {
    const h = createHarness(44_100);
    await h.engine.playMdr(makeMdr(), undefined, 1, vi.fn(), vi.fn());
    expect(midiFixture.sampleRate).toBe(125_000);
    expect(h.context.sampleRate).toBe(44_100);
  });

  it("preschedules only rendered MIDI against output blocks and keeps keys on their audible timeline", async () => {
    const h = createHarness();
    h.engine.setPerformanceProfile("mobile");
    const postMessage = vi.fn();
    h.internal.gsMidiPort = { postMessage };
    midiFixture.events = [
      { at: 0, sourceTrack: 16, bytes: [0x90, 60, 100] },
      { at: 0.2, sourceTrack: 16, bytes: [0x80, 60, 0] },
      { at: 0.4, sourceTrack: 16, bytes: [0x90, 64, 100] },
    ];
    const keys = vi.fn();
    h.engine.setMdrTrackKeyListener(keys);
    await h.engine.playMdr(makeMdr(), undefined, 1, vi.fn(), vi.fn());
    keys.mockClear();
    const messages = () => postMessage.mock.calls.map(([message]) => message).filter(message => message.type === "madrv-midi");
    h.process(0.5, 16_384);
    expect(messages()).toMatchObject([{ targetAt: 0.5 }, { targetAt: 0.7 }]);
    h.advance(100);
    expect(messages()).toHaveLength(2);
    expect(keys).not.toHaveBeenCalled();
    h.process(0.5 + 16_384 / 48_000, 16_384);
    expect(messages()).toHaveLength(3);
    expect(messages()[2].targetAt).toBeCloseTo(0.9);
    h.advance(450);
    expect(keys).toHaveBeenLastCalledWith({ 16: [60] });
    h.engine.stop();
    expect(postMessage).toHaveBeenCalledWith({ type: "madrv-reset", generation: h.internal.playbackGeneration });
    keys.mockClear();
    h.advance(2000);
    expect(keys).not.toHaveBeenCalled();
  });

  it("does not let the timer advance MIDI past an unrendered OPM interval", async () => {
    const h = createHarness();
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    h.engine.setPerformanceProfile("mobile");
    const postMessage = vi.fn();
    h.internal.gsMidiPort = { postMessage };
    midiFixture.events = [{ at: 0.7, sourceTrack: 16, bytes: [0x90, 60, 100] }];
    await h.engine.playMdr(makeMdr(), undefined, 1, vi.fn(), vi.fn());
    h.process(0.5, 16_384);
    h.advance(1000);
    const messages = () => postMessage.mock.calls.map(([message]) => message).filter(message => message.type === "madrv-midi");
    expect(messages()).toEqual([]);
    h.process(1.8, 16_384);
    expect(messages()).toEqual([]);
    h.process(2.2, 16_384);
    expect(messages()).toHaveLength(1);
    expect(messages()[0].targetAt).toBeCloseTo(2.2 + 0.7 - 32_768 / 48_000);
    expect(warning).toHaveBeenCalledOnce();
  });

  it("does not revive cancelled keyboard notes after a quick mute and unmute", async () => {
    const h = createHarness();
    h.engine.setPerformanceProfile("mobile");
    h.internal.gsMidiPort = { postMessage: vi.fn() };
    midiFixture.events = [
      { at: 0.1, sourceTrack: 16, bytes: [0x90, 60, 100] },
      { at: 0.1, sourceTrack: 17, bytes: [0x91, 64, 100] },
    ];
    const keys = vi.fn();
    h.engine.setMdrTrackKeyListener(keys);
    await h.engine.playMdr(makeMdr(), undefined, 1, vi.fn(), vi.fn());
    h.process(0.5, 16_384);
    h.advance(100);
    h.engine.setMdrMutedTracks([16]);
    h.advance(100);
    h.engine.setMdrMutedTracks([]);
    keys.mockClear();
    h.advance(500);
    expect(keys).toHaveBeenLastCalledWith({ 17: [64] });
    expect(keys.mock.calls.every(([state]) => state[16] === undefined)).toBe(true);
  });

  it("preserves score order across overlapping block reports without shifting all later deadlines", async () => {
    const h = createHarness();
    h.engine.setPerformanceProfile("mobile");
    const postMessage = vi.fn();
    h.internal.gsMidiPort = { postMessage };
    midiFixture.events = [
      { at: 0.3, sourceTrack: 16, bytes: [0xe0, 1, 64] },
      { at: 0.35, sourceTrack: 16, bytes: [0xe0, 0, 64] },
      { at: 0.5, sourceTrack: 16, bytes: [0x90, 60, 100] },
    ];
    await h.engine.playMdr(makeMdr(), undefined, 1, vi.fn(), vi.fn());
    h.process(1, 16_384);
    h.process(1.25, 16_384);
    const messages = postMessage.mock.calls.map(([message]) => message).filter(message => message.type === "madrv-midi");
    expect(messages.map(message => message.bytes)).toEqual(midiFixture.events.map(event => event.bytes));
    expect(messages[0].targetAt).toBeCloseTo(1.3);
    expect(messages[1].targetAt).toBeCloseTo(1.3);
    expect(messages[2].targetAt).toBeCloseTo(1.25 + 0.5 - 16_384 / 48_000);
  });

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
    h.engine.setPerformanceProfile("mobile");
    h.hardware.duration = 1;
    midiFixture.events = [{ at: 0.3, sourceTrack: 16, bytes: [0x80, 60, 0] }];
    midiFixture.loopWindow = { startSeconds: 0, endSeconds: 1 };
    const onEnd = vi.fn();
    await h.engine.playMdr(makeMdr(), undefined, 1, vi.fn(), onEnd);
    h.process(0, 16_384);
    h.advance(100);
    expect(h.internal.mdrSoundFontQueue.pendingCount).toBe(1);
    // Simulate a late queue dispatch at audio t=3 rather than its original 0.3.
    h.forceAudioTime(3);
    h.advance(2450);
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
