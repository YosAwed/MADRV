import { describe, expect, it } from "vitest";
import { PcmActivityHistory } from "./pcmActivityHistory";

describe("PCM activity history", () => {
  it("retains a short pulse that starts and ends between display refreshes", () => {
    const history = new PcmActivityHistory();
    history.record(1_000, false);
    history.record(1_020, true);
    history.record(1_050, false);
    const [pulse] = history.ranges(1_100);
    expect(pulse.start).toBeCloseTo(98);
    expect(pulse.end).toBeCloseTo(98.75);
    expect(history.ranges(5_050)).toEqual([]);
  });

  it("keeps a sustained voice across the left edge without needing repeated reports", () => {
    const history = new PcmActivityHistory();
    history.record(0, true);
    expect(history.ranges(12_000)).toEqual([{ start: 0, end: 100 }]);
    history.record(12_000, false);
    expect(history.ranges(14_000)).toEqual([{ start: 0, end: 50 }]);
  });

  it("preserves silence between hits and clears history across playback discontinuities", () => {
    const history = new PcmActivityHistory();
    history.record(0, true);
    history.record(100, false);
    history.record(300, true);
    history.record(400, false);
    expect(history.ranges(500)).toHaveLength(2);
    history.clear();
    history.record(600, false);
    expect(history.ranges(700)).toEqual([]);
    history.record(800, true);
    expect(history.ranges(900)).toEqual([{ start: 97.5, end: 100 }]);
  });
});
