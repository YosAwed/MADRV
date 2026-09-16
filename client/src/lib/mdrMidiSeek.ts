export type MidiSeekEvent = { at: number; sourceTrack: number; bytes: number[] };
export type MidiSeekPosition = { cursor: number; cycle: number };

/** Chase settings in score order. RPN/NRPN and SysEx cannot be reduced to the last CC value.
 * Notes crossing the seek point deliberately remain silent until the next note-on.
 */
export async function chaseMidiBefore(
  events: readonly MidiSeekEvent[],
  target: number,
  options: {
    loopStartIndex: number;
    loopPeriod: number;
    dispatchAt(eventAt: number): number;
    skip(event: MidiSeekEvent, cycle: number): boolean;
    apply(messages: number[][]): Promise<void>;
    assertCurrent(): void;
  },
): Promise<MidiSeekPosition> {
  let cursor = 0;
  let cycle = 0;
  let visited = 0;
  let batch: number[][] = [];
  const flush = async () => {
    options.assertCurrent();
    if (batch.length) await options.apply(batch);
    batch = [];
    options.assertCurrent();
  };
  while (events.length) {
    options.assertCurrent();
    if (cursor === events.length) {
      if (options.loopStartIndex < 0 || options.loopPeriod <= 0) break;
      cursor = options.loopStartIndex;
      cycle++;
    }
    const event = events[cursor];
    if (options.dispatchAt(event.at + cycle * options.loopPeriod) >= target) break;
    cursor++;
    const kind = event.bytes[0] & 0xf0;
    if (kind !== 0x80 && kind !== 0x90 && !options.skip(event, cycle)) batch.push(event.bytes);
    if (batch.length >= 256) await flush();
    // Note-only scores also yield, allowing STOP to cancel long loop scans.
    if (++visited % 4096 === 0) {
      await new Promise<void>(resolve => setTimeout(resolve, 0));
      options.assertCurrent();
    }
  }
  await flush();
  return { cursor, cycle };
}
