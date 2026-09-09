import { describe, expect, it } from "vitest";
import type { ScheduledMdrMidiEvent } from "./madrvEngine";
import { extendMdrTrackLoops } from "./mdrTrackLoops";

const event = (at: number, sourceTrack: number, bytes: number[]): ScheduledMdrMidiEvent => ({ at, sourceTrack, bytes });
function hats(passes: number, rest = 0): ScheduledMdrMidiEvent[] {
  const events = [event(0, 0, [0xb9, 7, 100])];
  for (let index = 0; index < passes; index++) {
    const start = 1 + index * 0.5;
    events.push(event(start, 0, [0x99, 42, 110]), event(start + 0.5 - rest, 0, [0x89, 42, 0]));
  }
  return events.sort((a, b) => a.at - b.at);
}
const melody = [event(1, 1, [0x90, 60, 100]), event(9, 1, [0x80, 60, 0])];
const finiteDrum = [event(1, 2, [0x99, 36, 100]), event(2, 2, [0x89, 36, 0])];
const probes = (passes: number, rest = 0) => [...hats(passes, rest), ...melody, ...finiteDrum].sort((a, b) => a.at - b.at);

describe("independent MDR track L loops", () => {
  it("keeps a short hi-hat L running to the song ending without repeating its intro or a finite drum track", () => {
    const original = probes(3);
    const repaired = extendMdrTrackLoops(original, probes(3), probes(4), 9);
    const noteOns = repaired.filter(e => e.sourceTrack === 0 && e.bytes[0] === 0x99);
    expect(noteOns.map(e => e.at)).toEqual(Array.from({ length: 16 }, (_, i) => 1 + i * 0.5));
    expect(repaired.filter(e => e.bytes[0] === 0xb9)).toEqual([event(0, 0, [0xb9, 7, 100])]);
    expect(repaired.filter(e => e.sourceTrack === 1)).toEqual(melody);
    expect(repaired.filter(e => e.sourceTrack === 2)).toEqual(finiteDrum);
    expect(repaired.at(-1)?.at).toBe(9);
    expect(repaired.some(e => e.bytes[0] === 0xb9 && e.bytes[1] === 123)).toBe(false);
    expect(original).toEqual(probes(3));
  });

  it("preserves the track's trailing rest and phase when the song length is not a multiple of its L period", () => {
    const original = probes(3, 0.125);
    const repaired = extendMdrTrackLoops(original, probes(3, 0.125), probes(4, 0.125), 4.13);
    const track = repaired.filter(e => e.sourceTrack === 0);
    expect(track.filter(e => e.bytes[0] === 0x99).map(e => e.at)).toEqual([1, 1.5, 2, 2.5, 3, 3.5, 4]);
    expect(track.at(-1)).toEqual(event(4.13, 0, [0x89, 42, 0]));
    expect(track.filter(e => e.at === 2.375)).toEqual([event(2.375, 0, [0x89, 42, 0])]);
  });

  it("does not invent a loop for unchanged or non-repeating probe data", () => {
    const original = probes(3);
    expect(extendMdrTrackLoops(original, original, original, 9)).toEqual(original);
    const changing = probes(4).map(e => e.at >= 2.5 && e.bytes[0] === 0x99 ? { ...e, bytes: [0x99, 42, 90] } : e);
    expect(extendMdrTrackLoops(original, original, changing, 9)).toEqual(original);
  });
});
