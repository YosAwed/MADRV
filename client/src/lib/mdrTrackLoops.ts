import type { ScheduledMdrMidiEvent } from "./madrvEngine";

const micros = (seconds: number) => Math.round(seconds * 1_000_000);
const sameBytes = (left: readonly number[], right: readonly number[]) => left.length === right.length && left.every((value, index) => value === right[index]);

function byTrack(events: readonly ScheduledMdrMidiEvent[]): Map<number, ScheduledMdrMidiEvent[]> {
  const tracks = new Map<number, ScheduledMdrMidiEvent[]>();
  for (const event of events) {
    const track = tracks.get(event.sourceTrack) ?? [];
    track.push(event);
    tracks.set(event.sourceTrack, track);
  }
  return tracks;
}

/**
 * The converter's finite mode caps each track's L returns separately. A short
 * ostinato can therefore end before the rest of the song. Two adjacent finite
 * probes identify that track's own repeating suffix, including trailing rests.
 * Extend only a verified stable suffix; never repeat its setup/intro or a track
 * whose event stream is unchanged by the loop count (a written finite ending).
 */
export function extendMdrTrackLoops(
  events: readonly ScheduledMdrMidiEvent[],
  twoLoopEvents: readonly ScheduledMdrMidiEvent[],
  threeLoopEvents: readonly ScheduledMdrMidiEvent[],
  songEndSeconds: number,
): ScheduledMdrMidiEvent[] {
  const end = micros(songEndSeconds);
  if (!Number.isFinite(end) || end <= 0) return [...events];
  const tracks = byTrack(events);
  const two = byTrack(twoLoopEvents);
  const three = byTrack(threeLoopEvents);
  const additions: ScheduledMdrMidiEvent[] = [];
  for (const [sourceTrack, original] of Array.from(tracks)) {
    const second = two.get(sourceTrack);
    const third = three.get(sourceTrack);
    if (!second?.length || !third?.length || !original.length) continue;
    const stoppedAt = micros(original.at(-1)!.at);
    if (stoppedAt >= end) continue;
    const secondEnd = micros(second.at(-1)!.at);
    const thirdEnd = micros(third.at(-1)!.at);
    const period = thirdEnd - secondEnd;
    if (period <= 0) continue;
    const previous = third.filter(event => micros(event.at) >= secondEnd - period && micros(event.at) < secondEnd);
    const cycle = third.filter(event => micros(event.at) >= secondEnd && micros(event.at) < thirdEnd);
    if (!cycle.length || cycle.length !== previous.length || !cycle.some(event => (event.bytes[0] & 0xf0) === 0x90 && event.bytes[2] > 0)) continue;
    if (!cycle.every((event, index) => micros(event.at) - micros(previous[index].at) === period && sameBytes(event.bytes, previous[index].bytes))) continue;
    // The requested stream must end at the same phase of this L body.
    if ((stoppedAt - secondEnd) % period !== 0) continue;
    const repeats = Math.ceil((end - stoppedAt) / period);
    if (events.length + additions.length + repeats * cycle.length > 2_000_000) throw new Error("Lループの再生データが大きすぎます。繰り返し回数を減らしてください。");
    const extended: ScheduledMdrMidiEvent[] = [];
    const existingAtBoundary = original.filter(event => micros(event.at) === stoppedAt);
    for (let repeat = 0; repeat < repeats; repeat += 1) {
      for (const event of cycle) {
        const at = stoppedAt + repeat * period + micros(event.at) - secondEnd;
        if (at >= end) break;
        if (repeat === 0 && at === stoppedAt && existingAtBoundary.some(existing => sameBytes(existing.bytes, event.bytes))) continue;
        extended.push({ at: at / 1_000_000, sourceTrack, bytes: [...event.bytes] });
      }
    }
    if (!extended.length) continue;
    // Stop only this track's remaining notes at the shared ending. Channel-wide
    // All Notes Off could cut another part using the same MIDI channel.
    const active = new Map<string, { channel: number; note: number }>();
    for (const event of [...original, ...extended]) {
      const [status, note, velocity] = event.bytes;
      const channel = status & 0x0f;
      const key = `${channel}:${note}`;
      if ((status & 0xf0) === 0x90 && velocity > 0) active.set(key, { channel, note });
      else if ((status & 0xf0) === 0x80 || ((status & 0xf0) === 0x90 && velocity === 0)) active.delete(key);
      else if ((status & 0xf0) === 0xb0 && (note === 120 || note === 123)) {
        for (const [key, entry] of Array.from(active)) if (entry.channel === channel) active.delete(key);
      }
    }
    for (const event of extended) additions.push(event);
    for (const { channel, note } of Array.from(active.values())) additions.push({ at: end / 1_000_000, sourceTrack, bytes: [0x80 | channel, note, 0] });
  }
  return [...events, ...additions].sort((left, right) => left.at - right.at);
}
