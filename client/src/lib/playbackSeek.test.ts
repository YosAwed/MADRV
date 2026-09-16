import { afterEach, describe, expect, it, vi } from "vitest";
import { advancePlaybackSilently, playbackSeekTarget } from "./playbackSeek";

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe("seek position within a displayed pass", () => {
  it("moves backwards and forwards within the current pass, preserving completed loops", () => {
    expect(playbackSeekTarget(10, 25, 145, 60, 180)).toBe(130);
    expect(playbackSeekTarget(50, 25, 145, 60, 180)).toBe(170);
    expect(playbackSeekTarget(60, 25, 145, 60, 180)).toBe(180);
    expect(playbackSeekTarget(70, 25, 145, 60, 175)).toBe(175);
    expect(playbackSeekTarget(-10, 25, 145, 60)).toBe(120);
  });

  it("supports unequal intro and repeat durations without multiplying a loop number", () => {
    expect(playbackSeekTarget(5, 8, 93, 40)).toBe(90); // 45s intro + 40s cycle
    expect(playbackSeekTarget(40, 8, 93, 40)).toBe(125);
  });

  it("rejects invalid values before the live playback is stopped", () => {
    for (const value of [NaN, Infinity, -Infinity]) expect(() => playbackSeekTarget(value, 0, 0, 60)).toThrow();
    expect(() => playbackSeekTarget(10, 0, 0, 0)).toThrow();
  });
});

describe("silent synthesizer advance", () => {
  it.each([44_100, 48_000])("advances exactly the requested output frames at %s Hz", async sampleRate => {
    let frames = 0;
    const player = { renderInto: vi.fn((left: Float32Array) => { frames += left.length; return 1; }), isTerminated: () => false };
    await advancePlaybackSilently(player, 0.12345, sampleRate, () => {});
    expect(frames).toBe(Math.round(0.12345 * sampleRate));
    expect(player.renderInto.mock.calls.every(([left]) => left.length <= 2048)).toBe(true);
  });

  it("stops rendering as soon as the finite score terminates", async () => {
    let frames = 0;
    const player = { renderInto: (left: Float32Array) => { frames += left.length; return 1; }, isTerminated: () => frames >= 4096 };
    await advancePlaybackSilently(player, 100, 48_000, () => {});
    expect(frames).toBe(4096);
  });

  it("yields to STOP and never touches the superseding renderer after cancellation", async () => {
    vi.useFakeTimers();
    let clock = 0;
    vi.spyOn(performance, "now").mockImplementation(() => clock);
    let cancelled = false;
    const player = { renderInto: vi.fn(() => { clock += 9; return 1; }), isTerminated: () => false };
    const pending = advancePlaybackSilently(player, 100, 48_000, () => { if (cancelled) throw new Error("cancelled"); });
    expect(player.renderInto).toHaveBeenCalledOnce();
    cancelled = true;
    const rejected = expect(pending).rejects.toThrow("cancelled");
    await vi.runAllTimersAsync();
    await rejected;
    expect(player.renderInto).toHaveBeenCalledOnce();
  });
});
