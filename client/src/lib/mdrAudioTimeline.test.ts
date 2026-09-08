import { describe, expect, it } from "vitest";
import { MdrAudioTimeline } from "./mdrAudioTimeline";

describe("MdrAudioTimeline", () => {
  it("has no scheduling horizon before the first rendered block", () => {
    const clock = new MdrAudioTimeline(48_000);
    expect(clock.ready).toBe(false);
    expect(clock.ended).toBe(false);
    expect(clock.renderedSeconds).toBe(0);
    expect(clock.targetAt(0)).toBeUndefined();
    expect(clock.songSecondsAt(10)).toBe(0);
  });

  it("can reserve the first MIDI note before the first block becomes audible", () => {
    const clock = new MdrAudioTimeline(48_000);
    clock.recordBlock(10.4, 16_384, false);
    expect(clock.ready).toBe(true);
    expect(clock.targetAt(0)).toBe(10.4);
    expect(clock.targetAt(0.1)).toBeCloseTo(10.5, 12);
    expect(clock.songSecondsAt(10)).toBe(0);
    expect(clock.songSecondsAt(10.45)).toBeCloseTo(0.05, 12);
  });

  it.each([44_100, 48_000])("retains exact sample timing for ten minutes at %i Hz despite irregular callback observations", sampleRate => {
    const clock = new MdrAudioTimeline(sampleRate);
    const blockFrames = 2048;
    const startAt = 7.25;
    const blocks = Math.ceil(600 * sampleRate / blockFrames);
    for (let index = 0; index < blocks; index += 1) {
      const songStart = index * blockFrames / sampleRate;
      // Neither callback arrival time nor the quantized MXDRV playhead is an input.
      const callbackJitter = index % 7 * 0.013;
      clock.recordBlock(startAt + songStart, blockFrames, false);
      const songEvent = (index * blockFrames + 997) / sampleRate;
      expect(clock.targetAt(songEvent)).toBeCloseTo(startAt + songEvent, 10);
      expect(clock.songSecondsAt(startAt + songStart + callbackJitter))
        .toBeCloseTo(Math.min(clock.renderedSeconds, songStart + callbackJitter), 10);
    }
    expect(clock.renderedSeconds).toBe(blocks * blockFrames / sampleRate);
  });

  it("does not accumulate rounded block durations", () => {
    const clock = new MdrAudioTimeline(44_100);
    for (let index = 0; index < 10_000; index += 1) clock.recordBlock(2 + index * 128 / 44_100, 128, false);
    expect(clock.renderedSeconds).toBe(1_280_000 / 44_100);
    expect(clock.targetAt(1_279_999 / 44_100)).toBeCloseTo(2 + 1_279_999 / 44_100, 12);
  });

  it("maps each delayed output block once and holds song position during gaps", () => {
    const clock = new MdrAudioTimeline(48_000);
    clock.recordBlock(10, 4800, false);
    clock.recordBlock(10.3, 4800, false);
    clock.recordBlock(10.4, 4800, false);
    expect(clock.targetAt(0.05)).toBeCloseTo(10.05, 12);
    expect(clock.targetAt(0.15)).toBeCloseTo(10.35, 12);
    expect(clock.targetAt(0.25)).toBeCloseTo(10.45, 12);
    expect(clock.songSecondsAt(10.2)).toBeCloseTo(0.1, 12);
    expect(clock.songSecondsAt(10.3)).toBeCloseTo(0.1, 12);
    expect(clock.songSecondsAt(10.45)).toBeCloseTo(0.25, 12);
    expect(clock.songSecondsAt(11)).toBeCloseTo(0.3, 12);
  });

  it.each([44_100, 48_000])("keeps the active end exclusive at %i Hz", sampleRate => {
    const clock = new MdrAudioTimeline(sampleRate);
    clock.recordBlock(10, 16_384, false);
    const boundary = clock.renderedSeconds;
    expect(clock.targetAt(boundary - 1 / sampleRate)).toBeDefined();
    expect(clock.targetAt(boundary)).toBeUndefined();
    expect(clock.targetAt(boundary + 1 / sampleRate)).toBeUndefined();
    clock.recordBlock(11, 16_384, false);
    expect(clock.targetAt(boundary)).toBe(11);
  });

  it("continues trailing MIDI from the final audio block and ignores post-termination rendering", () => {
    const clock = new MdrAudioTimeline(48_000);
    clock.recordBlock(10, 4800, false);
    clock.recordBlock(10.3, 4800, true);
    expect(clock.ended).toBe(true);
    expect(clock.targetAt(0.2)).toBeCloseTo(10.4, 12);
    expect(clock.targetAt(26)).toBeCloseTo(36.2, 12);
    expect(clock.songSecondsAt(10.2)).toBeCloseTo(0.1, 12);
    expect(clock.songSecondsAt(10.35)).toBeCloseTo(0.15, 12);
    expect(clock.songSecondsAt(36.2)).toBeCloseTo(26, 12);
    clock.recordBlock(100, 48_000, false);
    expect(clock.renderedSeconds).toBe(0.2);
    expect(clock.targetAt(26)).toBeCloseTo(36.2, 12);
  });

  it("retains recent backwards lookups and discards old scheduling history", () => {
    const clock = new MdrAudioTimeline(48_000);
    for (let index = 0; index < 200; index += 1) clock.recordBlock(10 + index * 0.1, 4800, false);
    expect(clock.targetAt(19.9)).toBeCloseTo(29.9, 12);
    expect(clock.targetAt(19.4)).toBeCloseTo(29.4, 12);
    expect(clock.targetAt(16.1)).toBeCloseTo(26.1, 12);
    expect(clock.targetAt(1)).toBeUndefined();
    expect(clock.songSecondsAt(9)).toBe(0);
    expect(clock.songSecondsAt(29.5)).toBeCloseTo(19.5, 12);
  });

  it("ignores invalid blocks and rejects invalid query times without producing NaN", () => {
    const clock = new MdrAudioTimeline(Number.NaN);
    for (const time of [Number.NaN, Number.POSITIVE_INFINITY, -1]) clock.recordBlock(time, 4800, true);
    for (const frames of [Number.NaN, Number.POSITIVE_INFINITY, -1, 0, Number.MAX_SAFE_INTEGER + 1]) clock.recordBlock(10, frames, true);
    expect(clock.ready).toBe(false);
    expect(clock.ended).toBe(false);
    clock.recordBlock(10, 4800, false);
    expect(clock.renderedSeconds).toBe(0.1);
    clock.recordBlock(9, 4800, true);
    expect(clock.ended).toBe(false);
    expect(clock.renderedSeconds).toBe(0.1);
    for (const time of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
      expect(clock.targetAt(time)).toBeUndefined();
      expect(clock.songSecondsAt(time)).toBe(0);
    }
  });
});
