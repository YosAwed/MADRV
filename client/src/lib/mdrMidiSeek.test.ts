import { describe, expect, it } from "vitest";
import { chaseMidiBefore, type MidiSeekEvent } from "./mdrMidiSeek";

async function chase(events: MidiSeekEvent[], target: number, overrides = {}) {
  const restored: number[][] = [];
  const position = await chaseMidiBefore(events, target, {
    loopStartIndex: -1, loopPeriod: 0, dispatchAt: at => at, skip: () => false,
    apply: async messages => { restored.push(...messages); }, assertCurrent: () => {}, ...overrides,
  });
  return { restored, position };
}
const event = (at: number, bytes: number[], sourceTrack = 16) => ({ at, bytes, sourceTrack });

describe("MDR MIDI state chase", () => {
  it("preserves bank/program, RPN/NRPN data-entry order, resets, pitch, sustain and SysEx", async () => {
    const settings = [[0xb0, 0, 8], [0xb0, 32, 1], [0xc0, 42], [0xb0, 101, 0], [0xb0, 100, 0],
      [0xb0, 6, 12], [0xb0, 99, 1], [0xb0, 98, 2], [0xb0, 6, 64], [0xb0, 96, 0],
      [0xb0, 121, 0], [0xe0, 0, 70], [0xb0, 64, 127], [0xf0, 0x7e, 0x7f, 9, 1, 0xf7]];
    const events = settings.map(bytes => event(1, bytes));
    events.splice(4, 0, event(1, [0x90, 60, 100]), event(1, [0x90, 60, 0]), event(1, [0x80, 60, 0]));
    const result = await chase(events, 2);
    expect(result.restored).toEqual(settings);
    expect(result.position).toEqual({ cursor: events.length, cycle: 0 });
  });

  it("keeps target-boundary events for live playback and respects positive/negative MIDI delay", async () => {
    const events = [event(1, [0xc0, 1]), event(2, [0x90, 60, 100]), event(3, [0xc0, 2])];
    expect((await chase(events, 2)).position.cursor).toBe(1);
    expect((await chase(events, 1.25, { dispatchAt: (at: number) => at + 0.5 })).position.cursor).toBe(0);
    expect((await chase(events, 1.75, { dispatchAt: (at: number) => at - 0.5 })).position.cursor).toBe(2);
    expect((await chase(events, 0)).restored).toEqual([]);
  });

  it("replays repeated loop settings in order, skipping the intro and loop reset as requested", async () => {
    const events = [event(0, [0xc0, 1]), event(1, [0xf0, 0xf7]), event(1, [0xb0, 96, 0]), event(2, [0xc0, 2])];
    const result = await chase(events, 5, { loopStartIndex: 1, loopPeriod: 2,
      skip: (e: MidiSeekEvent, cycle: number) => cycle > 0 && e.bytes[0] === 0xf0 });
    expect(result.restored).toEqual([[0xc0, 1], [0xf0, 0xf7], [0xb0, 96, 0], [0xc0, 2], [0xb0, 96, 0], [0xc0, 2]]);
    expect(result.position).toEqual({ cursor: 1, cycle: 2 });
  });

  it("bounds batches, preserves muted-track policy, and aborts when STOP supersedes restoration", async () => {
    let current = true;
    let count = 0;
    const events = Array.from({ length: 1024 }, (_, index) => event(index / 100, [0xb0, 7, index % 128], index % 2 ? 16 : 17));
    await expect(chase(events, 20, {
      skip: (e: MidiSeekEvent) => e.sourceTrack === 17,
      assertCurrent: () => { if (!current) throw new Error("cancelled"); },
      apply: async (messages: number[][]) => { expect(messages.length).toBe(256); count++; current = false; },
    })).rejects.toThrow("cancelled");
    expect(count).toBe(1);
  });
});
