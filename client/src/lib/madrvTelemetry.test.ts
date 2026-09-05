import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SignalDeckAudio,
  type MdrTrackKeyState,
  type PlaybackPerformanceProfile,
} from "./madrvEngine";

// Exercise the real telemetry methods without constructing an AudioContext.
type TelemetryInternals = {
  updateMdrMidiTrackKeys(bytes: number[], sourceTrack: number): void;
  resetMdrTrackKeys(): void;
  reportHardwareTrackKeys(): void;
  reportHardwareTrackKeysFromRaw(rawNotes: unknown): void;
  mdrHardwareTrackIndexes: number[];
  mdrPlayer?: {
    getHardwareTrackMidiNote(track: number): number | null;
    setChannelMask(mask: number): void;
    stop(): void;
  };
};

function makeTelemetry(
  profile: PlaybackPerformanceProfile = "desktop",
  safari = false
) {
  const audio = new SignalDeckAudio();
  const internal = audio as unknown as TelemetryInternals;
  audio.setPerformanceProfile(profile, safari);
  const listener = vi.fn<(state: MdrTrackKeyState) => void>();
  audio.setMdrTrackKeyListener(listener);
  listener.mockClear();
  return { audio, internal, listener };
}

describe("MDR live keyboard telemetry", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    vi.stubGlobal("window", { setTimeout, clearTimeout });
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it.each([
    ["desktop", false, 33],
    ["mobile", false, 250],
    ["mobile", true, 500],
  ] as const)(
    "batches MIDI-only keys for %s / Safari %s at the profile cadence",
    (profile, safari, interval) => {
      const { internal, listener } = makeTelemetry(profile, safari);
      internal.updateMdrMidiTrackKeys([0x90, 60, 100], 16);
      internal.updateMdrMidiTrackKeys([0x90, 64, 100], 17);
      expect(vi.getTimerCount()).toBe(1);
      vi.advanceTimersByTime(interval - 1);
      expect(listener).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith({ 16: [60], 17: [64] });
      expect(vi.getTimerCount()).toBe(0);
    }
  );

  it("does not schedule visual work for bends, controllers, setup or unchanged notes", () => {
    const { internal, listener } = makeTelemetry();
    internal.updateMdrMidiTrackKeys([0x90, 60, 100], 16);
    vi.advanceTimersByTime(33);
    listener.mockClear();
    for (const bytes of [
      [],
      [0xe0, 0, 0],
      [0xe0, 0, 64],
      [0xb0, 7, 100],
      [0xc0, 36],
      [0xd0, 64],
      [0xf0, 0x41, 0x10, 0xf7],
      [0x90, 60, 90],
      [0x80, 61, 0],
      [0x90, 61, 0],
    ]) {
      internal.updateMdrMidiTrackKeys(bytes, 16);
    }
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(1000);
    expect(listener).not.toHaveBeenCalled();
  });

  it("publishes the latest burst state and a trailing note-off without another audio callback", () => {
    const { internal, listener } = makeTelemetry();
    internal.updateMdrMidiTrackKeys([0x90, 60, 100], 16);
    vi.advanceTimersByTime(10);
    internal.updateMdrMidiTrackKeys([0x80, 60, 0], 16);
    vi.advanceTimersByTime(10);
    internal.updateMdrMidiTrackKeys([0x90, 64, 100], 16);
    vi.advanceTimersByTime(13);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({ 16: [64] });
    internal.updateMdrMidiTrackKeys([0x90, 64, 0], 16);
    vi.advanceTimersByTime(33);
    expect(listener.mock.calls.map(([state]) => state)).toEqual([
      { 16: [64] },
      {},
    ]);
  });

  it("retains unchanged track arrays and never mutates already published snapshots", () => {
    const { internal, listener } = makeTelemetry();
    internal.updateMdrMidiTrackKeys([0x90, 60, 100], 16);
    internal.updateMdrMidiTrackKeys([0x91, 48, 100], 17);
    vi.advanceTimersByTime(33);
    const first = listener.mock.calls[0]![0];
    internal.updateMdrMidiTrackKeys([0x90, 64, 100], 16);
    vi.advanceTimersByTime(33);
    const second = listener.mock.calls[1]![0];
    expect(second[17]).toBe(first[17]);
    expect(second[16]).not.toBe(first[16]);
    expect(first).toEqual({ 16: [60], 17: [48] });
    expect(second).toEqual({ 16: [60, 64], 17: [48] });
  });

  it("clears a pending key publication on reset and keeps the new playback state", () => {
    const { internal, listener } = makeTelemetry();
    internal.updateMdrMidiTrackKeys([0x90, 60, 100], 16);
    vi.advanceTimersByTime(10);
    internal.resetMdrTrackKeys();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({});
    expect(vi.getTimerCount()).toBe(0);
    internal.updateMdrMidiTrackKeys([0x90, 65, 100], 16);
    vi.advanceTimersByTime(1000);
    expect(listener.mock.calls.map(([state]) => state)).toEqual([
      {},
      { 16: [65] },
    ]);
  });

  it("publishes silence synchronously on stop and cancels the pending timer", () => {
    const { audio, internal, listener } = makeTelemetry();
    Object.defineProperty(audio, "graph", {
      value: {
        context: { currentTime: 0 },
        gains: {
          midi: {
            gain: {
              value: 1,
              cancelScheduledValues: vi.fn(),
              setValueAtTime: vi.fn(),
              setTargetAtTime: vi.fn(),
            },
          },
        },
      },
    });
    internal.updateMdrMidiTrackKeys([0x90, 60, 100], 16);
    audio.stop();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({});
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(1000);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("cancels pending work when unsubscribed and immediately supplies current keys on resubscribe", () => {
    const { audio, internal, listener } = makeTelemetry();
    internal.updateMdrMidiTrackKeys([0x90, 60, 100], 16);
    audio.setMdrTrackKeyListener(undefined);
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(1000);
    expect(listener).not.toHaveBeenCalled();
    audio.setMdrTrackKeyListener(listener);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({ 16: [60] });
  });

  it("applies mute and unmute immediately without discarding held notes", () => {
    const { audio, internal, listener } = makeTelemetry();
    internal.updateMdrMidiTrackKeys([0x90, 60, 100], 16);
    internal.updateMdrMidiTrackKeys([0x91, 48, 100], 17);
    audio.setMdrMutedTracks([16]);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({ 17: [48] });
    expect(vi.getTimerCount()).toBe(0);
    const unmutedTrack = listener.mock.calls[0]![0][17];
    audio.setMdrMutedTracks([]);
    expect(listener.mock.calls[1]![0]).toEqual({ 16: [60], 17: [48] });
    expect(listener.mock.calls[1]![0][17]).toBe(unmutedTrack);
  });

  it("reads only hardware source tracks and preserves held MIDI keys", () => {
    const { internal, listener } = makeTelemetry();
    internal.mdrHardwareTrackIndexes = [3];
    let hardwareNote: number | null = 60;
    const getHardwareTrackMidiNote = vi.fn(() => hardwareNote);
    internal.mdrPlayer = {
      getHardwareTrackMidiNote,
      setChannelMask: vi.fn(),
      stop: vi.fn(),
    };
    internal.updateMdrMidiTrackKeys([0x90, 34, 100], 16);
    internal.updateMdrMidiTrackKeys([0x99, 36, 100], 17);
    internal.reportHardwareTrackKeys();
    vi.advanceTimersByTime(33);
    const first = listener.mock.calls[0]![0];
    expect(first).toEqual({ 3: [60], 16: [34], 17: [36] });
    expect(getHardwareTrackMidiNote).toHaveBeenCalledTimes(1);
    expect(getHardwareTrackMidiNote).toHaveBeenCalledWith(3);
    hardwareNote = null;
    internal.reportHardwareTrackKeys();
    vi.advanceTimersByTime(33);
    const second = listener.mock.calls[1]![0];
    expect(second).toEqual({ 16: [34], 17: [36] });
    expect(second[16]).toBe(first[16]);
    expect(second[17]).toBe(first[17]);
  });

  it("keeps MIDI keys when a worklet status reports inactive MIDI slots", () => {
    const { internal, listener } = makeTelemetry();
    internal.mdrHardwareTrackIndexes = [3, 20];
    internal.updateMdrMidiTrackKeys([0x90, 34, 100], 16);
    const rawNotes = Array<number>(32).fill(-1);
    rawNotes[3] = (60 - 3) * 64;
    rawNotes[20] = (48 - 3) * 64;
    internal.reportHardwareTrackKeysFromRaw(rawNotes);
    vi.advanceTimersByTime(33);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({
      3: [60],
      16: [34],
      20: [48],
    });
  });
});
