import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { MadrvSoundfontScheduler, type MadrvSoundfontMidi, type MadrvSoundfontTiming } from "../../worklets/madrvSoundfontScheduler";

function harness() {
  const applied: MadrvSoundfontMidi[] = [];
  const reports: MadrvSoundfontTiming[] = [];
  const released: MadrvSoundfontMidi[] = [];
  const stopAll = vi.fn();
  const scheduler = new MadrvSoundfontScheduler({
    sampleRate: 48_000,
    apply: event => applied.push(event),
    release: event => released.push(event),
    report: timing => reports.push(timing),
    stopAll,
  });
  scheduler.handle({ type: "madrv-reset", generation: 1 }, 0);
  const send = (targetAt: number, bytes = [0x90, 60, 100], sourceTrack = 16, generation = 1, receivedAt = 0) => {
    scheduler.handle({ type: "madrv-midi", generation, sourceTrack, bytes, targetAt }, receivedAt);
  };
  return { scheduler, applied, released, reports, stopAll, send };
}

describe("cancellable SoundFont audio-thread scheduler", () => {
  it("holds a long advance until the output deadline, within one quantum", () => {
    const { scheduler, send, applied } = harness();
    send(0.35);
    scheduler.process(0);
    scheduler.process(0.349);
    expect(applied).toHaveLength(0);
    scheduler.process(0.352);
    expect(applied).toHaveLength(1);
    expect(scheduler.snapshot()).toMatchObject({ appliedCount: 1, lateCount: 0, pendingCount: 0 });
    expect(scheduler.snapshot().maxLateSeconds).toBeCloseTo(0.002);
  });

  it("preserves equal-deadline controller order without shifting later deadlines", () => {
    const { scheduler, send, applied } = harness();
    send(0.5, [0xe0, 1, 64]);
    send(0.2, [0x90, 60, 100]);
    send(0.5, [0xe0, 0, 64]);
    scheduler.process(0.2);
    expect(applied.map(event => event.targetAt)).toEqual([0.2]);
    scheduler.process(0.5);
    expect(applied.map(event => [...event.bytes])).toEqual([[0x90, 60, 100], [0xe0, 1, 64], [0xe0, 0, 64]]);
  });

  it("cancels a prior song and rejects its late in-flight messages", () => {
    const { scheduler, send, applied, stopAll } = harness();
    send(0.4);
    scheduler.handle({ type: "madrv-reset", generation: 2 }, 0.1);
    send(0.3, [0x90, 61, 100], 16, 1, 0.15);
    send(0.3, [0x90, 62, 100], 16, 2, 0.15);
    scheduler.process(0.6);
    expect(applied.map(event => event.bytes[1])).toEqual([62]);
    expect(stopAll).toHaveBeenCalledTimes(2);
    expect(scheduler.snapshot()).toMatchObject({ generation: 2, appliedCount: 1, pendingCount: 0 });
  });

  it("ignores an older reset rather than cancelling the new song", () => {
    const { scheduler, send, applied } = harness();
    scheduler.handle({ type: "madrv-reset", generation: 2 }, 0);
    send(0.2, [0x90, 62, 100], 16, 2);
    scheduler.handle({ type: "madrv-reset", generation: 1 }, 0.1);
    scheduler.process(0.2);
    expect(applied).toHaveLength(1);
    expect(scheduler.snapshot().generation).toBe(2);
  });

  it("removes muted queued notes and never replays them on unmute", () => {
    const { scheduler, send, applied, stopAll } = harness();
    send(0.3);
    send(0.3, [0x80, 60, 0]);
    send(0.3, [0xc0, 40]);
    send(0.3, [0x91, 61, 100], 17);
    scheduler.handle({ type: "madrv-mute", generation: 1, tracks: [16] }, 0.1);
    send(0.3, [0x90, 62, 100]);
    scheduler.handle({ type: "madrv-mute", generation: 1, tracks: [] }, 0.2);
    scheduler.process(0.3);
    expect(applied.map(event => [...event.bytes])).toEqual([[0xc0, 40], [0x91, 61, 100]]);
    expect(stopAll).toHaveBeenCalledTimes(1);
  });

  it("releases only newly muted owned notes, leaving other sustained tracks alone", () => {
    const { scheduler, send, released, stopAll } = harness();
    send(0.1, [0x90, 60, 100], 16);
    send(0.1, [0x91, 62, 100], 17);
    scheduler.process(0.1);
    scheduler.handle({ type: "madrv-mute", generation: 1, tracks: [16] }, 0.15);
    expect(released.map(event => [...event.bytes])).toEqual([[0x80, 60, 0]]);
    expect(stopAll).toHaveBeenCalledTimes(1);
    scheduler.handle({ type: "madrv-mute", generation: 1, tracks: [0, 16] }, 0.16);
    expect(released).toHaveLength(1);
    expect(stopAll).toHaveBeenCalledTimes(1);
  });

  it("does not release a shared channel/key still owned by an unmuted track", () => {
    const { scheduler, send, released } = harness();
    send(0.1, [0x90, 60, 100], 16);
    send(0.1, [0x90, 60, 100], 17);
    scheduler.process(0.1);
    scheduler.handle({ type: "madrv-mute", generation: 1, tracks: [16] }, 0.15);
    expect(released).toHaveLength(0);
    scheduler.handle({ type: "madrv-mute", generation: 1, tracks: [16, 17] }, 0.16);
    expect(released.map(event => [...event.bytes])).toEqual([[0x80, 60, 0]]);
  });

  it("keeps controller and release messages while a track is muted", () => {
    const { scheduler, send, applied } = harness();
    scheduler.handle({ type: "madrv-mute", generation: 1, tracks: [16] }, 0);
    send(0.2, [0xe0, 0, 64]);
    send(0.2, [0x80, 60, 0]);
    send(0.2, [0x90, 61, 0]);
    send(0.2, [0x90, 62, 100]);
    scheduler.process(0.2);
    expect(applied.map(event => [...event.bytes])).toEqual([[0xe0, 0, 64], [0x80, 60, 0], [0x90, 61, 0]]);
  });

  it("records received and applied lateness without accumulating it in future targets", () => {
    const { scheduler, send, applied } = harness();
    send(0.1, [0x90, 60, 100], 16, 1, 0.14);
    send(0.2, [0x80, 60, 0], 16, 1, 0.14);
    scheduler.process(0.15);
    scheduler.process(0.2);
    expect(applied.map(event => event.targetAt)).toEqual([0.1, 0.2]);
    expect(scheduler.snapshot()).toMatchObject({ appliedCount: 2, lateCount: 1, receivedLateCount: 1, lastTargetAt: 0.2, lastAppliedAt: 0.2 });
    expect(scheduler.snapshot().maxLateSeconds).toBeCloseTo(0.05);
    expect(scheduler.snapshot().maxReceiptLateSeconds).toBeCloseTo(0.04);
  });

  it("batches timing reports at no more than four per second, including resets", () => {
    const { scheduler, send, reports } = harness();
    for (let index = 0; index < 100; index += 1) {
      const at = index / 100;
      scheduler.handle({ type: "madrv-reset", generation: index + 1 }, at);
      send(at, [0x90, 60, 100], 16, index + 1, at);
      scheduler.process(at);
    }
    expect(reports).toHaveLength(4);
    expect(reports.every(report => report.appliedCount === 1)).toBe(true);
  });

  it("copies event bytes and rejects malformed custom messages", () => {
    const { scheduler, applied } = harness();
    const bytes = [0x90, 60, 100];
    const message = { type: "madrv-midi", generation: 1, sourceTrack: 16, bytes, targetAt: 0.2 };
    scheduler.handle(message, 0);
    bytes[1] = 77;
    for (const malformed of [{ ...message, targetAt: NaN }, { ...message, bytes: [256] }, { ...message, sourceTrack: 32 }, { ...message, generation: -1 }]) {
      expect(scheduler.handle(malformed, 0)).toBe(true);
    }
    expect(scheduler.handle({ type: "midiMessage" }, 0)).toBe(false);
    scheduler.process(0.2);
    expect(applied).toHaveLength(1);
    expect(applied[0].bytes[1]).toBe(60);
  });

  it("runs the generated adapter with upstream readiness and normal control messages", async () => {
    const messages: any[] = [];
    let Processor: any;
    let resolveReady!: () => void;
    const ready = new Promise<void>(resolve => { resolveReady = resolve; });
    class AudioWorkletProcessorStub {
      port = {
        onmessage: null as null | ((event: { data: unknown }) => void),
        postMessage(message: any) {
          messages.push(message);
          if (message.type === "isFullyInitialized" && message.data.type === "sf3Decoder") resolveReady();
        },
      };
    }
    const context = vm.createContext({
      AudioWorkletProcessor: AudioWorkletProcessorStub,
      sampleRate: 48_000, currentTime: 0, atob, WebAssembly,
      console: { info() {}, warn() {}, error() {}, group() {}, groupCollapsed() {}, groupEnd() {}, log() {} },
      registerProcessor(name: string, value: unknown) {
        expect(name).toBe("madrv-spessasynth-worklet");
        Processor = value;
      },
    });
    const bundle = readFileSync(new URL("../../public/manus-storage/madrv-spessasynth-processor.js", import.meta.url), "utf8");
    vm.runInContext(bundle, context);
    const processor = new Processor({ processorOptions: { oneOutput: false, eventsEnabled: false } });
    await ready;
    const send = (data: unknown) => processor.port.onmessage({ data });
    send({ type: "madrv-reset", generation: 1 });
    send({ type: "madrv-midi", generation: 1, sourceTrack: 16, bytes: [0xe0, 1, 64], targetAt: 0.25 });
    send({ type: "madrv-reset", generation: 2 });
    send({ type: "madrv-midi", generation: 2, sourceTrack: 16, bytes: [0xe0, 0, 64], targetAt: 0.3 });
    // Normal Spessa API must still work beside the custom MDR protocol.
    send({ type: "setChannelSystemParameter", channelNumber: 0, data: { parameter: "gain", value: 0.8 } });
    const outputs = Array.from({ length: 17 }, () => [new Float32Array(128), new Float32Array(128)]);
    for (let block = 0; block < 190; block += 1) {
      context.currentTime = block * 128 / 48_000;
      expect(processor.process([], outputs)).toBe(true);
    }
    const last = messages.filter(message => message.type === "madrv-midi-timing").at(-1);
    expect(last).toMatchObject({ generation: 2, appliedCount: 1, lateCount: 0, pendingCount: 0, lastTargetAt: 0.3 });
    expect(last.lastAppliedAt - 0.3).toBeLessThanOrEqual(128 / 48_000);
  });
});
