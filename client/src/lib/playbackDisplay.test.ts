import { describe, expect, it } from "vitest";
import { playbackProgressPercent, resolveMdrDisplayLoop, resolvePlaybackDisplayPosition } from "./madrvEngine";

describe("single-pass playback display", () => {
  it("uses one BOMB pass instead of the extractor's two-pass event buffer and release tail", () => {
    const loop = resolveMdrDisplayLoop({ startSeconds: 40.123392, endSeconds: 80.13312 });
    expect(loop?.firstPassSeconds).toBeCloseTo(40.123392);
    expect(loop?.cycleSeconds).toBeCloseTo(40.009728);
    const halfway = resolvePlaybackDisplayPosition(20.061696, 83.65, loop);
    expect(playbackProgressPercent(halfway.elapsed, halfway.duration)).toBeCloseTo(50);
    const second = resolvePlaybackDisplayPosition(40.123392 + 20.004864, 83.65, loop);
    expect(second.duration).toBeCloseTo(40.009728);
    expect(playbackProgressPercent(second.elapsed, second.duration)).toBeCloseTo(50);
  });

  it("shows an intro only in the first pass and resets every later cycle, including long infinite playback", () => {
    const loop = resolveMdrDisplayLoop({ startSeconds: 45, endSeconds: 85 });
    expect(resolvePlaybackDisplayPosition(44.9, 86.5, loop)).toEqual({ elapsed: 44.9, duration: 45 });
    for (const cycle of [0, 1, 2, 3, 9999]) {
      expect(resolvePlaybackDisplayPosition(45 + 40 * cycle, 86.5, loop)).toEqual({ elapsed: 0, duration: 40 });
      expect(resolvePlaybackDisplayPosition(45 + 40 * cycle + 39, 86.5, loop)).toEqual({ elapsed: 39, duration: 40 });
    }
  });

  it("preserves a finite non-looping song and rejects invalid loop metadata", () => {
    for (const window of [undefined, { startSeconds: -1, endSeconds: -1 }, { startSeconds: 3, endSeconds: 3 }, { startSeconds: NaN, endSeconds: 4 }]) expect(resolveMdrDisplayLoop(window)).toBeUndefined();
    expect(resolvePlaybackDisplayPosition(12, 10)).toEqual({ elapsed: 10, duration: 10 });
    expect(resolvePlaybackDisplayPosition(-1, 10)).toEqual({ elapsed: 0, duration: 10 });
  });

  it("holds the last pass at 100% through the finite release tail instead of starting a phantom pass", () => {
    const loop = { firstPassSeconds: 45, cycleSeconds: 40 };
    for (const passes of [1, 2, 4]) {
      const end = 45 + (passes - 1) * 40;
      const duration = passes === 1 ? 45 : 40;
      expect(resolvePlaybackDisplayPosition(end - 1, 86.5, loop, end)).toEqual({ elapsed: duration - 1, duration });
      expect(resolvePlaybackDisplayPosition(end + 0.5, 86.5, loop, end)).toEqual({ elapsed: duration, duration });
    }
    expect(resolvePlaybackDisplayPosition(165.5, 86.5, loop)).toEqual({ elapsed: 0.5, duration: 40 });
    expect(resolvePlaybackDisplayPosition(4.5, 5.5, { firstPassSeconds: 1, cycleSeconds: 1 }, 4)).toEqual({ elapsed: 1, duration: 1 });
  });
});
