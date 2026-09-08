type RenderedAudioBlock = {
  startFrame: number;
  endFrame: number;
  playbackTime: number;
};

/** Maps rendered song samples to their output timestamps, independently of UI timers or MXDRV's tick counter. */
export class MdrAudioTimeline {
  private readonly sampleRate: number;
  private readonly historyFrames: number;
  private readonly blocks: RenderedAudioBlock[] = [];
  private outputFrames = 0;
  private terminated = false;
  private firstPlaybackTime?: number;

  constructor(sampleRate: number) {
    this.sampleRate = Number.isFinite(sampleRate) && sampleRate >= 8_000 && sampleRate <= 192_000 ? sampleRate : 48_000;
    // Preserve substantially more than the maximum 500 ms user timing correction.
    this.historyFrames = Math.ceil(this.sampleRate * 4);
  }

  get ready(): boolean { return this.blocks.length > 0; }
  get ended(): boolean { return this.terminated; }
  get renderedSeconds(): number { return this.outputFrames / this.sampleRate; }

  /** Each timestamp belongs to the beginning of this output block, not to when its callback runs. */
  recordBlock(playbackTime: number, frameCount: number, terminated: boolean): void {
    if (this.terminated || !Number.isFinite(playbackTime) || playbackTime < 0 || !Number.isFinite(frameCount)) return;
    const frames = Math.floor(frameCount);
    if (frames <= 0 || !Number.isSafeInteger(this.outputFrames + frames)) return;
    const previous = this.blocks.at(-1);
    if (previous && playbackTime < previous.playbackTime) return;
    // ScriptProcessor reports may overlap under main-thread stalls. Do not
    // carry their maximum lateness forward forever by forcing contiguous ends.
    // The MIDI queue separately protects message order across such overlaps;
    // these reports are not a measurement of actual PCM consumption under load.
    this.firstPlaybackTime ??= playbackTime;
    this.blocks.push({ startFrame: this.outputFrames, endFrame: this.outputFrames + frames, playbackTime });
    this.outputFrames += frames;
    this.terminated = terminated;
    const oldestRequiredFrame = this.outputFrames - this.historyFrames;
    while (this.blocks.length > 1 && this.blocks[0]!.endFrame <= oldestRequiredFrame) this.blocks.shift();
  }

  /** Active playback exposes only rendered half-open intervals; a finished renderer exposes the continuing MIDI tail. */
  targetAt(songSeconds: number): number | undefined {
    if (!Number.isFinite(songSeconds) || songSeconds < 0 || !this.ready) return undefined;
    const last = this.blocks.at(-1)!;
    if (songSeconds >= this.renderedSeconds) {
      return this.terminated ? last.playbackTime + (songSeconds - last.startFrame / this.sampleRate) : undefined;
    }
    for (let index = this.blocks.length - 1; index >= 0; index -= 1) {
      const block = this.blocks[index]!;
      const startSeconds = block.startFrame / this.sampleRate;
      if (songSeconds >= startSeconds && songSeconds < block.endFrame / this.sampleRate) {
        return block.playbackTime + (songSeconds - startSeconds);
      }
    }
    // An old, unqueued event cannot safely be retimed from an unrelated recent block.
    return undefined;
  }

  /** Holds song position across output gaps and never advances beyond audio that has actually been rendered. */
  songSecondsAt(audioTime: number): number {
    if (!Number.isFinite(audioTime) || !this.ready || audioTime <= this.firstPlaybackTime!) return 0;
    const last = this.blocks.at(-1)!;
    const finalAudioEnd = last.playbackTime + (last.endFrame - last.startFrame) / this.sampleRate;
    if (this.terminated && audioTime >= finalAudioEnd) return this.renderedSeconds + (audioTime - finalAudioEnd);
    for (let index = this.blocks.length - 1; index >= 0; index -= 1) {
      const block = this.blocks[index]!;
      if (audioTime < block.playbackTime) continue;
      const frameDuration = (block.endFrame - block.startFrame) / this.sampleRate;
      return block.startFrame / this.sampleRate + Math.min(frameDuration, audioTime - block.playbackTime);
    }
    // Queries older than retained history clamp to its oldest known song position.
    return this.blocks[0]!.startFrame / this.sampleRate;
  }
}
