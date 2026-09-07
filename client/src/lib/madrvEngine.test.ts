import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { extractMdrTempoTimerB, extractMmlInitialTempo, fetchRemoteSoundFont, fetchSharedSoundFont, formatMidiNoteName, formatPdxFileName, inspectMadrvSource, inspectMdr, inspectMdx, isCurrentPlaybackGeneration, isGsMidiEngineArmed, isMidiPlaybackDestinationReady, isOpmPcmEngineArmed, isPcmPdxEngineArmed, isSafariBrowserUserAgent, isSignedTimingCorrectionDraft, isWasmPcmRenderFailure, listMdrMixerTracks, MADRV_DEFAULT_TEMPO_TIMER_B, mdrRequiresPdx, mxdrvRawNoteToMidiNote, mxdrvRawNoteToPitchClass, normalizeExternalMidiAdvanceMs, normalizeSoundFontMdrDelayMs, normalizeSoundFontMdrDelayProfiles, parseRemoteCatalogPayload, playbackProgressPercent, recommendPlaybackTuning, recommendSoundFontMdrDelayMs, requiresMdrHardwareRenderer, requiresStableMadrvProfileForSoundFont, resamplePcmFrames, resolveExternalMidiDispatchAtSeconds, resolveMdrDisplayTempoTimerB, resolveMdrHardwareLoopCycleSeconds, resolveMdrInfiniteMidiCycle, resolveMdrInfiniteMidiLoopPeriodSeconds, resolveMdrMidiLiveTargetAtSeconds, resolveMdrMidiLookaheadSeconds, resolveMdrMidiLoopDispatchAtSeconds, resolveMdrMidiPumpIntervalMs, resolveMdrMidiTimingSampleRate, resolveMdrPlaybackDuration, resolveMdrPlaybackFailsafeSeconds, resolveMdrPlaybackStartLatencySeconds, resolveMdrRendererLatencySeconds, resolveMdrTrackEngine, resolveMdxPlaybackTick, resolveNextPlaylistIndex, resolvePlaybackSampleRate, resolvePlaylistInterTrackSilenceSeconds, resolveProgressUpdateIntervalMs, resolveRealtimeVisualUpdateIntervalMs, resolveScriptProcessorBufferSize, resolveSoundFontMdrDelayProfile, resolveSoundFontMdrDispatchAtSeconds, resolveSoundFontMdrScheduleAtSeconds, resolveSoundFontMdrSyncResidualMs, resolveSoundFontMdrTimingComparisonDelay, resolveTrustedMdrMidiLoopWindow, selectMdrInfiniteMidiLoopEvents, selectMdrMidiLoopWindowEvents, setSoundFontMdrDelayProfile, shouldDispatchQueuedSoundFontMdrEvent, shouldEndFiniteMdrPlayback, shouldScheduleMdrMidiDirectlyAtLoopStart, shouldSkipMdrMidiEventAtLoopCycle, shouldStopGsSynthImmediatelyForMdrReset, stepSoundFontMdrDelayMs, timerBToEstimatedBpm, updateMidiTrackNotes, updateSoundFontMdrDelayMeasurement } from "./madrvEngine";

function makeDiagnosticMdr(midiTrackIndex = -1, legacyMidiTrackIndex = -1): ArrayBuffer {
  const title = new TextEncoder().encode("Signal Deck Diagnostic\r\n\x1aNONE\0");
  const table = new Uint8Array(66);
  const tracks: number[] = [];
  let offset = 66;
  for (let index = 0; index < 32; index += 1) {
    table[2 + index * 2] = offset >> 8;
    table[3 + index * 2] = offset & 0xff;
    const track = index === 0 ? [0xe0, 0xff, 0xe0, 0x08, 0x00, 0x80, 0x03, 0xf1, 0x00] : index === midiTrackIndex ? [0xe0, 0x08, 0x80, 0x80, 0x03, 0xf1, 0x00] : index === legacyMidiTrackIndex ? [0x80, 0x03, 0xf1, 0x00] : [0xf1, 0x00];
    tracks.push(...track);
    offset += track.length;
  }
  table[0] = offset >> 8;
  table[1] = offset & 0xff;
  const bytes = new Uint8Array(title.length + table.length + tracks.length);
  bytes.set(title, 0);
  bytes.set(table, title.length);
  bytes.set(tracks, title.length + table.length);
  return bytes.buffer;
}

function makeLegacySlotRoutedMdr(): ArrayBuffer {
  const title = new TextEncoder().encode("Legacy slot routing\r\n\x1aNONE\0");
  const table = new Uint8Array(66);
  const tracks: number[] = [];
  let offset = 66;
  for (let index = 0; index < 32; index += 1) {
    table[2 + index * 2] = offset >> 8;
    table[3 + index * 2] = offset & 0xff;
    const track = index === 0
      ? [0xe0, 0xff, 0x80, 0x03, 0xf1, 0x00]
      : index === 8
        ? [0x88, 0x03, 0xf1, 0x00]
        : index === 16
          ? [0x60, 0x03, 0xf1, 0x00]
          : [0xf1, 0x00];
    tracks.push(...track);
    offset += track.length;
  }
  table[0] = offset >> 8;
  table[1] = offset & 0xff;
  const bytes = new Uint8Array(title.length + table.length + tracks.length);
  bytes.set(title, 0);
  bytes.set(table, title.length);
  bytes.set(tracks, title.length + table.length);
  return bytes.buffer;
}

describe("Signal Deck diagnostic catalog", () => {
  it("normalizes the built-in diagnostic catalog entry", () => {
    const entries = parseRemoteCatalogPayload({ entries: [{ id: "signal-deck-diagnostic", title: "Signal Deck — Diagnostic MDR", mdrUrl: "/manus-storage/signal-deck-diagnostic_d91a1673.mdr", tags: ["diagnostic", "opm"] }] });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.mdrUrl).toBe("/manus-storage/signal-deck-diagnostic_d91a1673.mdr");
  });

  it("accepts the diagnostic MDR in the browser-side structure validator", () => {
    const info = inspectMdr(makeDiagnosticMdr());
    expect(info.title).toBe("Signal Deck Diagnostic");
    expect(info.activeTracks).toBe(1);
    expect(info.hardwareTracks).toBe(1);
  });

  it("counts a track that switches to GS MIDI mode as MIDI even within the hardware range", () => {
    const info = inspectMdr(makeDiagnosticMdr(8));
    expect(info.activeTracks).toBe(2);
    expect(info.hardwareTracks).toBe(1);
    expect(info.midiTracks).toBe(1);
  });

  it("retains the legacy GS MIDI track range after channel 16", () => {
    const info = inspectMdr(makeDiagnosticMdr(-1, 16));
    expect(info.hardwareTracks).toBe(1);
    expect(info.midiTracks).toBe(1);
  });

  it("uses legacy MDR slot defaults when native tracks omit E0 08 routing", () => {
    const buffer = makeLegacySlotRoutedMdr();
    const info = inspectMdr(buffer);
    expect(info).toMatchObject({ activeTracks: 3, hardwareTracks: 2, midiTracks: 1 });
    expect(listMdrMixerTracks(buffer).filter((track) => track.active).map((track) => track.engine)).toEqual(["opm", "pcm", "midi"]);
    expect(resolveMdrTrackEngine(new Uint8Array([0xe0, 0xff, 0x80, 0x03, 0xf1, 0x00]), 0, 6, 0)).toBe("opm");
    expect(resolveMdrTrackEngine(new Uint8Array([0x88, 0x03, 0xf1, 0x00]), 0, 4, 8)).toBe("pcm");
    expect(resolveMdrTrackEngine(new Uint8Array([0x60, 0x03, 0xf1, 0x00]), 0, 4, 16)).toBe("midi");
  });

  it("classifies PCM voices parked past track 16 by $E0 $08 channel, not slot index", () => {
    const title = new TextEncoder().encode("PCM High Slot\r\n\x1aNONE\0");
    const table = new Uint8Array(66);
    const tracks: number[] = [];
    let offset = 66;
    for (let index = 0; index < 32; index += 1) {
      table[2 + index * 2] = offset >> 8;
      table[3 + index * 2] = offset & 0xff;
      const track = index === 0
        ? [0xe0, 0xff, 0xe0, 0x08, 0x00, 0x80, 0x03, 0xf1, 0x00]
        : index === 24
          ? [0xe0, 0x08, 0x08, 0x80, 0x03, 0xf1, 0x00]
          : [0xf1, 0x00];
      tracks.push(...track);
      offset += track.length;
    }
    table[0] = offset >> 8;
    table[1] = offset & 0xff;
    const bytes = new Uint8Array(title.length + table.length + tracks.length);
    bytes.set(title, 0);
    bytes.set(table, title.length);
    bytes.set(tracks, title.length + table.length);
    const mixer = listMdrMixerTracks(bytes.buffer);
    expect(mixer.filter((track) => track.active && track.engine === "pcm")).toEqual([
      expect.objectContaining({ index: 24, label: "PCM 1", active: true, pcmVoice: 1 }),
    ]);
    expect(inspectMdr(bytes.buffer)).toMatchObject({ hardwareTracks: 2, midiTracks: 0 });
  });

  it("recognizes MEGALITH PCM buses that live in tracks 24–31", () => {
    const path = resolve(process.cwd(), "../.tmp-mdr/MEGALITH.MDR");
    let buffer: ArrayBuffer;
    try {
      const file = readFileSync(path);
      buffer = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
    } catch {
      return;
    }
    const mixer = listMdrMixerTracks(buffer);
    const pcm = mixer.filter((track) => track.active && track.engine === "pcm");
    expect(pcm.length).toBe(8);
    expect(pcm.map((track) => track.label)).toEqual(["PCM 1", "PCM 2", "PCM 3", "PCM 4", "PCM 5", "PCM 6", "PCM 7", "PCM 8"]);
    expect(pcm.every((track) => track.index >= 24 && track.pcmVoice != null)).toBe(true);
  });

  it("routes EXBA2_GS through GS MIDI playback instead of a stray OPM stub track", () => {
    const path = resolve(process.cwd(), "../.tmp-mdr/EXBA2_GS.MDR");
    let buffer: ArrayBuffer;
    try {
      const file = readFileSync(path);
      buffer = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
    } catch {
      return;
    }
    const info = inspectMdr(buffer);
    expect(info.hardwareTracks).toBe(0);
    expect(info.midiTracks).toBe(10);
    expect(requiresMdrHardwareRenderer(info.hardwareTracks)).toBe(false);
    const mixer = listMdrMixerTracks(buffer).filter((track) => track.active);
    expect(mixer.every((track) => track.engine === "midi")).toBe(true);
    expect(mixer.find((track) => track.index === 6)).toMatchObject({ label: "GS 7", engine: "midi" });
  });
});

describe("MDX companion PDX inspection", () => {
  it("extracts the companion PDX name before playback", () => {
    const header = new TextEncoder().encode("PDX check\r\n\x1aDRA00\0");
    const info = inspectMdx(header.buffer);
    expect(info.title).toBe("PDX check");
    expect(info.pdxName).toBe("DRA00");
  });

  it("does not append a second PDX extension in display text", () => {
    expect(formatPdxFileName("DRA00")).toBe("DRA00.PDX");
    expect(formatPdxFileName("DRA00.PDX")).toBe("DRA00.PDX");
    expect(formatPdxFileName("dra00.pdx")).toBe("dra00.pdx");
  });

  it("recognizes MDR headers that explicitly require no PDX", () => {
    expect(mdrRequiresPdx("NONE")).toBe(false);
    expect(mdrRequiresPdx("UNTITLED")).toBe(false);
    expect(mdrRequiresPdx("MEGALITH")).toBe(true);
  });

  it("detects MDX by validated bytes instead of an ambiguous shared-link URL", () => {
    const mdx = new TextEncoder().encode("Drive linked MDX\r\n\x1aDRA00\0");
    expect(inspectMadrvSource(mdx.buffer)).toMatchObject({ format: "mdx", info: { title: "Drive linked MDX", pdxName: "DRA00" } });
    expect(inspectMadrvSource(makeDiagnosticMdr())).toMatchObject({ format: "mdr", info: { title: "Signal Deck Diagnostic" } });
  });
});

describe("MXDRV PCM return handling", () => {
  it("treats a zero return as successful PCM buffer output", () => {
    expect(isWasmPcmRenderFailure(0)).toBe(false);
    expect(isWasmPcmRenderFailure(128)).toBe(false);
    expect(isWasmPcmRenderFailure(-1)).toBe(true);
  });
});

describe("MIDI playback preflight", () => {
  it("requires either a loaded SoundFont or a selected hardware MIDI output", () => {
    expect(isMidiPlaybackDestinationReady(false, false)).toBe(false);
    expect(isMidiPlaybackDestinationReady(true, false)).toBe(true);
    expect(isMidiPlaybackDestinationReady(false, true)).toBe(true);
  });
});

describe("GS MIDI engine status", () => {
  it("arms for a playing MDR with MIDI tracks", () => {
    expect(isGsMidiEngineArmed(true, 1)).toBe(true);
    expect(isGsMidiEngineArmed(true, 0)).toBe(false);
    expect(isGsMidiEngineArmed(false, 1)).toBe(false);
  });

  it("arms for a playing MIDI MML score", () => {
    expect(isGsMidiEngineArmed(true, 0, true)).toBe(true);
  });
});

describe("OPM/PCM engine status", () => {
  it("arms only when a playing MDR has hardware tracks", () => {
    expect(isOpmPcmEngineArmed(true, 1)).toBe(true);
    expect(isOpmPcmEngineArmed(true, 0)).toBe(false);
    expect(isOpmPcmEngineArmed(false, 1)).toBe(false);
  });

  it("arms for a playing OPM/PCM MML score", () => {
    expect(isOpmPcmEngineArmed(true, 0, true)).toBe(true);
  });
});

describe("playback transport progress", () => {
  it("clamps elapsed time to a valid percentage for the visual marker", () => {
    expect(playbackProgressPercent(2.5, 5)).toBe(50);
    expect(playbackProgressPercent(-3, 5)).toBe(0);
    expect(playbackProgressPercent(8, 5)).toBe(100);
    expect(playbackProgressPercent(1, 0)).toBe(0);
  });

  it("stops MDX progress at the measured endpoint when the live renderer terminates", () => {
    expect(resolveMdxPlaybackTick(3.2, 5, 0, false)).toEqual({ elapsed: 3.2, ended: false });
    expect(resolveMdxPlaybackTick(5.4, 5, 0, true)).toEqual({ elapsed: 5, ended: true });
    expect(resolveMdxPlaybackTick(5.4, 5, 1, false)).toEqual({ elapsed: 5, ended: false });
    expect(resolveMdxPlaybackTick(5.4, 5, 2, false).elapsed).toBeCloseTo(0.4, 8);
  });
});

describe("playlist short-track spacing", () => {
  it("pads tracks up to an 11-second start-to-start interval", () => {
    expect(resolvePlaylistInterTrackSilenceSeconds(3, 1)).toBe(8);
    expect(resolvePlaylistInterTrackSilenceSeconds(10, 1)).toBe(1);
    expect(resolvePlaylistInterTrackSilenceSeconds(10.01, 1)).toBe(0);
  });

  it("uses the complete repeated playback duration", () => {
    expect(resolvePlaylistInterTrackSilenceSeconds(3, 2)).toBe(5);
    expect(resolvePlaylistInterTrackSilenceSeconds(6, 2)).toBe(0);
  });
});

describe("playback source switching", () => {
  it("accepts only callbacks that belong to the active source generation", () => {
    expect(isCurrentPlaybackGeneration(4, 4)).toBe(true);
    expect(isCurrentPlaybackGeneration(4, 5)).toBe(false);
    expect(isCurrentPlaybackGeneration(-1, 0)).toBe(false);
  });
});

describe("external MIDI timing correction", () => {
  it("bounds a user correction and advances only the hardware dispatch deadline", () => {
    expect(normalizeExternalMidiAdvanceMs(17.6)).toBe(18);
    expect(normalizeExternalMidiAdvanceMs(999)).toBe(250);
    expect(normalizeExternalMidiAdvanceMs(-999)).toBe(-250);
    expect(resolveExternalMidiDispatchAtSeconds(4, 35, true)).toBeCloseTo(3.965, 6);
    expect(resolveExternalMidiDispatchAtSeconds(4, 35, false)).toBe(4);
    expect(resolveExternalMidiDispatchAtSeconds(0.01, 35, true)).toBe(0);
  });

  it("targets unqueued GS MIDI from the live OPM/PCM song position without changing event tempo", () => {
    expect(resolveMdrMidiLiveTargetAtSeconds(50, 44.8, 45)).toBeCloseTo(50.2, 8);
    expect(resolveMdrMidiLiveTargetAtSeconds(50, 45.2, 45)).toBe(50);
  });

  it("wraps infinite hybrid MIDI on the measured MXDRV boundary rather than a trailing MIDI release", () => {
    expect(resolveMdrInfiniteMidiLoopPeriodSeconds(78.25, 82.151, true)).toBeCloseTo(78.25, 8);
    expect(resolveMdrInfiniteMidiLoopPeriodSeconds(0, 82.151, false)).toBeCloseTo(82.151, 8);
    expect(selectMdrInfiniteMidiLoopEvents([{ at: 0, sourceTrack: 0, bytes: [0x90, 60, 96] }, { at: 44.018, sourceTrack: 1, bytes: [0x80, 60, 0] }, { at: 82.151, sourceTrack: 2, bytes: [0x80, 61, 0] }], 44.018)).toEqual([{ at: 0, sourceTrack: 0, bytes: [0x90, 60, 96] }]);
  });

  it("restarts an intro-plus-loop MIDI timeline from its converted L-derived window", () => {
    const loopWindow = { startSeconds: 40.109625, endSeconds: 80.105625 };
    const events = [{ at: 0, sourceTrack: 0, bytes: [0xc0, 0] }, { at: 40.109625, sourceTrack: 1, bytes: [0x90, 60, 96] }, { at: 79.5, sourceTrack: 1, bytes: [0x80, 60, 0] }, { at: 82.151, sourceTrack: 2, bytes: [0x80, 61, 0] }];
    expect(selectMdrMidiLoopWindowEvents(events, loopWindow)).toEqual(events.slice(0, 3));
    expect(resolveMdrMidiLoopDispatchAtSeconds(0, 0, loopWindow)).toBe(0);
    expect(resolveMdrMidiLoopDispatchAtSeconds(0, 1, loopWindow)).toBeUndefined();
    expect(resolveMdrMidiLoopDispatchAtSeconds(40.109625, 1, loopWindow)).toBeCloseTo(80.105625, 6);
    expect(resolveMdrMidiLoopDispatchAtSeconds(79.5, 2, loopWindow)).toBeCloseTo(159.492, 6);
  });

  it("keeps a converter L window only when it matches MXDRV's expandable loop cycle", () => {
    expect(resolveMdrHardwareLoopCycleSeconds(44.018, 84.028)).toBeCloseTo(40.01, 5);
    expect(resolveMdrHardwareLoopCycleSeconds(142.782, 142.782)).toBeUndefined();
    const bombWindow = { startSeconds: 40.109625, endSeconds: 80.105625 };
    expect(resolveTrustedMdrMidiLoopWindow(bombWindow, 44.018, 40.01)).toEqual(bombWindow);
    // G2M_TTL_SC.MDR: converter reports a ~5s MIDI L while hardware plays ~143s once.
    const g2mWindow = { startSeconds: 31.01475, endSeconds: 36.22275 };
    expect(resolveTrustedMdrMidiLoopWindow(g2mWindow, 142.782, undefined)).toBeUndefined();
    expect(resolveTrustedMdrMidiLoopWindow(g2mWindow, 142.782, 5.208)).toEqual(g2mWindow);
  });

  it("retains L windows for multi-cycle hardware patterns and saturated duration probes", () => {
    const prinWindow = { startSeconds: 55.95, endSeconds: 111.642 };
    expect(resolveTrustedMdrMidiLoopWindow(prinWindow, 21.018, 18.579)).toEqual(prinWindow);
    const rumiWindow = { startSeconds: 41.118, endSeconds: 80.418 };
    expect(resolveTrustedMdrMidiLoopWindow(rumiWindow, 1200.015, undefined)).toEqual(rumiWindow);
    expect(resolveTrustedMdrMidiLoopWindow({ startSeconds: 0, endSeconds: 30 }, 20, 20)).toBeUndefined();
  });

  it("resets the next infinite MIDI pass when the SoundFont lookahead reaches the loop boundary", () => {
    expect(resolveMdrInfiniteMidiCycle(43.867, 44.018, 0.15)).toBe(0);
    expect(resolveMdrInfiniteMidiCycle(43.868, 44.018, 0.15)).toBe(1);
    expect(resolveMdrInfiniteMidiCycle(44.018, 44.018, 0)).toBe(1);
    expect(shouldScheduleMdrMidiDirectlyAtLoopStart(true, 1, 0, 0.15)).toBe(true);
    expect(shouldScheduleMdrMidiDirectlyAtLoopStart(true, 1, 0.113625, 0.15)).toBe(true);
    expect(shouldScheduleMdrMidiDirectlyAtLoopStart(true, 1, 0.151, 0.15)).toBe(false);
    expect(shouldScheduleMdrMidiDirectlyAtLoopStart(false, 1, 0, 0.15)).toBe(false);
    expect(shouldStopGsSynthImmediatelyForMdrReset(true, 10.15, 10)).toBe(false);
    expect(shouldStopGsSynthImmediatelyForMdrReset(true, 10, 10)).toBe(true);
    expect(shouldStopGsSynthImmediatelyForMdrReset(false, undefined, 10)).toBe(false);
    const gsReset = [0xf0, 0x41, 0x10, 0x42, 0x12, 0x40, 0x00, 0x7f, 0x00, 0x41, 0xf7];
    expect(shouldSkipMdrMidiEventAtLoopCycle(gsReset, 0)).toBe(false);
    expect(shouldSkipMdrMidiEventAtLoopCycle(gsReset, 1)).toBe(true);
    expect(shouldSkipMdrMidiEventAtLoopCycle([0x90, 60, 100], 1)).toBe(false);
  });
});

describe("SoundFont MDR timing correction", () => {
  it("keeps valid signed-integer drafts while a timing correction is being typed", () => {
    expect(isSignedTimingCorrectionDraft("")).toBe(true);
    expect(isSignedTimingCorrectionDraft("-")).toBe(true);
    expect(isSignedTimingCorrectionDraft("-17")).toBe(true);
    expect(isSignedTimingCorrectionDraft("28")).toBe(true);
    expect(isSignedTimingCorrectionDraft("--17")).toBe(false);
    expect(isSignedTimingCorrectionDraft("1.5")).toBe(false);
  });

  it("bounds a local SoundFont delay and postpones only the scheduled internal MIDI edge", () => {
    expect(normalizeSoundFontMdrDelayMs(12.6)).toBe(13);
    expect(normalizeSoundFontMdrDelayMs(999)).toBe(500);
    expect(normalizeSoundFontMdrDelayMs(-999)).toBe(-500);
    expect(stepSoundFontMdrDelayMs(-2, 1)).toBe(-1);
    expect(stepSoundFontMdrDelayMs(500, 1)).toBe(500);
    expect(stepSoundFontMdrDelayMs(-500, -1)).toBe(-500);
    expect(resolveSoundFontMdrScheduleAtSeconds(4, 18)).toBeCloseTo(4.018, 6);
    expect(resolveSoundFontMdrScheduleAtSeconds(4, -18)).toBeCloseTo(3.982, 6);
    expect(resolveSoundFontMdrDispatchAtSeconds(4, 18)).toBeCloseTo(4.018, 6);
    expect(resolveSoundFontMdrDispatchAtSeconds(0.01, -18)).toBe(0);
  });

  it("ends hybrid MDR after MXDRV termination and trailing GS MIDI completion", () => {
    expect(shouldEndFiniteMdrPlayback(true, false, true)).toBe(false);
    expect(shouldEndFiniteMdrPlayback(true, true, false)).toBe(false);
    expect(shouldEndFiniteMdrPlayback(true, true, true)).toBe(true);
    expect(shouldEndFiniteMdrPlayback(false, false, false)).toBe(false);
    expect(shouldEndFiniteMdrPlayback(false, true, true)).toBe(true);
  });

  it("keeps a generous wall-clock failsafe for hybrid MDR playback", () => {
    expect(resolveMdrPlaybackFailsafeSeconds(180)).toBeCloseTo(255, 5);
    expect(resolveMdrPlaybackFailsafeSeconds(0)).toBe(60);
  });

  it("recommends a browser-local SoundFont delay from the active audio path", () => {
    const desktop = recommendSoundFontMdrDelayMs({ profile: "desktop", sampleRate: 48_000, outputLatencySeconds: 0.04, baseLatencySeconds: 0.01 });
    expect(desktop.rendererMs).toBe(43);
    expect(desktop.lookaheadMs).toBe(150);
    expect(desktop.totalMs).toBeLessThan(0);
    const mobile = recommendSoundFontMdrDelayMs({ profile: "mobile", sampleRate: 44_100, frameP95Ms: 40 });
    expect(mobile.rendererMs).toBeGreaterThan(300);
    expect(mobile.totalMs).toBeGreaterThan(0);
  });

  it("smooths live MXDRV sync residuals into a suggested total correction", () => {
    const snapshot = { scheduledSeconds: 12.4, dispatchedSeconds: 12.55, hardwareMilliseconds: 12_620 };
    expect(resolveSoundFontMdrSyncResidualMs(snapshot)).toBeCloseTo(150, 5);
    const first = updateSoundFontMdrDelayMeasurement(null, snapshot, 30);
    expect(first?.suggestedTotalMs).toBe(180);
    const second = updateSoundFontMdrDelayMeasurement(first, { ...snapshot, hardwareMilliseconds: 12_500 }, 30);
    expect(second?.sampleCount).toBe(2);
    expect(second?.suggestedTotalMs).toBe(180);
    expect(resolveSoundFontMdrSyncResidualMs({ ...snapshot, hardwareMilliseconds: null })).toBeNull();
  });

  it("keeps separate persisted corrections for each SoundFont and falls back to the historic common correction", () => {
    const profiles = normalizeSoundFontMdrDelayProfiles({ "local:OmegaGMGS2.sf2:279000000:1": 32.2, "remote:generaluser": -19.7, ignored: "not-a-number" });
    const updated = setSoundFontMdrDelayProfile(profiles, "remote:generaluser", 41.7);
    expect(resolveSoundFontMdrDelayProfile(updated, "local:OmegaGMGS2.sf2:279000000:1", 0)).toBe(32);
    expect(resolveSoundFontMdrDelayProfile(updated, "remote:generaluser", 0)).toBe(42);
    expect(resolveSoundFontMdrDelayProfile(updated, "local:another.sf2:1:2", -6)).toBe(-6);
  });

  it("lets A/B listening bypass the active delay without overwriting that profile value", () => {
    expect(resolveSoundFontMdrTimingComparisonDelay(28, "corrected")).toBe(28);
    expect(resolveSoundFontMdrTimingComparisonDelay(28, "uncompensated")).toBe(0);
    expect(resolveSoundFontMdrTimingComparisonDelay(-17, "corrected")).toBe(-17);
  });

  it("does not dispatch a queued SoundFont event after STOP invalidates its playback generation", () => {
    expect(shouldDispatchQueuedSoundFontMdrEvent(12, 12, true)).toBe(true);
    expect(shouldDispatchQueuedSoundFontMdrEvent(12, 13, true)).toBe(false);
    expect(shouldDispatchQueuedSoundFontMdrEvent(12, 12, false)).toBe(false);
  });
});

describe("shared SoundFont binary transport", () => {
  it("reports streamed CORS download progress from zero through every received chunk", async () => {
    const bytes = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x04, 0x00, 0x00, 0x00, 0x73, 0x66, 0x62, 0x6b]);
    const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(bytes.slice(0, 4)); controller.enqueue(bytes.slice(4)); controller.close(); } });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(stream, { status: 200, headers: { "content-length": "12" } })));
    const progress: Array<{ loadedBytes: number; totalBytes: number | null }> = [];
    try {
      const result = await fetchRemoteSoundFont("https://example.org/test.sf2", (update) => progress.push(update));
      expect(new Uint8Array(result.data)).toEqual(bytes);
      expect(progress).toEqual([{ loadedBytes: 0, totalBytes: 12 }, { loadedBytes: 4, totalBytes: 12 }, { loadedBytes: 12, totalBytes: 12 }]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("uses the CORS-enabled Google Drive download directly instead of routing a large bank through the deployment", async () => {
    const bytes = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x04, 0x00, 0x00, 0x00, 0x73, 0x66, 0x62, 0x6b]);
    const fetchMock = vi.fn().mockResolvedValue(new Response(bytes, { status: 200, headers: { "content-length": "12" } }));
    vi.stubGlobal("fetch", fetchMock);
    const progress: Array<{ loadedBytes: number; totalBytes: number | null }> = [];
    try {
      const result = await fetchSharedSoundFont("https://drive.google.com/file/d/shared-bank/view?resourcekey=0-example", (update) => progress.push(update));
      expect(fetchMock).toHaveBeenCalledWith("https://drive.usercontent.google.com/download?id=shared-bank&export=download&confirm=t", { mode: "cors" });
      expect(new Uint8Array(result.data)).toEqual(bytes);
      expect(result.resolvedUrl).toBe("https://drive.usercontent.google.com/download?id=shared-bank&export=download&confirm=t");
      expect(result.transport).toBe("direct");
      expect(progress).toEqual([{ loadedBytes: 0, totalBytes: 12 }, { loadedBytes: 12, totalBytes: 12 }]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("uses the same-origin binary stream only when the shared host blocks a direct CORS response", async () => {
    const bytes = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x04, 0x00, 0x00, 0x00, 0x73, 0x66, 0x62, 0x6b]);
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError("CORS blocked"))
      .mockResolvedValueOnce(new Response(bytes, { status: 206, headers: { "content-length": "12", "content-range": "bytes 0-11/12", "x-remote-asset-final-url": "https://drive.usercontent.google.com/download?id=shared-bank" } }));
    vi.stubGlobal("fetch", fetchMock);
    const progress: Array<{ loadedBytes: number; totalBytes: number | null }> = [];
    try {
      const result = await fetchSharedSoundFont("https://drive.google.com/file/d/shared-bank/view", (update) => progress.push(update));
      expect(fetchMock).toHaveBeenNthCalledWith(2, expect.stringContaining("/api/public-storage/soundfont?url="), { method: "GET", headers: { Range: "bytes=0-8388607" } });
      expect(result.transport).toBe("proxy");
      expect(progress).toEqual([{ loadedBytes: 0, totalBytes: 12 }, { loadedBytes: 12, totalBytes: 12 }]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("folder playlist transport", () => {
  it("advances only to a following entry and stops after the final song", () => {
    expect(resolveNextPlaylistIndex(0, 2)).toBe(1);
    expect(resolveNextPlaylistIndex(1, 2)).toBeNull();
    expect(resolveNextPlaylistIndex(0, 1)).toBeNull();
    expect(resolveNextPlaylistIndex(-1, 2)).toBeNull();
  });
});

describe("PCM/PDX engine activity", () => {
  it("arms only when a playing PDX source reports a PCM key-on mask", () => {
    expect(isPcmPdxEngineArmed(true, true, 0b00000001)).toBe(true);
    expect(isPcmPdxEngineArmed(true, true, 0)).toBe(false);
    expect(isPcmPdxEngineArmed(true, false, 0b00000001)).toBe(false);
    expect(isPcmPdxEngineArmed(false, true, 0b00000001)).toBe(false);
  });
});

describe("MDR renderer routing", () => {
  it("bypasses the OPM/PCM MDX renderer for a GS MIDI-only MDR", () => {
    expect(requiresMdrHardwareRenderer(0)).toBe(false);
    expect(requiresMdrHardwareRenderer(-1)).toBe(false);
    expect(requiresMdrHardwareRenderer(1)).toBe(true);
    expect(requiresMdrHardwareRenderer(6)).toBe(true);
  });
});

describe("AudioContext clock synchronization", () => {
  it("preserves a supported browser sample rate and falls back safely", () => {
    expect(resolvePlaybackSampleRate(44_100)).toBe(44_100);
    expect(resolvePlaybackSampleRate(48_000.4)).toBe(48_000);
    expect(resolvePlaybackSampleRate(0)).toBe(48_000);
    expect(resolvePlaybackSampleRate(Number.NaN)).toBe(48_000);
  });

  it("keeps MDR GS MIDI timing on the 48 kHz MXDRV core despite output resampling", () => {
    expect(resolveMdrMidiTimingSampleRate()).toBe(48_000);
  });

  it("queues SoundFont MIDI ahead of the main-thread deadline with a bounded pump cadence", () => {
    expect(resolveMdrMidiLookaheadSeconds("desktop")).toBe(0.15);
    expect(resolveMdrMidiLookaheadSeconds("mobile")).toBe(0.4);
    expect(resolveMdrMidiPumpIntervalMs("desktop")).toBe(20);
    expect(resolveMdrMidiPumpIntervalMs("mobile")).toBe(50);
  });

  it("aligns MIDI start with the ScriptProcessor block that carries audible OPM and PCM", () => {
    expect(resolveMdrRendererLatencySeconds("desktop", 48_000)).toBeCloseTo(2048 / 48_000, 8);
    expect(resolveMdrRendererLatencySeconds("mobile", 44_100)).toBeCloseTo(16384 / 44_100, 8);
    expect(resolveMdrPlaybackStartLatencySeconds("desktop", 48_000, 0.04, 0.01)).toBeCloseTo(0.025 + 2048 / 48_000 + 0.04, 8);
    expect(resolveMdrPlaybackStartLatencySeconds("mobile", 44_100, 0, 0)).toBeCloseTo(0.025 + 16384 / 44_100, 8);
  });
});

describe("mobile playback performance profile", () => {
  it("uses a larger audio buffer and bounded visual update cadence on phones", () => {
    expect(resolveScriptProcessorBufferSize("desktop")).toBe(2048);
    expect(resolveScriptProcessorBufferSize("mobile")).toBe(16384);
    expect(resolveProgressUpdateIntervalMs("desktop")).toBe(33);
    expect(resolveProgressUpdateIntervalMs("mobile")).toBe(200);
    expect(resolveRealtimeVisualUpdateIntervalMs("desktop")).toBe(33);
    expect(resolveRealtimeVisualUpdateIntervalMs("mobile")).toBe(250);
  });

  it("reserves extra main-thread headroom for long Safari MDR playback", () => {
    const safari = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15";
    expect(isSafariBrowserUserAgent(safari)).toBe(true);
    expect(isSafariBrowserUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X) AppleWebKit/537.36 Chrome/126.0 Safari/537.36")).toBe(false);
    expect(resolveProgressUpdateIntervalMs("mobile", true)).toBe(500);
    expect(resolveRealtimeVisualUpdateIntervalMs("mobile", true)).toBe(500);
    expect(resolveProgressUpdateIntervalMs("desktop", true)).toBe(33);
  });

  it("selects stable OPM/PCM callback headroom for large SoundFonts without changing normal banks", () => {
    expect(requiresStableMadrvProfileForSoundFont(30 * 1024 * 1024)).toBe(false);
    expect(requiresStableMadrvProfileForSoundFont(128 * 1024 * 1024)).toBe(true);
  });

});

describe("playback load advisor", () => {
  it("recommends stable playback for a constrained mobile device and a dense asset", () => {
    expect(recommendPlaybackTuning({ sourceBytes: 8 * 1024 * 1024, pcmBytes: 4 * 1024 * 1024, hardwareTracks: 16, midiTracks: 12, benchmarkMs: 38, frameP95Ms: 52, hardwareConcurrency: 2, deviceMemoryGb: 2, mobile: true })).toMatchObject({ preset: "stable" });
  });

  it("keeps a balanced recommendation for ordinary loads and low latency for a high-end desktop", () => {
    expect(recommendPlaybackTuning({ sourceBytes: 800_000, pcmBytes: 0, hardwareTracks: 8, midiTracks: 2, benchmarkMs: 15, frameP95Ms: 20, hardwareConcurrency: 4, deviceMemoryGb: 4, mobile: false })).toMatchObject({ preset: "standard" });
    expect(recommendPlaybackTuning({ sourceBytes: 200_000, pcmBytes: 0, hardwareTracks: 4, midiTracks: 0, benchmarkMs: 6, frameP95Ms: 12, hardwareConcurrency: 8, deviceMemoryGb: 16, mobile: false })).toMatchObject({ preset: "low-latency" });
  });

  it("gives a small, full hybrid score extra buffer headroom when using the built-in SoundFont", () => {
    const probe = { sourceBytes: 7400, pcmBytes: 37000, hardwareTracks: 15, midiTracks: 15, benchmarkMs: 1, frameP95Ms: 16.7, hardwareConcurrency: 8, deviceMemoryGb: 16, mobile: false };
    expect(recommendPlaybackTuning({ ...probe, soundFont: true })).toMatchObject({ preset: "stable" });
    expect(recommendPlaybackTuning({ ...probe, soundFont: false })).toMatchObject({ preset: "standard" });
    expect(recommendPlaybackTuning({ ...probe, hardwareTracks: 8, midiTracks: 2, soundFont: true })).toMatchObject({ preset: "low-latency" });
  });
});

describe("MDR playback duration", () => {
  it("retains scheduled GS MIDI events after a shorter OPM measurement", () => {
    expect(resolveMdrPlaybackDuration(1.8, [{ at: 311.23875, sourceTrack: 16, bytes: [0x80, 60, 0] }])).toBeCloseTo(312.73875, 5);
    expect(resolveMdrPlaybackDuration(12, [])).toBe(12);
  });

  it("uses a converted MIDI loop as the finite boundary when MXDRV duration saturates", () => {
    const loopWindow = { startSeconds: 41.118, endSeconds: 80.418 };
    const midiEvents = [{ at: 80.418, sourceTrack: 1, bytes: [0x80, 60, 0] }];
    expect(resolveMdrPlaybackDuration(1200, midiEvents, loopWindow)).toBeCloseTo(81.918, 5);
    expect(resolveMdrPlaybackDuration(1200, midiEvents)).toBe(1200);
  });

});

describe("playback tempo diagnostics", () => {
  it("reads an initial MML tempo while ignoring comments and falls back to 120", () => {
    expect(extractMmlInitialTempo("; T200\nT132 O4 cdef")).toBe(132);
    expect(extractMmlInitialTempo("o4 l8 cdef")).toBe(120);
  });

  it("converts valid OPM Timer-B values into a BPM equivalent", () => {
    expect(timerBToEstimatedBpm(0xc8)).toBeCloseTo(87.19, 2);
    expect(timerBToEstimatedBpm(0xff)).toBeCloseTo(4882.81, 2);
    expect(timerBToEstimatedBpm(-1)).toBeNull();
  });

  it("reads MDR $FF tempo for GS MIDI-only display without mistaking E0 FF", () => {
    const title = new TextEncoder().encode("Tempo Probe\r\n\x1aNONE\0");
    const table = new Uint8Array(66);
    const tracks: number[] = [];
    let offset = 66;
    for (let index = 0; index < 32; index += 1) {
      table[2 + index * 2] = offset >> 8;
      table[3 + index * 2] = offset & 0xff;
      // Track 0 signature only; track 16 sets MIDI channel then $FF $C3 (≈80 BPM).
      const track = index === 0
        ? [0xe0, 0xff, 0xf1, 0x00]
        : index === 16
          ? [0xe0, 0x08, 0x80, 0x0b, 0xff, 0xc3, 0x80, 0x03, 0xf1, 0x00]
          : [0xf1, 0x00];
      tracks.push(...track);
      offset += track.length;
    }
    table[0] = offset >> 8;
    table[1] = offset & 0xff;
    const bytes = new Uint8Array(title.length + table.length + tracks.length);
    bytes.set(title, 0);
    bytes.set(table, title.length);
    bytes.set(tracks, title.length + table.length);
    expect(extractMdrTempoTimerB(bytes.buffer)).toBe(0xc3);
    expect(timerBToEstimatedBpm(0xc3)!).toBeCloseTo(80.05, 2);
    expect(resolveMdrDisplayTempoTimerB(bytes.buffer)).toBe(0xc3);
  });

  it("falls back to MADRV's default Timer-B when MDR has no $FF tempo", () => {
    expect(extractMdrTempoTimerB(makeDiagnosticMdr())).toBeNull();
    expect(resolveMdrDisplayTempoTimerB(makeDiagnosticMdr())).toBe(MADRV_DEFAULT_TEMPO_TIMER_B);
  });

  it("extracts the G2M title MDR $FF tempo used by MIDI-only BPM display", () => {
    const path = resolve(process.cwd(), "../.tmp-mdr/G2M_TTL_SC.MDR");
    let buffer: ArrayBuffer;
    try {
      const file = readFileSync(path);
      buffer = file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength);
    } catch {
      return;
    }
    expect(extractMdrTempoTimerB(buffer)).toBe(0xc3);
    expect(timerBToEstimatedBpm(0xc3)!).toBeCloseTo(80.05, 2);
  });
});

describe("MDX output sample-clock conversion", () => {
  it("preserves a 440 Hz source pitch when native 48 kHz PCM is rendered at 44.1 kHz", () => {
    const nativeRate = 48_000;
    const outputRate = 44_100;
    const source = Float32Array.from({ length: nativeRate }, (_, index) => Math.sin((2 * Math.PI * 440 * index) / nativeRate));
    const output = new Float32Array(outputRate);
    const { phase, peak } = resamplePcmFrames(output, new Float32Array(outputRate), source, source, 0, nativeRate, outputRate);
    const positiveCrossings = output.reduce((count, value, index) => count + (index > 0 && output[index - 1] <= 0 && value > 0 ? 1 : 0), 0);
    expect(positiveCrossings).toBeGreaterThanOrEqual(439);
    expect(positiveCrossings).toBeLessThanOrEqual(441);
    expect(phase).toBeCloseTo(0, 4);
    expect(peak).toBeGreaterThan(32_000);
  });
});

describe("MDR track keyboard state", () => {
  it("converts MXDRV's shifted note value into a chromatic key and MIDI note", () => {
    // raw 3203 → MDX note 50 (o4f) → MIDI 53 (F3); MDX index 0 is o0d♯ (+3)
    expect(mxdrvRawNoteToPitchClass(3203)).toBe(5);
    expect(mxdrvRawNoteToMidiNote(3203)).toBe(53);
    expect(mxdrvRawNoteToPitchClass(389)).toBe(9);
    expect(mxdrvRawNoteToMidiNote(389)).toBe(9);
    expect(mxdrvRawNoteToMidiNote(45 * 64 + 5)).toBe(48); // o4c → C3
    expect(formatMidiNoteName(mxdrvRawNoteToMidiNote(45 * 64 + 5)!)).toBe("C3");
    expect(mxdrvRawNoteToPitchClass(-1)).toBeNull();
    expect(mxdrvRawNoteToMidiNote(-1)).toBeNull();
  });

  it("keeps MIDI track keys lit until their individual note-off arrives", () => {
    const c = updateMidiTrackNotes([], [0x90, 60, 96]);
    const cAndE = updateMidiTrackNotes(c, [0x90, 64, 96]);
    expect(cAndE).toEqual([60, 64]);
    expect(updateMidiTrackNotes(cAndE, [0x80, 60, 0])).toEqual([64]);
    expect(updateMidiTrackNotes([64], [0x90, 64, 0])).toEqual([]);
  });

  it("formats MIDI notes with octave labels", () => {
    expect(formatMidiNoteName(60)).toBe("C4");
    expect(formatMidiNoteName(61)).toBe("C#4");
    expect(formatMidiNoteName(12)).toBe("C0");
  });
});
