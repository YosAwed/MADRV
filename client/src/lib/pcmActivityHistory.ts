export const PCM_HISTORY_MS = 4_000;

/** Display-only history of reported voice activity, not amplitude or note events. */
export class PcmActivityHistory {
  private changes: { at: number; active: boolean }[] = [];

  clear() {
    this.changes = [];
  }

  record(at: number, active: boolean) {
    if (this.changes.at(-1)?.active !== active)
      this.changes.push({ at, active });
    this.trim(at);
  }

  private trim(now: number) {
    // Retain the state crossing the left edge, including a long held voice.
    while (
      this.changes.length > 1 &&
      this.changes[1].at <= now - PCM_HISTORY_MS
    ) {
      this.changes.shift();
    }
  }

  ranges(now: number): { start: number; end: number }[] {
    this.trim(now);
    const left = now - PCM_HISTORY_MS;
    return this.changes.flatMap((change, index) => {
      const start = Math.max(left, change.at);
      const end = Math.min(now, this.changes[index + 1]?.at ?? now);
      return change.active && end > start
        ? [
            {
              start: ((start - left) / PCM_HISTORY_MS) * 100,
              end: ((end - left) / PCM_HISTORY_MS) * 100,
            },
          ]
        : [];
    });
  }
}
