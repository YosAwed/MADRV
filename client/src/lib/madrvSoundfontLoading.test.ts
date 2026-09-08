import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SignalDeckAudio, type ScheduledMdrMidiEvent } from "./madrvEngine";

const synthFactory = vi.hoisted(() => ({
  plans: [] as Array<{ ready: Promise<void>; bank: Promise<void>; bankStarted(): void }>,
  created: [] as any[],
}));

vi.mock("spessasynth_lib", () => ({
  WorkletSynthesizer: class {
    readonly isReady: Promise<void>;
    readonly soundBankManager: { addSoundBank: ReturnType<typeof vi.fn> };
    readonly node: any;
    connect = vi.fn((destination: unknown) => destination);
    destroy = vi.fn();

    constructor(context: unknown, config: any) {
      const plan = synthFactory.plans.shift();
      if (!plan) throw new Error("No SoundFont preparation plan configured");
      this.node = config.audioNodeCreators.worklet(context, "spessasynth-worklet-processor", {
        numberOfOutputs: 17,
        outputChannelCount: Array.from({ length: 17 }, () => 2),
        processorOptions: { oneOutput: false, eventsEnabled: true },
      });
      this.isReady = plan.ready;
      this.soundBankManager = {
        addSoundBank: vi.fn(() => {
          plan.bankStarted();
          return plan.bank;
        }),
      };
      synthFactory.created.push(this);
    }
  },
}));

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

function nextSynth() {
  const ready = deferred();
  const bank = deferred();
  const started = deferred();
  synthFactory.plans.push({ ready: ready.promise, bank: bank.promise, bankStarted: started.resolve });
  return { ready, bank, started };
}

type EngineInternals = {
  context: unknown;
  masterGain: unknown;
  gains: unknown;
  gsLoaded: boolean;
  gsSynth: unknown;
  gsMidiPort: unknown;
  playbackGeneration: number;
  mutedMdrTracks: Set<number>;
  startMdrMidiTimeline(events: readonly ScheduledMdrMidiEvent[], startsAt: number): void;
};

function harness() {
  const context = {
    currentTime: 0,
    sampleRate: 48_000,
    audioWorklet: { addModule: vi.fn(async () => {}) },
  };
  const gain = () => ({
    gain: { value: 0.72, cancelScheduledValues: vi.fn(), setValueAtTime: vi.fn(), setTargetAtTime: vi.fn() },
    connect: vi.fn(),
  });
  const oldSynth = { destroy: vi.fn(), stopAll: vi.fn() };
  const oldPort = { postMessage: vi.fn() };
  const engine = new SignalDeckAudio();
  const internals = engine as unknown as EngineInternals;
  Object.assign(internals, {
    context, masterGain: gain(), gains: { opm: gain(), pcm: gain(), midi: gain() },
    gsLoaded: true, gsSynth: oldSynth, gsMidiPort: oldPort,
  });
  return { engine, internals, oldSynth, oldPort, context };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("window", globalThis);
  vi.stubGlobal("AudioWorkletNode", class {
    port = { postMessage: vi.fn(), addEventListener: vi.fn() };
    constructor(_context: unknown, name: string) {
      expect(name).toBe("madrv-spessasynth-worklet");
    }
  });
  synthFactory.plans.length = 0;
  synthFactory.created.length = 0;
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("SoundFont replacement transaction", () => {
  it("rejects replacement when playback starts during async preparation, preserving the old synth and its reservations", async () => {
    const h = harness();
    const plan = nextSynth();
    const data = new ArrayBuffer(8);
    const loading = h.engine.loadSoundFontData(data);
    plan.ready.resolve();
    await plan.started.promise;
    const preparedSynth = synthFactory.created[0];
    expect(h.oldSynth.destroy).not.toHaveBeenCalled();

    // Exercise the engine's actual MIDI transport while bank initialization is
    // still pending: the old Worklet now owns a future note and more score data.
    h.internals.startMdrMidiTimeline([
      { at: 0.1, sourceTrack: 16, bytes: [0x90, 60, 100] },
      { at: 3, sourceTrack: 16, bytes: [0x80, 60, 0] },
    ], 0);
    expect(h.oldPort.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "madrv-midi", targetAt: 0.1 }));

    const rejection = expect(loading).rejects.toThrow("再生を停止してからSoundFontを変更");
    plan.bank.resolve();
    await rejection;
    expect(h.internals.gsSynth).toBe(h.oldSynth);
    expect(h.internals.gsMidiPort).toBe(h.oldPort);
    expect(h.internals.gsLoaded).toBe(true);
    expect(h.oldSynth.destroy).not.toHaveBeenCalled();
    expect(h.oldSynth.stopAll).not.toHaveBeenCalled();
    expect(preparedSynth.destroy).toHaveBeenCalledOnce();
    expect(preparedSynth.node.port.postMessage).not.toHaveBeenCalled();
    expect(h.oldPort.postMessage.mock.calls.every(([message]) => message.type !== "madrv-reset")).toBe(true);
  });

  it("replaces a bank while stopped only after preparation succeeds and initializes the new queue", async () => {
    const h = harness();
    h.internals.playbackGeneration = 7;
    h.internals.mutedMdrTracks = new Set([17]);
    const plan = nextSynth();
    const data = new ArrayBuffer(8);
    const loading = h.engine.loadSoundFontData(data);
    plan.ready.resolve();
    await plan.started.promise;
    const preparedSynth = synthFactory.created[0];
    expect(h.internals.gsSynth).toBe(h.oldSynth);
    expect(h.oldSynth.destroy).not.toHaveBeenCalled();
    expect(preparedSynth.soundBankManager.addSoundBank).toHaveBeenCalledWith(data, "user-gs");

    plan.bank.resolve();
    await loading;
    expect(h.oldSynth.destroy).toHaveBeenCalledOnce();
    expect(preparedSynth.destroy).not.toHaveBeenCalled();
    expect(h.internals.gsSynth).toBe(preparedSynth);
    expect(h.internals.gsMidiPort).toBe(preparedSynth.node.port);
    expect(h.internals.gsLoaded).toBe(true);
    expect(preparedSynth.node.port.postMessage.mock.calls.map(([message]: [unknown]) => message)).toEqual([
      { type: "madrv-reset", generation: 7 },
      { type: "madrv-mute", generation: 7, tracks: [17] },
    ]);
  });

  it("refuses a bank load before creating a new worklet when MIDI is already active", async () => {
    const h = harness();
    h.internals.startMdrMidiTimeline([{ at: 3, sourceTrack: 16, bytes: [0x90, 60, 100] }], 0);
    await expect(h.engine.loadSoundFontData(new ArrayBuffer(8))).rejects.toThrow("再生を停止してからSoundFontを変更");
    expect(synthFactory.created).toHaveLength(0);
    expect(h.context.audioWorklet.addModule).not.toHaveBeenCalled();
    expect(h.oldSynth.destroy).not.toHaveBeenCalled();
  });
});
