/** Convert a position within the displayed pass to the absolute score clock. */
export function playbackSeekTarget(
  requestedSeconds: number,
  displayedSeconds: number,
  songSeconds: number,
  displayDuration: number,
  finiteDuration?: number,
): number {
  if (![requestedSeconds, displayedSeconds, songSeconds, displayDuration].every(Number.isFinite) || displayDuration <= 0) {
    throw new Error("移動先の再生位置が不正です。");
  }
  const passStart = Math.max(0, songSeconds - displayedSeconds);
  const target = passStart + Math.min(displayDuration, Math.max(0, requestedSeconds));
  return finiteDuration !== undefined && Number.isFinite(finiteDuration)
    ? Math.min(Math.max(0, finiteDuration), target)
    : target;
}

type SilentRenderer = {
  renderInto(left: Float32Array, right: Float32Array): number;
  isTerminated(): boolean;
};

/**
 * Advance the actual synthesizer, including PCM cursors and FM envelopes. No
 * audio node or MIDI output is involved. Yield so STOP/source replacement can
 * cancel long seeks; check ownership again before touching the renderer.
 */
export async function advancePlaybackSilently(
  player: SilentRenderer,
  seconds: number,
  sampleRate: number,
  assertCurrent: () => void,
): Promise<void> {
  if (!Number.isFinite(seconds) || seconds < 0 || !Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new Error("移動先の再生位置が不正です。");
  }
  let remaining = Math.round(seconds * sampleRate);
  if (!Number.isSafeInteger(remaining)) throw new Error("移動先の再生位置が大きすぎます。");
  const left = new Float32Array(2048);
  const right = new Float32Array(2048);
  let sliceStarted = performance.now();
  assertCurrent();
  while (remaining > 0 && !player.isTerminated()) {
    assertCurrent();
    const frames = Math.min(remaining, left.length);
    player.renderInto(left.subarray(0, frames), right.subarray(0, frames));
    remaining -= frames;
    if (remaining > 0 && performance.now() - sliceStarted >= 8) {
      await new Promise<void>(resolve => setTimeout(resolve, 0));
      assertCurrent();
      sliceStarted = performance.now();
    }
  }
  assertCurrent();
}
