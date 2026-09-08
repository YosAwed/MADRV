import { OrderedMidiQueue } from "./orderedMidiQueue";
import { MdrAudioTimeline } from "./mdrAudioTimeline";

/* Signal Deck engine: MML is synthesized locally; MDR inspection follows the mpxadrv header and 32-track layout. */
export type EngineKind = "opm" | "pcm" | "midi";
export type PlaybackPerformanceProfile = "desktop" | "mobile";
export type PlaybackTuningPreset = "low-latency" | "standard" | "stable";

/** Safari is identified separately because its main-thread ScriptProcessor callbacks need extra room on long MDR playback. */
export function isSafariBrowserUserAgent(userAgent: string): boolean {
  return /Safari/i.test(userAgent) && !/(Chrome|Chromium|CriOS|FxiOS|EdgiOS|OPiOS|Android)/i.test(userAgent);
}

export type PlaybackLoadProbe = {
  sourceBytes: number;
  pcmBytes: number;
  hardwareTracks: number;
  midiTracks: number;
  benchmarkMs: number;
  frameP95Ms: number;
  hardwareConcurrency?: number;
  deviceMemoryGb?: number;
  mobile: boolean;
  soundFont?: boolean;
};

export type PlaybackTuningRecommendation = {
  preset: PlaybackTuningPreset;
  score: number;
  reason: string;
};

/** Dense hybrid scores need headroom even when their compressed source is tiny. */
export function requiresStableMadrvProfileForHybridTracks(hardwareTracks: number, midiTracks: number, soundFont: boolean): boolean {
  return soundFont && hardwareTracks >= 8 && midiTracks >= 8 && hardwareTracks + midiTracks >= 24;
}

/** Chooses a safe audio-buffer profile from a quick browser-local load probe. */
export function recommendPlaybackTuning(probe: PlaybackLoadProbe): PlaybackTuningRecommendation {
  const assetMiB = Math.max(0, probe.sourceBytes + probe.pcmBytes) / (1024 * 1024);
  const benchmarkPenalty = Math.max(0, probe.benchmarkMs - 12) * 1.4;
  const framePenalty = Math.max(0, probe.frameP95Ms - 20) * 1.1;
  const corePenalty = probe.hardwareConcurrency !== undefined && probe.hardwareConcurrency <= 2 ? 22 : probe.hardwareConcurrency !== undefined && probe.hardwareConcurrency <= 4 ? 8 : 0;
  const memoryPenalty = probe.deviceMemoryGb !== undefined && probe.deviceMemoryGb <= 2 ? 18 : probe.deviceMemoryGb !== undefined && probe.deviceMemoryGb <= 4 ? 6 : 0;
  // A small MDR can still run almost every OPM/PCM and SoundFont part. The
  // byte-scan probe does not measure that sustained synthesis + UI workload.
  const denseHybrid = requiresStableMadrvProfileForHybridTracks(probe.hardwareTracks, probe.midiTracks, probe.soundFont === true);
  const score = Math.round(Math.min(100, Math.max(denseHybrid ? 58 : 0, assetMiB * 1.5 + probe.hardwareTracks * 1.7 + probe.midiTracks * 0.9 + (probe.mobile ? 14 : 0) + benchmarkPenalty + framePenalty + corePenalty + memoryPenalty)));
  if (denseHybrid) {
    return { preset: "stable", score, reason: "OPM／PCMと内蔵SoundFontの多数トラックを同時再生するため、安定優先を推奨します。操作への応答は遅くなりますが、音声バッファの余裕を増やします。" };
  }
  if (score >= 58 || probe.benchmarkMs >= 34 || probe.frameP95Ms >= 45) {
    return { preset: "stable", score, reason: "端末余力または楽曲負荷が高いため、大きい音声バッファと更新間引きを推奨します。" };
  }
  if (!probe.mobile && score <= 18 && probe.benchmarkMs <= 10 && probe.frameP95Ms <= 18 && (probe.hardwareConcurrency ?? 4) >= 8) {
    return { preset: "low-latency", score, reason: "端末余力に余裕があります。低遅延設定で操作応答を優先できます。" };
  }
  return { preset: "standard", score, reason: "標準設定で安定再生が見込めます。再生中に途切れを感じた場合は安定優先へ切り替えてください。" };
}

/** MXDRV/X68Sound's browser core is calibrated at 48 kHz; the browser resamples this context to device output when needed. */
const MADRV_NATIVE_SAMPLE_RATE = 48_000;
const MDR_MIDI_RELEASE_SECONDS = 1.5;

export type MmlEvent = {
  engine: EngineKind;
  start: number;
  duration: number;
  midi: number;
  velocity: number;
};

export type CompiledMml = {
  events: MmlEvent[];
  duration: number;
  engines: EngineKind[];
};

export type ExportResult = {
  blob: Blob;
  extension: "mp4" | "webm";
  mimeType: string;
};

export type MdrInfo = {
  title: string;
  pdxName: string;
  activeTracks: number;
  hardwareTracks: number;
  midiTracks: number;
  hasExtendedPcm: boolean;
  byteLength: number;
};

export type MidiOutputDevice = {
  id: string;
  name: string;
};

export type MdrPlaybackInfo = {
  duration: number;
  format: "MDR / OPM + PDX" | "MDR / GS MIDI" | "MDX / OPM + PDX";
};

export type MdxInfo = {
  title: string;
  pdxName: string;
};

/** MXDRV_GetPCM returns 0 after successfully filling the output buffer; negative values are errors. */
export function isWasmPcmRenderFailure(result: number): boolean {
  return result < 0;
}

/** Normalizes playback time into a bounded percentage for the visual transport display. */
export function playbackProgressPercent(elapsed: number, duration: number): number {
  if (!Number.isFinite(elapsed) || !Number.isFinite(duration) || duration <= 0) return 0;
  return Math.min(100, Math.max(0, (elapsed / duration) * 100));
}

/** Uses the live MXDRV termination flag as the authority for MDX completion. */
export function resolveMdxPlaybackTick(elapsed: number, duration: number, loopCount: number, terminated: boolean): { elapsed: number; ended: boolean } {
  const safeElapsed = Number.isFinite(elapsed) ? Math.max(0, elapsed) : 0;
  const safeDuration = Number.isFinite(duration) ? Math.max(0, duration) : 0;
  if (terminated) return { elapsed: safeDuration, ended: true };
  if (safeDuration > 0 && loopCount !== 1) return { elapsed: safeElapsed % safeDuration, ended: false };
  return { elapsed: Math.min(safeDuration, safeElapsed), ended: false };
}

/** Returns the following entry after a finite playlist song completes, or null at the final entry. */
export function resolveNextPlaylistIndex(currentIndex: number, entryCount: number): number | null {
  if (!Number.isInteger(currentIndex) || !Number.isInteger(entryCount) || currentIndex < 0 || entryCount <= 0) return null;
  const next = currentIndex + 1;
  return next < entryCount ? next : null;
}

/** Pads short playlist entries with silence so consecutive tracks remain distinguishable. */
export function resolvePlaylistInterTrackSilenceSeconds(
  singleLoopDurationSeconds: number,
  loopCount: number,
  shortTrackThresholdSeconds = 10,
): number {
  if (!Number.isFinite(singleLoopDurationSeconds) || singleLoopDurationSeconds < 0) return 0;
  if (!Number.isFinite(loopCount) || loopCount <= 0) return 0;
  if (!Number.isFinite(shortTrackThresholdSeconds) || shortTrackThresholdSeconds < 0) return 0;
  const totalDuration = singleLoopDurationSeconds * Math.max(1, Math.floor(loopCount));
  return totalDuration <= shortTrackThresholdSeconds
    ? Math.max(0, shortTrackThresholdSeconds + 1 - totalDuration)
    : 0;
}

/** Prevents callbacks scheduled by a prior source from moving the active transport. */
export function isCurrentPlaybackGeneration(callbackGeneration: number, activeGeneration: number): boolean {
  return Number.isInteger(callbackGeneration) && Number.isInteger(activeGeneration) && callbackGeneration === activeGeneration;
}

function asPlaybackError(error: unknown, fallback: string): Error {
  if (error instanceof Error) return error;
  if (typeof error === "string" && error.trim()) return new Error(error);
  return new Error(fallback);
}

function throwIfPlaybackSuperseded(callbackGeneration: number, activeGeneration: number): void {
  if (!isCurrentPlaybackGeneration(callbackGeneration, activeGeneration)) {
    throw new Error("Playback was superseded by a newer source.");
  }
}

/** Keeps the WebAssembly renderer at the same clock rate as the browser AudioContext. */
export function resolvePlaybackSampleRate(sampleRate: number): number {
  return Number.isFinite(sampleRate) && sampleRate >= 8_000 && sampleRate <= 192_000 ? Math.round(sampleRate) : 48_000;
}

/**
 * Virtual clock used only by the offline MIDI extractor, not an audio rate.
 * A YM2151 Timer-B tick is (256 - register) * 256 microseconds. At 125 kHz
 * every possible tick is an integer number of frames; 48 kHz truncates a
 * fractional frame on every tick and gradually accelerates the MIDI score.
 */
export function resolveMdrMidiTimingSampleRate(): number {
  return 125_000;
}

/** Positive values send hardware MIDI earlier; negative values intentionally defer it. */
export function normalizeExternalMidiAdvanceMs(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(-250, Math.min(250, Math.round(value)));
}

/** Maximum user-facing SoundFont delay when OPM/PCM audibly leads GS MIDI on a device. */
export const MADRV_SOUND_FONT_MDR_DELAY_MS_LIMIT = 500;

/** Positive values postpone the browser SoundFont without affecting OPM, PCM, or external MIDI. */
export function normalizeSoundFontMdrDelayMs(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(-MADRV_SOUND_FONT_MDR_DELAY_MS_LIMIT, Math.min(MADRV_SOUND_FONT_MDR_DELAY_MS_LIMIT, Math.round(value)));
}

/** Applies one mouse-button step while preserving the SoundFont correction range. */
export function stepSoundFontMdrDelayMs(value: number, delta: number): number {
  return normalizeSoundFontMdrDelayMs(normalizeSoundFontMdrDelayMs(value) + (Number.isFinite(delta) ? delta : 0));
}

/** Allows a controlled text input to retain an empty value or a lone minus while the user types a signed correction. */
export function isSignedTimingCorrectionDraft(value: string): boolean {
  return /^-?\d*$/.test(value);
}

export type SoundFontMdrDelayProfiles = Record<string, number>;

/** Restores only bounded, URL-safe-ish browser-local profile entries from persisted JSON. */
export function normalizeSoundFontMdrDelayProfiles(value: unknown): SoundFontMdrDelayProfiles {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const profiles: SoundFontMdrDelayProfiles = {};
  for (const [key, delayMs] of Object.entries(value)) {
    if (!key.trim() || key.length > 1024 || typeof delayMs !== "number" || !Number.isFinite(delayMs)) continue;
    if (Object.keys(profiles).length >= 48) break;
    profiles[key] = normalizeSoundFontMdrDelayMs(delayMs);
  }
  return profiles;
}

/** Uses a bank-specific correction when available, otherwise preserves the historic browser-wide value. */
export function resolveSoundFontMdrDelayProfile(profiles: SoundFontMdrDelayProfiles, profileKey: string, fallbackDelayMs = 0): number {
  return profileKey && Object.prototype.hasOwnProperty.call(profiles, profileKey)
    ? normalizeSoundFontMdrDelayMs(profiles[profileKey] ?? 0)
    : normalizeSoundFontMdrDelayMs(fallbackDelayMs);
}

export function setSoundFontMdrDelayProfile(profiles: SoundFontMdrDelayProfiles, profileKey: string, delayMs: number): SoundFontMdrDelayProfiles {
  if (!profileKey.trim() || profileKey.length > 1024) return normalizeSoundFontMdrDelayProfiles(profiles);
  return { ...normalizeSoundFontMdrDelayProfiles(profiles), [profileKey]: normalizeSoundFontMdrDelayMs(delayMs) };
}

export type SoundFontMdrTimingComparisonMode = "corrected" | "uncompensated";

/** A/B preview never writes the profile: B merely bypasses its delay for subsequently queued MIDI events. */
export function resolveSoundFontMdrTimingComparisonDelay(delayMs: number, mode: SoundFontMdrTimingComparisonMode): number {
  return mode === "uncompensated" ? 0 : normalizeSoundFontMdrDelayMs(delayMs);
}

export function resolveSoundFontMdrScheduleAtSeconds(scheduleAt: number, delayMs: number): number {
  return scheduleAt + normalizeSoundFontMdrDelayMs(delayMs) / 1000;
}

/** Applies SoundFont MDR correction on the MXDRV song timeline so tempo changes do not skew the offset. */
export function resolveSoundFontMdrDispatchAtSeconds(eventAtSeconds: number, delayMs: number): number {
  if (!Number.isFinite(eventAtSeconds)) return 0;
  return Math.max(0, eventAtSeconds + normalizeSoundFontMdrDelayMs(delayMs) / 1000);
}

export type SoundFontMdrDelayRecommendation = {
  totalMs: number;
  rendererMs: number;
  outputMs: number;
  lookaheadMs: number;
  synthMs: number;
  reason: string;
};

/** Estimates a browser-local SoundFont MDR correction from the active audio path and playback profile. */
export function recommendSoundFontMdrDelayMs(input: {
  profile: PlaybackPerformanceProfile;
  sampleRate: number;
  outputLatencySeconds?: number;
  baseLatencySeconds?: number;
  frameP95Ms?: number;
}): SoundFontMdrDelayRecommendation {
  const rendererMs = resolveMdrRendererLatencySeconds(input.profile, input.sampleRate) * 1000;
  const outputMs = Math.max(0, (input.outputLatencySeconds ?? 0) * 1000);
  const baseMs = Math.max(0, (input.baseLatencySeconds ?? 0) * 1000);
  const lookaheadMs = resolveMdrMidiLookaheadSeconds(input.profile) * 1000;
  const synthMs = input.profile === "mobile" ? 35 : 20;
  // Both engines now target the same rendered output frames. Buffer duration,
  // output latency and lookahead are shared scheduling costs, not audible skew.
  const totalMs = 0;
  return {
    totalMs,
    rendererMs: Math.round(rendererMs),
    outputMs: Math.round(outputMs + baseMs),
    lookaheadMs: Math.round(lookaheadMs),
    synthMs,
    reason: "OPM／PCMと同じ出力フレームへ予約するため、基準値は0 msです。音色固有のアタック差はA/B試聴で調整してください。",
  };
}

/** Legacy MXDRV clock residual, or Worklet application lateness (not acoustic skew). */
export function resolveSoundFontMdrSyncResidualMs(snapshot: MdrMidiSyncSnapshot | null | undefined): number | null {
  if (snapshot?.kind === "worklet-dispatch") return Number.isFinite(snapshot.dispatchedSeconds) && Number.isFinite(snapshot.scheduledSeconds)
    ? Math.max(0, snapshot.dispatchedSeconds - snapshot.scheduledSeconds) * 1000 : null;
  if (!snapshot || snapshot.hardwareMilliseconds === null || !Number.isFinite(snapshot.dispatchedSeconds) || !Number.isFinite(snapshot.scheduledSeconds)) return null;
  // `hardwareMilliseconds` is the raw core playhead and includes the initial
  // ScriptProcessor/output-buffer offset. `dispatchedSeconds` is the same
  // playhead after that offset has been removed in startMdrMidiTimeline().
  // Comparing the raw value to the corrected MIDI timeline reports a fixed
  // ~300 ms "drift" on dense songs such as MEGALITH and leads users to apply
  // an incorrect SoundFont delay.
  return (snapshot.dispatchedSeconds - snapshot.scheduledSeconds) * 1000;
}

export type SoundFontMdrDelayMeasurement = {
  residualMs: number;
  suggestedTotalMs: number;
  sampleCount: number;
};

/** Smooths live sync residuals into a suggested total correction while MDR hybrid playback is running. */
export function updateSoundFontMdrDelayMeasurement(
  previous: SoundFontMdrDelayMeasurement | null,
  snapshot: MdrMidiSyncSnapshot | null | undefined,
  currentCorrectionMs: number,
): SoundFontMdrDelayMeasurement | null {
  // Scheduler deadline misses are not an acoustic OPM-vs-SoundFont offset and
  // must never be turned into a recommendation to shift the musical timeline.
  if (snapshot?.kind === "worklet-dispatch") return null;
  const residualMs = resolveSoundFontMdrSyncResidualMs(snapshot);
  if (residualMs === null) return previous;
  const suggestedTotalMs = normalizeSoundFontMdrDelayMs(Math.round(residualMs + currentCorrectionMs));
  if (!previous) return { residualMs, suggestedTotalMs, sampleCount: 1 };
  const alpha = 0.18;
  const smoothedResidualMs = previous.residualMs * (1 - alpha) + residualMs * alpha;
  return {
    residualMs: smoothedResidualMs,
    suggestedTotalMs: normalizeSoundFontMdrDelayMs(Math.round(smoothedResidualMs + currentCorrectionMs)),
    sampleCount: previous.sampleCount + 1,
  };
}

/** Keeps the MIDI tail moving from the final MXDRV position, without jumping to wall-clock time. */
export class MdrPlaybackClock {
  private hardwareOffsetSeconds?: number;
  private tailAnchor?: { contextSeconds: number; songSeconds: number };

  constructor(private readonly alignHardwareStart = true) {}

  read(contextElapsedSeconds: number, hardwareMilliseconds: number | null, hardwareTerminated: boolean): number {
    const elapsed = Number.isFinite(contextElapsedSeconds) ? Math.max(0, contextElapsedSeconds) : 0;
    if (this.tailAnchor) return this.tailAnchor.songSeconds + Math.max(0, elapsed - this.tailAnchor.contextSeconds);
    const rawHardwareSeconds = hardwareMilliseconds !== null && Number.isFinite(hardwareMilliseconds)
      ? Math.max(0, hardwareMilliseconds / 1000)
      : null;
    if (rawHardwareSeconds !== null) this.hardwareOffsetSeconds ??= this.alignHardwareStart ? rawHardwareSeconds - elapsed : 0;
    const songSeconds = rawHardwareSeconds === null ? elapsed : Math.max(0, rawHardwareSeconds - this.hardwareOffsetSeconds!);
    if (hardwareTerminated) this.tailAnchor = { contextSeconds: elapsed, songSeconds };
    return songSeconds;
  }
}

/** Hybrid OPM/PCM playback ends after MXDRV termination and any trailing GS MIDI events. */
export function shouldEndFiniteMdrPlayback(needsHardwareRenderer: boolean, hardwareTerminated: boolean, midiTimelineComplete: boolean): boolean {
  if (needsHardwareRenderer) return hardwareTerminated && midiTimelineComplete;
  return midiTimelineComplete;
}

/** Wall-clock failsafe for hybrid playback when termination detection stalls under main-thread pressure. */
export function resolveMdrPlaybackFailsafeSeconds(totalPlaybackDuration: number): number {
  const safeDuration = Number.isFinite(totalPlaybackDuration) && totalPlaybackDuration > 0 ? totalPlaybackDuration : 0;
  return Math.max(safeDuration * 1.25 + 30, safeDuration + 10, 60);
}

/** A queued SoundFont event is valid only for its original playback generation and a loaded synth. */
export function shouldDispatchQueuedSoundFontMdrEvent(queuedGeneration: number, activeGeneration: number, soundFontLoaded: boolean): boolean {
  return soundFontLoaded && isCurrentPlaybackGeneration(queuedGeneration, activeGeneration);
}

/** MIDI-bearing sources must not start until browser synthesis or hardware output is ready. */
export function isMidiPlaybackDestinationReady(soundFontLoaded: boolean, hardwareOutputSelected: boolean): boolean {
  return soundFontLoaded || hardwareOutputSelected;
}

/** SoundFont playback remains on the audio timeline; only hardware output receives this offset. */
export function resolveExternalMidiDispatchAtSeconds(eventAtSeconds: number, advanceMs: number, hasExternalMidiOutput: boolean): number {
  if (!Number.isFinite(eventAtSeconds)) return 0;
  const offsetSeconds = hasExternalMidiOutput ? normalizeExternalMidiAdvanceMs(advanceMs) / 1000 : 0;
  return Math.max(0, eventAtSeconds - offsetSeconds);
}

/** Places an unqueued MIDI event on the current audio clock from the live OPM/PCM song position. */
export function resolveMdrMidiLiveTargetAtSeconds(audioNowSeconds: number, hardwareElapsedSeconds: number, eventAtSeconds: number): number {
  const now = Number.isFinite(audioNowSeconds) ? audioNowSeconds : 0;
  const hardwareElapsed = Number.isFinite(hardwareElapsedSeconds) ? Math.max(0, hardwareElapsedSeconds) : 0;
  const eventAt = Number.isFinite(eventAtSeconds) ? Math.max(0, eventAtSeconds) : 0;
  return now + Math.max(0, eventAt - hardwareElapsed);
}

/** Resamples native PCM frames onto the AudioContext clock while preserving elapsed time and pitch. */
export function resamplePcmFrames(targetLeft: Float32Array, targetRight: Float32Array, sourceLeft: Float32Array, sourceRight: Float32Array, initialPhase: number, nativeSampleRate = MADRV_NATIVE_SAMPLE_RATE, outputSampleRate = MADRV_NATIVE_SAMPLE_RATE): { phase: number; peak: number } {
  const frames = Math.min(targetLeft.length, targetRight.length);
  const sourceFrames = Math.min(sourceLeft.length, sourceRight.length);
  if (frames === 0 || sourceFrames === 0) return { phase: initialPhase, peak: 0 };
  const ratio = nativeSampleRate / outputSampleRate;
  let phase = initialPhase;
  let peak = 0;
  for (let index = 0; index < frames; index += 1) {
    const sourceIndex = Math.min(sourceFrames - 1, Math.floor(phase));
    const nextIndex = Math.min(sourceFrames - 1, sourceIndex + 1);
    const fraction = phase - sourceIndex;
    const leftSample = (sourceLeft[sourceIndex] ?? 0) + ((sourceLeft[nextIndex] ?? 0) - (sourceLeft[sourceIndex] ?? 0)) * fraction;
    const rightSample = (sourceRight[sourceIndex] ?? 0) + ((sourceRight[nextIndex] ?? 0) - (sourceRight[sourceIndex] ?? 0)) * fraction;
    targetLeft[index] = leftSample;
    targetRight[index] = rightSample;
    peak = Math.max(peak, Math.abs(leftSample * 32768), Math.abs(rightSample * 32768));
    phase += ratio;
  }
  return { phase: phase - sourceFrames, peak };
}

/** Uses a larger ScriptProcessor buffer on phones to reduce main-thread audio callback pressure. */
export function resolveScriptProcessorBufferSize(profile: PlaybackPerformanceProfile): 2048 | 16384 {
  return profile === "mobile" ? 16384 : 2048;
}

/** Large banks raise AudioWorklet and main-thread pressure; retain extra OPM/PCM callback headroom by default. */
export function requiresStableMadrvProfileForSoundFont(byteLength: number): boolean {
  return Number.isFinite(byteLength) && byteLength >= 128 * 1024 * 1024;
}

/** ScriptProcessor fills a full block ahead of the audible OPM/PCM output. */
export function resolveMdrRendererLatencySeconds(profile: PlaybackPerformanceProfile, sampleRate: number): number {
  const safeSampleRate = resolvePlaybackSampleRate(sampleRate);
  return resolveScriptProcessorBufferSize(profile) / safeSampleRate;
}

/** Audible OPM/PCM starts after the render buffer plus the device output path. */
export function resolveMdrPlaybackStartLatencySeconds(
  profile: PlaybackPerformanceProfile,
  sampleRate: number,
  outputLatencySeconds = 0,
  baseLatencySeconds = 0,
): number {
  const safeOutputLatency = Number.isFinite(outputLatencySeconds) && outputLatencySeconds > 0 ? outputLatencySeconds : 0;
  const safeBaseLatency = Number.isFinite(baseLatencySeconds) && baseLatencySeconds > 0 ? baseLatencySeconds : 0;
  return Math.max(0.025, safeBaseLatency) + resolveMdrRendererLatencySeconds(profile, sampleRate) + safeOutputLatency;
}

/** Caps React transport updates while keeping the marker responsive on constrained mobile CPUs. */
export function resolveProgressUpdateIntervalMs(profile: PlaybackPerformanceProfile, safariCompatibilityMode = false): number {
  if (safariCompatibilityMode && profile === "mobile") return 500;
  return profile === "mobile" ? 200 : 33;
}

/** Caps non-audio visual telemetry such as peak, PCM, and key-on indicators. */
export function resolveRealtimeVisualUpdateIntervalMs(profile: PlaybackPerformanceProfile, safariCompatibilityMode = false): number {
  if (safariCompatibilityMode && profile === "mobile") return 500;
  return profile === "mobile" ? 250 : 33;
}

/** Queues GS MIDI in the AudioWorklet before the main thread reaches its deadline. */
export function resolveMdrMidiLookaheadSeconds(profile: PlaybackPerformanceProfile): number {
  return profile === "mobile" ? 0.4 : 0.15;
}

export function resolveMdrMidiPumpIntervalMs(profile: PlaybackPerformanceProfile): number {
  return profile === "mobile" ? 50 : 20;
}

/**
 * Hands SoundFont MIDI to the AudioWorklet slightly before its deadline so a
 * busy browser main thread cannot turn a timer callback into audible lateness.
 * Keep this below one desktop ScriptProcessor block: stopping playback then
 * leaves at most this short, already-scheduled tail in the worklet.
 */
export function resolveMdrMidiDispatchLeadSeconds(profile: PlaybackPerformanceProfile): number {
  return profile === "mobile" ? 0.05 : 0.04;
}

/** Converts the OPM Timer-B register into a quarter-note BPM equivalent at MADRV's 48 PPQN timing. */
export function timerBToEstimatedBpm(timerB: number, ppqn = 48): number | null {
  if (!Number.isInteger(timerB) || timerB < 0 || timerB > 255 || !Number.isInteger(ppqn) || ppqn <= 0) return null;
  return 60_000_000 / (256 * (256 - timerB) * ppqn);
}

/** MADRV initializes TEMPO to $C8 when a score never issues $FF / $FE $12. */
export const MADRV_DEFAULT_TEMPO_TIMER_B = 0xc8;

/**
 * Walks MDR track command streams for the first `$FF nn` or `$FE $12 nn` tempo
 * (Timer-B) value. Used when a GS MIDI-only MDR has no live OPM Timer-B register.
 */
export function extractMdrTempoTimerB(input: ArrayBuffer): number | null {
  const bytes = new Uint8Array(input);
  let marker = -1;
  for (let index = 0; index + 2 < bytes.length; index += 1) {
    if (bytes[index] === 0x0d && bytes[index + 1] === 0x0a && bytes[index + 2] === 0x1a) {
      marker = index;
      break;
    }
  }
  if (marker < 0) return null;
  let pdxEnd = marker + 3;
  while (pdxEnd < bytes.length && bytes[pdxEnd] !== 0) pdxEnd += 1;
  if (pdxEnd >= bytes.length) return null;
  const table = pdxEnd + 1;
  if (table + 66 > bytes.length) return null;
  let toneOffset: number;
  try {
    toneOffset = table + readWord(bytes, table);
  } catch {
    return null;
  }
  if (toneOffset < table + 66 || toneOffset > bytes.length) return null;
  const offsets: number[] = [];
  for (let track = 0; track < 32; track += 1) {
    try {
      const offset = table + readWord(bytes, table + 2 + track * 2);
      if (offset < table + 66 || offset > bytes.length) return null;
      offsets.push(offset);
    } catch {
      return null;
    }
  }

  // Fixed payload sizes after the opcode (MADRV.S CMD_*). $E2/$E0 are handled below.
  const fixedExtra: Record<number, number> = {
    0xe1: 1, 0xe3: 1, 0xe4: 0, 0xe5: 0, 0xe6: 0, 0xe7: 1, 0xe8: 2, 0xe9: 1, 0xea: 1,
    0xed: 1, 0xee: 0, 0xef: 1, 0xf0: 1, 0xf2: 2, 0xf3: 2, 0xf4: 2, 0xf5: 2, 0xf6: 2, 0xf7: 0,
    0xf8: 1, 0xf9: 0, 0xfa: 0, 0xfb: 1, 0xfc: 1, 0xfd: 1,
  };
  // KONOA ($E0 $00-$1C) data bytes after the subcommand byte.
  const e0Extra: Record<number, number> = {
    0x01: 1, 0x02: 1, 0x03: 1, 0x04: 1, 0x05: 1, 0x06: 1, 0x07: 1, 0x08: 1, 0x09: 1,
    0x0a: 0, 0x0b: 0, 0x0c: 1, 0x0d: 1, 0x0f: 2, 0x10: 1, 0x11: 0, 0x12: 0, 0x13: 1, 0x14: 1,
    0x15: 3, 0x16: 3, 0x17: 4, 0x18: 4, 0x19: 1, 0x1a: 1, 0x1b: 1, 0x1c: 1,
  };
  // Exclusive ($E2 nn …) data bytes after the subcommand byte (MADRV CMD_E2_*).
  const e2Extra: Record<number, number> = {
    0x00: 0, 0x01: 2, 0x02: 0, 0x03: 0, 0x04: 0, 0x05: 1, 0x06: 1, 0x07: 1, 0x08: 1, 0x09: 1,
    0x0a: 2, 0x0b: 2, 0x0c: 2, 0x0d: 2, 0x0e: 3, 0x0f: 2, 0x10: 1, 0x11: 0, 0x12: 1, 0x13: 1,
    0x14: 0, 0x15: 1, 0x16: 1, 0x17: 1, 0x18: 1, 0x19: 2, 0x1a: 1, 0x1b: 1,
    0x1c: 0, 0x1d: 1, 0x1e: 2, 0x1f: 2, 0x20: 2, 0x21: 2, 0x22: 2, 0x23: 1, 0x24: 1, 0x25: 1,
    0x26: 1, 0x27: 1, 0x28: 0, 0x29: 0, 0x2a: 0, 0x2b: 1, 0x2c: 1, 0x2d: 1, 0x2e: 1, 0x2f: 1,
    0x30: 1, 0x31: 3, 0x32: 2, 0x33: 0, 0x35: 0, 0x36: 0, 0x37: 2, 0x38: 1, 0x39: 1, 0x3a: 1,
    0x3b: 0, 0x3c: 0, 0x3d: 0, 0x3e: 0, 0x3f: 0, 0x40: 0, 0x41: 0, 0x42: 0, 0x43: 0, 0x44: 0,
    0x45: 0, 0x46: 0, 0x47: 0, 0x48: 0, 0x49: 0, 0x4a: 0, 0x4b: 0, 0x4c: 0, 0x4d: 0,
  };

  for (let track = 0; track < 32; track += 1) {
    let cursor = offsets[track]!;
    const end = track < 31 ? offsets[track + 1]! : toneOffset;
    let steps = 0;
    while (cursor < end && steps < 200_000) {
      steps += 1;
      const command = bytes[cursor++]!;
      if (command <= 0x7f) continue;
      if (command <= 0xdf) {
        if ((command & 0x0f) === 0 && cursor < end) cursor += 1;
        continue;
      }
      if (command === 0xff) {
        if (cursor >= end) break;
        return bytes[cursor]!;
      }
      if (command === 0xfe) {
        if (cursor + 1 >= end) break;
        const register = bytes[cursor++]!;
        const value = bytes[cursor++]!;
        // Exclusive $FE $12 nn sets TEMPO the same way as $FF nn.
        if (register === 0x12) return value;
        continue;
      }
      if (command === 0xf1) {
        if (cursor >= end) break;
        const first = bytes[cursor++]!;
        if (first === 0) break;
        if (cursor < end) cursor += 1;
        break;
      }
      if (command === 0xe0) {
        if (cursor >= end) break;
        const sub = bytes[cursor++]!;
        if (sub === 0xff) continue; // MDR/MDX track signature
        if (sub === 0x0e) {
          if (cursor >= end) break;
          const count = bytes[cursor++]!;
          cursor = Math.min(end, cursor + count + 1);
          continue;
        }
        if (sub === 0x00) {
          if (cursor >= end) break;
          const mode = bytes[cursor++]!;
          if ((mode & 0x80) === 0) cursor = Math.min(end, cursor + 4);
          continue;
        }
        const extra = e0Extra[sub];
        if (extra === undefined) break;
        cursor = Math.min(end, cursor + extra);
        continue;
      }
      if (command === 0xe2) {
        if (cursor >= end) break;
        const sub = bytes[cursor++]!;
        // $E2 $34 expands packed display data; length is not a fixed byte count.
        if (sub === 0x34) break;
        const extra = e2Extra[sub];
        if (extra === undefined) break;
        cursor = Math.min(end, cursor + extra);
        continue;
      }
      if (command === 0xeb || command === 0xec) {
        if (cursor >= end) break;
        const flags = bytes[cursor++]!;
        if ((flags & 0x80) !== 0) continue;
        cursor = Math.min(end, cursor + 4);
        continue;
      }
      const extra = fixedExtra[command];
      if (extra === undefined) break;
      cursor = Math.min(end, cursor + extra);
    }
  }
  return null;
}

/** Prefers a score `$FF`/`$FE $12` tempo, otherwise MADRV's power-on Timer-B default. */
export function resolveMdrDisplayTempoTimerB(input: ArrayBuffer): number {
  return extractMdrTempoTimerB(input) ?? MADRV_DEFAULT_TEMPO_TIMER_B;
}

/** Extracts the first MML tempo command; the interpreter defaults to 120 BPM. */
export function extractMmlInitialTempo(source: string): number {
  const withoutComments = source.split("\n").map((line) => line.split(";")[0]).join(" ");
  const match = withoutComments.match(/\bt\s*(\d{1,3})\b/i);
  const value = Number(match?.[1]);
  return Number.isFinite(value) && value >= 30 && value <= 480 ? value : 120;
}

/** Keeps a PDX filename displayable without appending a second extension. */
export function formatPdxFileName(pdxName: string): string {
  const trimmed = pdxName.trim();
  if (!trimmed) return "PDX";
  return /\.pdx$/i.test(trimmed) ? trimmed : `${trimmed}.PDX`;
}

/** Accepts the common MDR header sentinels that indicate no companion PDX is required. */
export function mdrRequiresPdx(pdxName: string): boolean {
  const normalized = pdxName.trim().toUpperCase();
  return normalized.length > 0 && normalized !== "UNTITLED" && normalized !== "NONE" && normalized !== "NO PDX";
}

/** A PCM activity bit is reported by the WebAssembly core for a currently playing ADPCM or PCM8 voice. */
export function hasPcmVoiceActivity(pcmActiveMask: number): boolean {
  return Number.isFinite(pcmActiveMask) && (Math.floor(pcmActiveMask) & 0xff) !== 0;
}

/** True when the given PCM voice (1–8) is currently set in the WASM PCM activity mask. */
export function isPcmVoiceActive(pcmActiveMask: number, voice: number): boolean {
  if (!Number.isInteger(voice) || voice < 1 || voice > 8) return false;
  return (Math.floor(pcmActiveMask) & (1 << (voice - 1))) !== 0;
}

/** MIDI-only MDR files have no OPM/PCM score for the MDX renderer; schedule their GS stream directly instead. */
export function requiresMdrHardwareRenderer(hardwareTracks: number): boolean {
  return Number.isFinite(hardwareTracks) && hardwareTracks > 0;
}

/** The PCM/PDX engine is armed only while an attached PDX has an active PCM voice. */
export function isPcmPdxEngineArmed(isPlaying: boolean, hasPdx: boolean, pcmActiveMask: number): boolean {
  return isPlaying && hasPdx && hasPcmVoiceActivity(pcmActiveMask);
}

/** Marks the OPM/PCM engine armed while the active score has a hardware (OPM/PCM) route. */
export function isOpmPcmEngineArmed(isPlaying: boolean, hardwareTrackCount: number, mmlUsesHardware = false): boolean {
  return isPlaying && (mmlUsesHardware || (Number.isFinite(hardwareTrackCount) && hardwareTrackCount > 0));
}

/** Marks the GS MIDI engine armed while the active score has a MIDI route. */
export function isGsMidiEngineArmed(isPlaying: boolean, midiTrackCount: number, mmlUsesMidi = false): boolean {
  return isPlaying && (mmlUsesMidi || (Number.isFinite(midiTrackCount) && midiTrackCount > 0));
}

/** Converts MXDRV's internal note value (its note code occupies the upper 10 bits) into a chromatic pitch class. */
export function mxdrvRawNoteToPitchClass(rawNote: number): number | null {
  const midiNote = mxdrvRawNoteToMidiNote(rawNote);
  return midiNote === null ? null : midiNote % 12;
}

/**
 * Converts MXDRV's shifted note value into a MIDI note number (C-1 = 0).
 * MDX note 0 is MML o0d♯ (not C), so MIDI = floor(raw/64) + 3.
 * @see https://github.com/vampirefrog/mdxtools/blob/master/docs/MDX.md
 */
export function mxdrvRawNoteToMidiNote(rawNote: number): number | null {
  if (!Number.isFinite(rawNote) || rawNote < 0) return null;
  const midiNote = Math.floor(rawNote / 64) + 3;
  if (midiNote < 0 || midiNote > 127) return null;
  return midiNote;
}

/** Applies a MIDI note on/off message to the active MIDI notes for one MDR MIDI track. */
export function updateMidiTrackNotes(current: readonly number[], bytes: readonly number[]): number[] {
  if (bytes.length < 2) return [...current];
  const status = bytes[0] & 0xf0;
  const note = bytes[1] & 0x7f;
  const velocity = bytes[2] ?? 0;
  if (status !== 0x80 && status !== 0x90) return [...current];
  const next = new Set(current);
  if (status === 0x90 && velocity > 0) next.add(note);
  else next.delete(note);
  return Array.from(next).sort((left, right) => left - right);
}

/** @deprecated Prefer updateMidiTrackNotes; kept for pitch-class-only callers. */
export function updateMidiTrackPitchClasses(current: readonly number[], bytes: readonly number[]): number[] {
  return updateMidiTrackNotes(current, bytes).map((note) => note % 12).filter((pitch, index, all) => all.indexOf(pitch) === index).sort((left, right) => left - right);
}

/** Formats a MIDI note as a pitch name with octave (MIDI 60 = C4). */
export function formatMidiNoteName(midiNote: number): string {
  if (!Number.isInteger(midiNote) || midiNote < 0 || midiNote > 127) return "?";
  const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  return `${names[midiNote % 12]}${Math.floor(midiNote / 12) - 1}`;
}

export type MdrMixerTrack = {
  index: number;
  engine: EngineKind;
  label: string;
  active: boolean;
  /** PCM voice 1–8 when `engine` is `"pcm"` (maps to MXDRV PCM activity bits). */
  pcmVoice?: number;
};

export type MdrTrackKeyState = Record<number, number[]>;

export type RemoteCatalogEntry = {
  id: string;
  title: string;
  mdrUrl: string;
  pdxUrl?: string;
  artist?: string;
  tags: string[];
};

/** Identifies common Google Drive share/download URLs without accessing user credentials. */
export function isGoogleDriveShareUrl(value: string): boolean {
  try {
    const hostname = new URL(value.trim()).hostname.toLowerCase();
    return hostname === "drive.google.com" || hostname.endsWith(".drive.google.com") || hostname === "drive.usercontent.google.com";
  } catch {
    return false;
  }
}

/** Converts public Google Drive sharing URLs into the current direct-download endpoint. CORS is still verified by the subsequent fetch. */
export function normalizeRemoteAssetUrl(value: string): string {
  const raw = value.trim();
  if (!raw || !isGoogleDriveShareUrl(raw)) return raw;
  try {
    const parsed = new URL(raw);
    const fromQuery = parsed.searchParams.get("id");
    const fromPath = parsed.pathname.match(/\/file\/d\/([^/?#]+)/)?.[1];
    const fileId = fromQuery ?? fromPath;
    if (!fileId) return raw;
    return `https://drive.usercontent.google.com/download?id=${encodeURIComponent(fileId)}&export=download&confirm=t`;
  } catch {
    return raw;
  }
}

export type SoundFontLoadProgress = {
  loadedBytes: number;
  totalBytes: number | null;
};

export type SoundFontLoadProgressListener = (progress: SoundFontLoadProgress) => void;

function reportSoundFontProgress(listener: SoundFontLoadProgressListener | undefined, loadedBytes: number, totalBytes: number | null) {
  listener?.({ loadedBytes, totalBytes });
}

async function readSoundFontResponse(response: Response, totalBytes: number | null, listener?: SoundFontLoadProgressListener, initialLoadedBytes = 0): Promise<Uint8Array> {
  if (!response.body) {
    const data = new Uint8Array(await response.arrayBuffer());
    reportSoundFontProgress(listener, initialLoadedBytes + data.byteLength, totalBytes);
    return data;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    byteLength += value.byteLength;
    chunks.push(value);
    reportSoundFontProgress(listener, initialLoadedBytes + byteLength, totalBytes);
  }
  const data = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    data.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return data;
}

/** Downloads a public SoundFont into browser memory. The response must permit CORS and is never uploaded to an application server. */
export async function fetchRemoteSoundFont(url: string, onProgress?: SoundFontLoadProgressListener): Promise<{ data: ArrayBuffer; resolvedUrl: string }> {
  const raw = url.trim();
  if (!raw) throw new Error("SoundFont URLを入力してください。");
  let resolvedUrl: string;
  try {
    const parsed = new URL(normalizeRemoteAssetUrl(raw));
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") throw new Error("protocol");
    resolvedUrl = parsed.toString();
  } catch {
    throw new Error("SoundFont URLはhttp:// または https:// で始まる公開URLを指定してください。");
  }
  let response: Response;
  try {
    response = await fetch(resolvedUrl, { mode: "cors" });
  } catch {
    if (isGoogleDriveShareUrl(raw)) throw new Error("Google DriveのSoundFontを取得できませんでした。共有設定を「リンクを知っている全員（閲覧者）」にし、ダウンロード制限を解除してください。共有だけでCORS応答が出ない場合は、ローカルファイルとして保存して読み込んでください。");
    throw new Error("SoundFont URLを取得できませんでした。公開URLとCORS設定を確認してください。");
  }
  if (!response.ok) throw new Error(isGoogleDriveShareUrl(raw) ? `Google DriveのSoundFontを取得できませんでした（HTTP ${response.status}）。共有リンク、閲覧権限、ダウンロード制限を確認してください。` : `SoundFont URLの取得に失敗しました（HTTP ${response.status}）。`);
  const maximumBytes = isGoogleDriveShareUrl(raw) ? 320 * 1024 * 1024 : 256 * 1024 * 1024;
  const declaredLength = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) throw new Error(`SoundFontが${Math.round(maximumBytes / 1024 / 1024)} MBを超えています。ブラウザメモリを保護するため読み込みを中止しました。`);
  reportSoundFontProgress(onProgress, 0, Number.isFinite(declaredLength) && declaredLength > 0 ? declaredLength : null);
  const bytes = await readSoundFontResponse(response, Number.isFinite(declaredLength) && declaredLength > 0 ? declaredLength : null, onProgress);
  const data = bytes.slice().buffer as ArrayBuffer;
  if (!data.byteLength) throw new Error("SoundFontのデータが空です。");
  if (data.byteLength > maximumBytes) throw new Error(`SoundFontが${Math.round(maximumBytes / 1024 / 1024)} MBを超えています。ブラウザメモリを保護するため読み込みを中止しました。`);
  return { data, resolvedUrl };
}

function parseContentRange(value: string | null): { start: number; end: number; total: number } | null {
  const match = /^bytes\s+(\d+)-(\d+)\/(\d+)$/.exec(value ?? "");
  if (!match) return null;
  const start = Number(match[1]);
  const end = Number(match[2]);
  const total = Number(match[3]);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || !Number.isSafeInteger(total) || start < 0 || end < start || total <= end) return null;
  return { start, end, total };
}

async function fetchSharedSoundFontByRanges(parsed: URL, onProgress?: SoundFontLoadProgressListener): Promise<{ data: ArrayBuffer; resolvedUrl: string }> {
  const maximumBytes = 320 * 1024 * 1024;
  const chunkBytes = 8 * 1024 * 1024;
  const endpoint = `/api/public-storage/soundfont?url=${encodeURIComponent(parsed.toString())}`;
  let first: Response;
  try {
    first = await fetch(endpoint, { method: "GET", headers: { Range: `bytes=0-${chunkBytes - 1}` } });
  } catch {
    throw new Error("公開共有SoundFontの分割取得に失敗しました。ネットワーク接続を確認して再試行してください。");
  }
  if (!first.ok) {
    const payload = await first.json().catch(() => null) as { error?: unknown } | null;
    throw new Error(typeof payload?.error === "string" ? payload.error : `公開共有SoundFontの取得に失敗しました（HTTP ${first.status}）。`);
  }
  const range = parseContentRange(first.headers.get("content-range"));
  if (!range || first.status !== 206 || range.start !== 0 || range.total > maximumBytes) throw new Error("共有SoundFontが分割取得に対応していません。ローカル読み込みを試してください。");
  reportSoundFontProgress(onProgress, 0, range.total);
  const data = new Uint8Array(range.total);
  const firstChunk = await readSoundFontResponse(first, range.total, onProgress);
  if (firstChunk.byteLength !== range.end - range.start + 1) throw new Error("共有SoundFontの先頭データが不完全です。");
  data.set(firstChunk, range.start);
  let loadedBytes = firstChunk.byteLength;
  for (let offset = firstChunk.byteLength; offset < data.byteLength; offset += chunkBytes) {
    const end = Math.min(data.byteLength - 1, offset + chunkBytes - 1);
    const response = await fetch(endpoint, { method: "GET", headers: { Range: `bytes=${offset}-${end}` } });
    const partRange = parseContentRange(response.headers.get("content-range"));
    if (!response.ok || response.status !== 206 || !partRange || partRange.start !== offset || partRange.end !== end || partRange.total !== data.byteLength) throw new Error("共有SoundFontの分割データが不完全です。再試行してください。");
    const chunk = await readSoundFontResponse(response, data.byteLength, onProgress, loadedBytes);
    if (chunk.byteLength !== end - offset + 1) throw new Error("共有SoundFontの分割データ長が一致しません。再試行してください。");
    data.set(chunk, offset);
    loadedBytes += chunk.byteLength;
  }
  return { data: data.buffer as ArrayBuffer, resolvedUrl: first.headers.get("x-remote-asset-final-url") ?? parsed.toString() };
}

/** Fetches CORS-enabled public banks directly; only falls back to a range-based same-origin stream for share hosts that do not expose CORS. */
export async function fetchSharedSoundFont(url: string, onProgress?: SoundFontLoadProgressListener): Promise<{ data: ArrayBuffer; resolvedUrl: string; transport: "direct" | "proxy" }> {
  const raw = url.trim();
  if (!raw) throw new Error("SoundFont共有URLを入力してください。");
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("SoundFont共有URLはhttps:// で始まるGoogle DriveまたはDropboxの公開リンクを指定してください。");
  }
  try {
    const direct = await fetchRemoteSoundFont(parsed.toString(), onProgress);
    return { ...direct, transport: "direct" };
  } catch {
    // A public Drive download normally has CORS. Dropbox and some older sharing configurations do not,
    // so retain the validated same-origin stream as a fallback rather than failing the entire load.
  }
  const proxy = await fetchSharedSoundFontByRanges(parsed, onProgress);
  return { ...proxy, transport: "proxy" };
}

export type ScheduledMdrMidiEvent = {
  at: number;
  sourceTrack: number;
  bytes: number[];
};

/** A converted MDR song's complete MIDI loop window, including any non-looping intro before `startSeconds`. */
export type MdrMidiLoopWindow = {
  startSeconds: number;
  endSeconds: number;
};

export type MdrMidiSyncSnapshot = {
  scheduledSeconds: number;
  dispatchedSeconds: number;
  hardwareMilliseconds: number | null;
  kind?: "worklet-dispatch";
};

export type MdrMidiSchedulingStats = {
  generation: number;
  appliedCount: number;
  lateCount: number;
  maxLateSeconds: number;
  receivedLateCount: number;
  maxReceiptLateSeconds: number;
  lastTargetAt: number | null;
  lastAppliedAt: number | null;
  pendingCount: number;
};

/**
 * MDR's GS conversion may report a longer raw event timeline than the MDX
 * hardware renderer. Scale the GS timeline to the measured MXDRV duration so
 * hybrid OPM/PCM and GS MIDI retain their shared song position over long songs.
 */
/** Extends a hardware-measured MDR duration through its final scheduled GS MIDI event plus a short release tail. */
export function resolveMdrPlaybackDuration(
  hardwareDuration: number,
  midiEvents: readonly ScheduledMdrMidiEvent[],
  midiLoopWindow?: MdrMidiLoopWindow,
): number {
  const safeHardwareDuration = Number.isFinite(hardwareDuration) && hardwareDuration > 0 ? hardwareDuration : 0;
  const finalMidiEvent = midiEvents.reduce((latest, event) => Number.isFinite(event.at) ? Math.max(latest, event.at) : latest, 0);
  const midiDuration = finalMidiEvent > 0 ? finalMidiEvent + MDR_MIDI_RELEASE_SECONDS : 0;
  // The MXDRV duration probe has a finite ceiling. When it reaches that
  // ceiling, an MDR L loop with a converted MIDI loop window supplies the
  // actual finite browser boundary; retaining 1200 seconds would make the
  // transport appear to never finish.
  const hasValidMidiLoop = Boolean(
    midiLoopWindow
    && Number.isFinite(midiLoopWindow.startSeconds)
    && Number.isFinite(midiLoopWindow.endSeconds)
    && midiLoopWindow.startSeconds >= 0
    && midiLoopWindow.endSeconds > midiLoopWindow.startSeconds,
  );
  if (safeHardwareDuration >= 1200 && hasValidMidiLoop && midiDuration > 0) return midiDuration;
  return Math.max(safeHardwareDuration, midiDuration);
}

/** Infinite hybrid playback wraps on MXDRV's measured loop boundary, never on a trailing GS MIDI release event. */
export function resolveMdrInfiniteMidiLoopPeriodSeconds(hardwareDuration: number, playbackDuration: number, hasHardwareRenderer: boolean): number | undefined {
  if (hasHardwareRenderer && Number.isFinite(hardwareDuration) && hardwareDuration > 0) return hardwareDuration;
  if (Number.isFinite(playbackDuration) && playbackDuration > 0) return playbackDuration;
  return undefined;
}

/**
 * MXDRV `measure(2) - measure(1)` is the expandable song-loop body. Identical
 * one- and two-pass durations mean the converted hardware tracks have no L.
 */
export function resolveMdrHardwareLoopCycleSeconds(onePassSeconds: number, twoPassSeconds: number): number | undefined {
  if (!Number.isFinite(onePassSeconds) || !Number.isFinite(twoPassSeconds) || onePassSeconds <= 0 || twoPassSeconds <= 0) return undefined;
  const cycle = twoPassSeconds - onePassSeconds;
  return cycle > 0.05 ? cycle : undefined;
}

/**
 * Drops a converter L window that cannot be the musical song loop. A common
 * failure mode (e.g. G2M_TTL_SC.MDR) reports a few-second MIDI L while MXDRV's
 * one-pass hardware duration is far longer after the hardware L was truncated.
 */
export function resolveTrustedMdrMidiLoopWindow(
  loopWindow: MdrMidiLoopWindow | undefined,
  hardwareOnePassSeconds?: number,
  hardwareCycleSeconds?: number,
): MdrMidiLoopWindow | undefined {
  if (!loopWindow) return undefined;
  const { startSeconds, endSeconds } = loopWindow;
  if (!Number.isFinite(startSeconds) || !Number.isFinite(endSeconds) || startSeconds < 0 || endSeconds <= startSeconds) return undefined;
  const period = endSeconds - startSeconds;
  if (Number.isFinite(hardwareCycleSeconds) && (hardwareCycleSeconds as number) > 0) {
    const ratio = period / (hardwareCycleSeconds as number);
    // A MIDI arrangement can span several hardware ostinato loops (PRIN_GS).
    const hardwareCycles = Math.round(ratio);
    return hardwareCycles >= 1 && Math.abs(ratio - hardwareCycles) <= 0.15 ? loopWindow : undefined;
  }
  if (Number.isFinite(hardwareOnePassSeconds) && (hardwareOnePassSeconds as number) > 0) {
    const onePass = hardwareOnePassSeconds as number;
    // The MXDRV duration probe saturates near 20 minutes on some looping PCM
    // arrangements (MJ_RUMI_SC). That ceiling is not a measured song boundary.
    if (onePass >= 1200) return loopWindow;
    // Misrecognized L: short MIDI period that ends well before the hardware pass.
    if (period < onePass * 0.5 && endSeconds < onePass * 0.85) return undefined;
  }
  return loopWindow;
}

/** Advances an infinite MIDI cursor before the MXDRV boundary when the normal GS lookahead reaches the next pass. */
export function resolveMdrInfiniteMidiCycle(hardwareElapsedSeconds: number, loopPeriodSeconds: number, lookaheadSeconds = 0): number {
  if (!Number.isFinite(loopPeriodSeconds) || loopPeriodSeconds <= 0) return 0;
  const elapsed = Number.isFinite(hardwareElapsedSeconds) ? Math.max(0, hardwareElapsedSeconds) : 0;
  const lookahead = Number.isFinite(lookaheadSeconds) ? Math.max(0, lookaheadSeconds) : 0;
  return Math.max(0, Math.floor((elapsed + lookahead) / loopPeriodSeconds));
}

/** The next loop's setup messages must reach the AudioWorklet before the audible MXDRV boundary. */
export function shouldScheduleMdrMidiDirectlyAtLoopStart(infinite: boolean, cycle: number, eventAtSeconds: number, lookaheadSeconds: number): boolean {
  return infinite && Number.isInteger(cycle) && cycle > 0 && Number.isFinite(eventAtSeconds) && eventAtSeconds >= 0 && Number.isFinite(lookaheadSeconds) && eventAtSeconds <= Math.max(0, lookaheadSeconds);
}

/** A future GS Reset belongs to the AudioWorklet timeline and must not silence the current pass early. */
export function shouldStopGsSynthImmediatelyForMdrReset(isGsReset: boolean, scheduleAt: number | undefined, audioNowSeconds: number): boolean {
  if (!isGsReset || scheduleAt === undefined) return isGsReset;
  const now = Number.isFinite(audioNowSeconds) ? audioNowSeconds : 0;
  return !Number.isFinite(scheduleAt) || scheduleAt <= now + 0.001;
}

/** Discards finite-pass MIDI release tails that lie beyond the hardware loop boundary. */
export function selectMdrInfiniteMidiLoopEvents(events: readonly ScheduledMdrMidiEvent[], loopPeriodSeconds: number): ScheduledMdrMidiEvent[] {
  if (!Number.isFinite(loopPeriodSeconds) || loopPeriodSeconds <= 0) return [...events];
  return events.filter((event) => Number.isFinite(event.at) && event.at >= 0 && event.at < loopPeriodSeconds);
}

/** Keeps the intro plus one complete musical cycle; later cycles restart from the converted song-loop point. */
export function selectMdrMidiLoopWindowEvents(events: readonly ScheduledMdrMidiEvent[], loopWindow: MdrMidiLoopWindow): ScheduledMdrMidiEvent[] {
  if (!Number.isFinite(loopWindow.startSeconds) || !Number.isFinite(loopWindow.endSeconds) || loopWindow.startSeconds < 0 || loopWindow.endSeconds <= loopWindow.startSeconds) return [...events];
  return events.filter((event) => Number.isFinite(event.at) && event.at >= 0 && event.at < loopWindow.endSeconds);
}

/** Maps an event's first-pass timeline time onto an infinite pass after the full musical loop window. */
export function resolveMdrMidiLoopDispatchAtSeconds(eventAtSeconds: number, cycle: number, loopWindow: MdrMidiLoopWindow): number | undefined {
  if (!Number.isFinite(eventAtSeconds) || !Number.isInteger(cycle) || cycle < 0) return undefined;
  const period = loopWindow.endSeconds - loopWindow.startSeconds;
  if (!Number.isFinite(loopWindow.startSeconds) || !Number.isFinite(loopWindow.endSeconds) || loopWindow.startSeconds < 0 || period <= 0) return cycle === 0 ? eventAtSeconds : undefined;
  if (cycle > 0 && (eventAtSeconds < loopWindow.startSeconds || eventAtSeconds >= loopWindow.endSeconds)) return undefined;
  return eventAtSeconds + cycle * period;
}

export type MidiDiagnosticEntry = {
  id: string;
  time: string;
  device: string;
  label: string;
  bytes: number[];
  status: "sent" | "info" | "error";
};

type MadrvWasmModule = {
  HEAPU8: Uint8Array;
  HEAP16: Int16Array;
  _malloc(size: number): number;
  _free(pointer: number): void;
  [key: string]: unknown;
};

type MadrvWasmFactory = (options?: { locateFile?: (file: string) => string }) => Promise<MadrvWasmModule>;

const CONVERTER_MODULE_URL = "/manus-storage/madrv-converter-v4_28935c58.mjs";
const CONVERTER_WASM_URL = "/manus-storage/madrv-converter-v4_f7f66741.wasm";
const PLAYER_MODULE_URL = "/manus-storage/madrv-mdx-player-v12_fde3ce0c.mjs";
const PLAYER_WASM_URL = "/manus-storage/madrv-mdx-player-v12_2d6b7625.wasm";
const MIDI_EVENTS_MODULE_URL = "/manus-storage/madrv-midi-events-v4_b2d6bf6b.mjs";
const MIDI_EVENTS_WASM_URL = "/manus-storage/madrv-midi-events-v4_2facde2d.wasm";
const SPESSA_PROCESSOR_URL = "/manus-storage/madrv-spessasynth-processor.js";
const MDX_WORKLET_PROCESSOR_URL = "/manus-storage/madrv-mdx-worklet-bundled_e8ea643e.js";

const GS_RESET = [0xf0, 0x41, 0x10, 0x42, 0x12, 0x40, 0x00, 0x7f, 0x00, 0x41, 0xf7];
const GS_PART_ADDRESS = [0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18, 0x19, 0x10, 0x1a, 0x1b, 0x1c, 0x1d, 0x1e, 0x1f];

/** GS Reset initializes the bank on the first pass; repeating it at a seamless loop restarts the synth and delays next-pass notes. */
export function shouldSkipMdrMidiEventAtLoopCycle(bytes: readonly number[], cycle: number): boolean {
  return Number.isInteger(cycle) && cycle > 0 && bytes.length === GS_RESET.length && bytes.every((value, index) => value === GS_RESET[index]);
}

export class MmlSyntaxError extends Error {
  constructor(message: string, public readonly line: number, public readonly column: number) {
    super(message);
    this.name = "MmlSyntaxError";
  }
}

const NOTE_VALUES: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
const decoder = typeof TextDecoder !== "undefined" ? new TextDecoder("shift-jis", { fatal: false }) : null;

function numberAt(text: string, index: number): { value?: number; end: number } {
  const match = text.slice(index).match(/^\d+/);
  if (!match) return { end: index };
  return { value: Number(match[0]), end: index + match[0].length };
}

function engineFromDirective(value: string): EngineKind | undefined {
  const normalized = value.toLowerCase();
  if (normalized === "opm" || normalized === "fm") return "opm";
  if (normalized === "pcm" || normalized === "pdx") return "pcm";
  if (normalized === "midi" || normalized === "gs") return "midi";
  return undefined;
}

/** Compiles a pragmatic MML subset: T, O, L, V, A–G, R, <, >, accidental, dots and @OPM/@PCM/@MIDI directives. */
export function compileMml(source: string): CompiledMml {
  const events: MmlEvent[] = [];
  const engines = new Set<EngineKind>();
  const lines = source.replace(/\r/g, "").split("\n");
  let maxDuration = 0;

  lines.forEach((rawLine, lineIndex) => {
    const content = rawLine.split(";", 1)[0];
    let cursor = 0;
    let time = 0;
    let tempo = 120;
    let octave = 4;
    let defaultLength = 4;
    let velocity = 96;
    let engine: EngineKind = "opm";

    const fail = (message: string, column = cursor + 1): never => {
      throw new MmlSyntaxError(message, lineIndex + 1, column);
    };

    while (cursor < content.length) {
      const character = content[cursor];
      if (/\s|,/.test(character)) {
        cursor += 1;
        continue;
      }
      if (character === "@") {
        const directive = content.slice(cursor + 1).match(/^[A-Za-z]+/);
        if (!directive) throw new MmlSyntaxError("@の後に音源指定（OPM / PCM / MIDI）を記述してください。", lineIndex + 1, cursor + 1);
        const nextEngine = engineFromDirective(directive[0]);
        if (!nextEngine) throw new MmlSyntaxError(`音源指定「${directive[0]}」は未対応です。`, lineIndex + 1, cursor + 1);
        engine = nextEngine;
        cursor += directive[0].length + 1;
        continue;
      }
      if (character === "<") {
        octave = Math.max(0, octave - 1);
        cursor += 1;
        continue;
      }
      if (character === ">") {
        octave = Math.min(8, octave + 1);
        cursor += 1;
        continue;
      }

      const command = character.toLowerCase();
      if (command === "t" || command === "o" || command === "l" || command === "v") {
        const valueAt = numberAt(content, cursor + 1);
        const value = valueAt.value;
        if (value === undefined) throw new MmlSyntaxError(`${command.toUpperCase()}には数値が必要です。`, lineIndex + 1, cursor + 1);
        if (command === "t") {
          if (value < 30 || value > 480) fail("テンポは30〜480の範囲で指定してください。");
          tempo = value;
        }
        if (command === "o") {
          if (value < 0 || value > 8) fail("オクターブは0〜8の範囲で指定してください。");
          octave = value;
        }
        if (command === "l") {
          if (value < 1 || value > 128) fail("音長は1〜128の範囲で指定してください。");
          defaultLength = value;
        }
        if (command === "v") {
          if (value < 0 || value > 15) fail("音量は0〜15の範囲で指定してください。");
          velocity = Math.round((value / 15) * 112) + 15;
        }
        cursor = valueAt.end;
        continue;
      }

      const isRest = command === "r";
      if (isRest || NOTE_VALUES[command] !== undefined) {
        const noteColumn = cursor + 1;
        cursor += 1;
        let semitone = isRest ? 0 : NOTE_VALUES[command];
        if (!isRest && /[+#-]/.test(content[cursor] ?? "")) {
          semitone += content[cursor] === "-" ? -1 : 1;
          cursor += 1;
        }
        const lengthAt = numberAt(content, cursor);
        const denominator = lengthAt.value ?? defaultLength;
        if (denominator < 1 || denominator > 128) fail("音長は1〜128の範囲で指定してください。", noteColumn);
        cursor = lengthAt.end;
        let duration = (60 / tempo) * (4 / denominator);
        let dotDuration = duration / 2;
        while (content[cursor] === ".") {
          duration += dotDuration;
          dotDuration /= 2;
          cursor += 1;
        }
        if (!isRest) {
          const midi = Math.max(0, Math.min(127, (octave + 1) * 12 + semitone));
          events.push({ engine, start: time, duration, midi, velocity });
          engines.add(engine);
        }
        time += duration;
        maxDuration = Math.max(maxDuration, time);
        if (events.length > 4096) fail("イベント数が4096を超えました。スコアを分割してください。", noteColumn);
        continue;
      }

      fail(`「${character}」は未対応のMML記号です。`);
    }
  });

  if (events.length === 0) throw new MmlSyntaxError("再生できるノートが見つかりません。", 1, 1);
  return { events: events.sort((a, b) => a.start - b.start), duration: maxDuration, engines: Array.from(engines) };
}

/** Repeats a finite MML score while enforcing a maximum duration; used to make an exportable form of looped music. */
export function limitScore(score: CompiledMml, requestedLoops: number, maximumSeconds: number): CompiledMml {
  const safeLoops = Math.max(1, Math.min(99, Math.floor(requestedLoops)));
  const maxLoops = Math.max(1, Math.floor(maximumSeconds / score.duration));
  const appliedLoops = Math.min(safeLoops, maxLoops);
  const events: MmlEvent[] = [];
  for (let loopIndex = 0; loopIndex < appliedLoops; loopIndex += 1) {
    const offset = score.duration * loopIndex;
    score.events.forEach((event) => events.push({ ...event, start: event.start + offset }));
  }
  return { events, duration: score.duration * appliedLoops, engines: score.engines };
}

function decodeName(bytes: Uint8Array): string {
  try {
    const decoded = decoder?.decode(bytes).replace(/\u0000/g, "").trim();
    return decoded || "UNTITLED";
  } catch {
    return Array.from(bytes).map((byte) => String.fromCharCode(byte)).join("").trim() || "UNTITLED";
  }
}

function readWord(bytes: Uint8Array, position: number): number {
  if (position + 1 >= bytes.length) throw new Error("MDRのオフセットテーブルが途中で終了しています。");
  return (bytes[position] << 8) | bytes[position + 1];
}

/** Reads the MDX title and optional companion PDX filename without interpreting score data. */
export function inspectMdx(input: ArrayBuffer): MdxInfo {
  const bytes = new Uint8Array(input);
  let marker = -1;
  for (let index = 0; index + 2 < bytes.length; index += 1) {
    if (bytes[index] === 0x0d && bytes[index + 1] === 0x0a && bytes[index + 2] === 0x1a) {
      marker = index;
      break;
    }
  }
  if (marker < 0) throw new Error("MDXタイトル終端（0D 0A 1A）が見つかりません。ファイル形式を確認してください。");
  const pdxStart = marker + 3;
  let pdxEnd = pdxStart;
  while (pdxEnd < bytes.length && bytes[pdxEnd] !== 0) pdxEnd += 1;
  if (pdxEnd >= bytes.length) throw new Error("MDXのPDXファイル名が終端されていません。");
  return { title: decodeName(bytes.slice(0, marker)), pdxName: decodeName(bytes.slice(pdxStart, pdxEnd)) };
}

/**
 * Resolves a track's playback engine from `$E0 $08` channel assigns and `$E0 $0E` MIDI dumps.
 * Slot index alone is wrong for scores like MEGALITH that park PCM voices in tracks 16+.
 */
export function resolveMdrTrackEngine(bytes: Uint8Array, start: number, end: number, index: number): EngineKind {
  let sawMidi = false;
  let sawOpmChannel = false;
  let sawPcmChannel = false;
  let sawHardwareNote = false;
  for (let offset = start; offset + 2 < end; offset += 1) {
    // Legacy EX-MDR files often omit E0 08 for the native tracks. In that
    // form MADRV uses the track slot as the default device: A-H are OPM,
    // P-W are PCM, and the upper half is GS MIDI. Keep a note check so short
    // F1/end stubs in MIDI-only songs do not turn into phantom hardware tracks.
    if (bytes[offset]! >= 0x80 && bytes[offset]! <= 0xdf) sawHardwareNote = true;
    if (bytes[offset] !== 0xe0) continue;
    const subcommand = bytes[offset + 1]!;
    if (subcommand === 0x0e) {
      sawMidi = true;
      continue;
    }
    if (subcommand !== 0x08) continue;
    const channel = bytes[offset + 2]!;
    if ((channel & 0x80) !== 0) {
      sawMidi = true;
      continue;
    }
    if ((channel & 0x0f) >= 8) sawPcmChannel = true;
    else sawOpmChannel = true;
  }
  if (sawPcmChannel && !sawMidi) return "pcm";
  if (sawMidi && !sawOpmChannel && !sawPcmChannel) return "midi";
  if (sawOpmChannel && !sawMidi) return "opm";
  if (sawPcmChannel) return "pcm";
  if (sawMidi) return "midi";
  if (sawOpmChannel) return "opm";
  if (!sawHardwareNote) return "midi";
  if (index >= 16) return "midi";
  if (index >= 8) return "pcm";
  // No $E0 voice routing: use MADRV's legacy slot defaults for native tracks.
  // This is required for older OPM+GS files such as NAMA47GS.MDR, which have
  // full A-H note streams but no explicit E0 08 channel assignment.
  return "opm";
}

function isMdrMidiTrack(bytes: Uint8Array, start: number, end: number): boolean {
  return resolveMdrTrackEngine(bytes, start, end, 16) === "midi";
}

/** PCM voice number 1–8 from the first non-MIDI `$E0 $08` channel in the 8–15 range. */
function resolveMdrPcmVoiceNumber(bytes: Uint8Array, start: number, end: number, fallbackIndex: number): number {
  for (let offset = start; offset + 2 < end; offset += 1) {
    if (bytes[offset] !== 0xe0 || bytes[offset + 1] !== 0x08) continue;
    const channel = bytes[offset + 2]!;
    if ((channel & 0x80) !== 0) continue;
    const voice = channel & 0x0f;
    if (voice >= 8) return Math.min(8, voice - 7);
  }
  const fromSlot = fallbackIndex >= 8 && fallbackIndex < 16 ? fallbackIndex - 7 : fallbackIndex - 15;
  return Math.max(1, Math.min(8, fromSlot));
}

/** Inspects the MDR framing implemented by mpxadrv: title, PDX name, tone offset and 32 ordered tracks. */
export function inspectMdr(input: ArrayBuffer): MdrInfo {
  const bytes = new Uint8Array(input);
  if (bytes.length < 70) throw new Error("MDRデータが短すぎます。");
  let marker = -1;
  for (let index = 0; index + 2 < bytes.length; index += 1) {
    if (bytes[index] === 0x0d && bytes[index + 1] === 0x0a && bytes[index + 2] === 0x1a) {
      marker = index;
      break;
    }
  }
  if (marker < 0) throw new Error("MDRタイトル終端（0D 0A 1A）が見つかりません。");
  const pdxStart = marker + 3;
  let pdxEnd = pdxStart;
  while (pdxEnd < bytes.length && bytes[pdxEnd] !== 0) pdxEnd += 1;
  if (pdxEnd >= bytes.length) throw new Error("MDRのPDXファイル名が終端されていません。");
  const table = pdxEnd + 1;
  const tableBytes = 66;
  if (table + tableBytes > bytes.length) throw new Error("MDRの32トラックオフセットテーブルが不完全です。");
  const toneOffset = table + readWord(bytes, table);
  if (toneOffset < table + tableBytes || toneOffset > bytes.length) throw new Error("MDRのトーンオフセットが範囲外です。");
  const offsets: number[] = [];
  for (let track = 0; track < 32; track += 1) {
    const offset = table + readWord(bytes, table + 2 + track * 2);
    if (offset < table + tableBytes || offset >= bytes.length) throw new Error(`MDRトラック${track + 1}のオフセットが範囲外です。`);
    if (track > 0 && offset < offsets[track - 1]) throw new Error("MDRのトラックオフセットが昇順ではありません。");
    offsets.push(offset);
  }
  const first = offsets[0];
  const hasExtendedPcm = bytes[first] === 0xe8;
  const signature = hasExtendedPcm ? first + 1 : first;
  if (bytes[signature] !== 0xe0 || bytes[signature + 1] !== 0xff) throw new Error("MDRのE0 FFシグネチャが見つかりません。");
  let activeTracks = 0;
  let hardwareTracks = 0;
  let midiTracks = 0;
  offsets.forEach((start, index) => {
    const end = index < 31 ? offsets[index + 1] : toneOffset;
    const minimum = index === 0 ? (hasExtendedPcm ? 5 : 4) : 2;
    if (end - start > minimum) {
      activeTracks += 1;
      if (resolveMdrTrackEngine(bytes, start, end, index) === "midi") midiTracks += 1;
      else hardwareTracks += 1;
    }
  });
  return { title: decodeName(bytes.slice(0, marker)), pdxName: decodeName(bytes.slice(pdxStart, pdxEnd)), activeTracks, hardwareTracks, midiTracks, hasExtendedPcm, byteLength: bytes.byteLength };
}

export type MadrvSourceInfo =
  | { format: "mdr"; info: MdrInfo }
  | { format: "mdx"; info: MdxInfo };

/** Distinguishes MDR from MDX by their validated binary framing, not by a shared-link URL path or query string. */
export function inspectMadrvSource(input: ArrayBuffer): MadrvSourceInfo {
  try {
    return { format: "mdr", info: inspectMdr(input) };
  } catch {
    return { format: "mdx", info: inspectMdx(input) };
  }
}

export function listMdrMixerTracks(input: ArrayBuffer): MdrMixerTrack[] {
  const bytes = new Uint8Array(input);
  inspectMdr(input);
  let marker = -1;
  for (let index = 0; index + 2 < bytes.length; index += 1) {
    if (bytes[index] === 0x0d && bytes[index + 1] === 0x0a && bytes[index + 2] === 0x1a) { marker = index; break; }
  }
  const pdxStart = marker + 3;
  let pdxEnd = pdxStart;
  while (bytes[pdxEnd] !== 0) pdxEnd += 1;
  const table = pdxEnd + 1;
  const toneOffset = table + readWord(bytes, table);
  const offsets = Array.from({ length: 32 }, (_, index) => table + readWord(bytes, table + 2 + index * 2));
  const extendedPcm = bytes[offsets[0]] === 0xe8;
  const tracks = offsets.map((start, index) => {
    const end = index < 31 ? offsets[index + 1]! : toneOffset;
    const minimum = index === 0 ? (extendedPcm ? 5 : 4) : 2;
    const active = end - start > minimum;
    const engine = resolveMdrTrackEngine(bytes, start, end, index);
    if (engine === "opm") return { index, engine, active, label: `OPM ${index + 1}` };
    if (engine === "pcm") {
      const pcmVoice = resolveMdrPcmVoiceNumber(bytes, start, end, index);
      return { index, engine, active, label: `PCM ${pcmVoice}`, pcmVoice };
    }
    return { index, engine, active, label: "GS" };
  });
  let midiOrdinal = 0;
  return tracks.map((track) => track.engine === "midi" ? { ...track, label: `GS ${midiOrdinal += 1}` } : track);
}

function remoteFetchFailure(kind: "MDR" | "PDX" | "カタログ", url: string): Error {
  if (isGoogleDriveShareUrl(url)) return new Error(`${kind}をGoogle Driveから取得できませんでした。共有設定を「リンクを知っている全員（閲覧者）」にし、ダウンロード制限を解除してください。共有だけでCORS応答が出ない場合は、ファイルを保存してローカル読込するか、CORSヘッダーを設定できる公開ストレージを使用してください。`);
  return new Error(`${kind} URLを取得できませんでした。公開URLとCORS設定を確認してください。`);
}

export async function fetchMdrSource(mdrUrl: string, pdxUrl?: string): Promise<{ mdr: ArrayBuffer; pdx?: ArrayBuffer; info: MdrInfo }> {
  const resolvedMdrUrl = normalizeRemoteAssetUrl(mdrUrl);
  let mdrResponse: Response;
  try {
    mdrResponse = await fetch(resolvedMdrUrl, { mode: "cors" });
  } catch {
    throw remoteFetchFailure("MDR", mdrUrl);
  }
  if (!mdrResponse.ok) throw new Error(isGoogleDriveShareUrl(mdrUrl) ? `MDRをGoogle Driveから取得できませんでした（HTTP ${mdrResponse.status}）。共有リンク、閲覧権限、ダウンロード制限を確認してください。` : `MDR URLの取得に失敗しました（HTTP ${mdrResponse.status}）。`);
  const mdr = await mdrResponse.arrayBuffer();
  const info = inspectMdr(mdr);
  if (!pdxUrl) return { mdr, info };
  const resolvedPdxUrl = normalizeRemoteAssetUrl(pdxUrl);
  let pdxResponse: Response;
  try {
    pdxResponse = await fetch(resolvedPdxUrl, { mode: "cors" });
  } catch {
    throw remoteFetchFailure("PDX", pdxUrl);
  }
  if (!pdxResponse.ok) throw new Error(isGoogleDriveShareUrl(pdxUrl) ? `PDXをGoogle Driveから取得できませんでした（HTTP ${pdxResponse.status}）。共有リンク、閲覧権限、ダウンロード制限を確認してください。` : `PDX URLの取得に失敗しました（HTTP ${pdxResponse.status}）。`);
  return { mdr, pdx: await pdxResponse.arrayBuffer(), info };
}

function stringValue(input: unknown): string | undefined {
  return typeof input === "string" && input.trim().length ? input.trim() : undefined;
}

/** Accepts an array or { entries | tracks | songs } and normalizes URL fields without executing remote content. */
export function parseRemoteCatalogPayload(payload: unknown): RemoteCatalogEntry[] {
  const records = Array.isArray(payload) ? payload : payload && typeof payload === "object" ? ((payload as { entries?: unknown; tracks?: unknown; songs?: unknown }).entries ?? (payload as { tracks?: unknown }).tracks ?? (payload as { songs?: unknown }).songs) : undefined;
  if (!Array.isArray(records)) throw new Error("カタログは配列、または entries / tracks / songs 配列を含むJSONである必要があります。");
  const entries = records.flatMap((record, index): RemoteCatalogEntry[] => {
    if (!record || typeof record !== "object") return [];
    const value = record as Record<string, unknown>;
    const rawMdrUrl = stringValue(value.mdrUrl) ?? stringValue(value.mdr) ?? stringValue(value.url);
    const mdrUrl = rawMdrUrl ? normalizeRemoteAssetUrl(rawMdrUrl) : undefined;
    if (!mdrUrl) return [];
    const title = stringValue(value.title) ?? stringValue(value.name) ?? `MDR ${index + 1}`;
    const tags = Array.isArray(value.tags) ? value.tags.flatMap((tag) => stringValue(tag) ? [stringValue(tag)!] : []) : [];
    const rawPdxUrl = stringValue(value.pdxUrl) ?? stringValue(value.pdx);
    return [{ id: stringValue(value.id) ?? mdrUrl, title, mdrUrl, pdxUrl: rawPdxUrl ? normalizeRemoteAssetUrl(rawPdxUrl) : undefined, artist: stringValue(value.artist) ?? stringValue(value.composer), tags }];
  });
  if (!entries.length) throw new Error("MDR URLを持つ項目がカタログに見つかりませんでした。");
  return entries;
}

export async function fetchRemoteCatalog(url: string): Promise<RemoteCatalogEntry[]> {
  const resolvedUrl = normalizeRemoteAssetUrl(url);
  let response: Response;
  try {
    response = await fetch(resolvedUrl, { mode: "cors" });
  } catch {
    throw remoteFetchFailure("カタログ", url);
  }
  if (!response.ok) throw new Error(isGoogleDriveShareUrl(url) ? `カタログをGoogle Driveから取得できませんでした（HTTP ${response.status}）。共有リンク、閲覧権限、ダウンロード制限を確認してください。` : `カタログURLの取得に失敗しました（HTTP ${response.status}）。`);
  try {
    return parseRemoteCatalogPayload(await response.json());
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error("カタログはJSON形式である必要があります。");
    throw error;
  }
}

type GsSynth = {
  isReady: Promise<unknown>;
  connect(destination: AudioNode): AudioNode;
  soundBankManager: { addSoundBank(buffer: ArrayBuffer, id: string, bankOffset?: number): Promise<void>; deleteSoundBank(id: string): Promise<void> };
  noteOn(channel: number, midiNote: number, velocity: number, options?: { time: number }): void;
  noteOff(channel: number, midiNote: number, options?: { time: number }): void;
  sendMessage?(message: Iterable<number>, channelOffset?: number, options?: { time: number }): void;
  systemExclusive?(messageData: number[] | Iterable<number> | Uint8Array, channelOffset?: number, options?: { time: number }): void;
  stopAll(force?: boolean): void;
  destroy(): void;
};

function gsPartReceive(part: number, enabled: boolean): number[] {
  const index = Math.max(0, Math.min(15, Math.floor(part) - 1));
  const address = [0x40, GS_PART_ADDRESS[index], 0x02];
  const data = enabled ? index : 0x10;
  const checksum = (128 - ((address[0] + address[1] + address[2] + data) % 128)) & 0x7f;
  return [0xf0, 0x41, 0x10, 0x42, 0x12, ...address, data, checksum, 0xf7];
}

let midiEventsModulePromise: Promise<MadrvWasmModule> | undefined;

type ExtractedMdrMidiTimeline = {
  events: ScheduledMdrMidiEvent[];
  loopWindow?: MdrMidiLoopWindow;
};

async function extractMdrMidiEvents(mdr: ArrayBuffer, loops: number, sampleRate: number): Promise<ExtractedMdrMidiTimeline> {
  midiEventsModulePromise ??= (async () => {
    const imported = await import(/* @vite-ignore */ MIDI_EVENTS_MODULE_URL) as { default: MadrvWasmFactory };
    return imported.default({ locateFile: (file) => file.endsWith(".wasm") ? MIDI_EVENTS_WASM_URL : file });
  })();
  const module = await midiEventsModulePromise;
  const source = new Uint8Array(mdr);
  const sourcePointer = module._malloc(source.length);
  module.HEAPU8.set(source, sourcePointer);
  try {
    const extract = module._madrv_extract_midi as (pointer: number, length: number, loops: number, sampleRate: number) => number;
    const size = extract(sourcePointer, source.length, Math.max(1, Math.min(99, loops)), resolvePlaybackSampleRate(sampleRate));
    if (size <= 0) return { events: [] };
    const target = module._malloc(size);
    try {
      const copy = module._madrv_copy_midi as (pointer: number, capacity: number) => number;
      if (copy(target, size) !== size) throw new Error("MDRのMIDI／SysExイベントを取得できませんでした。");
      const bytes = module.HEAPU8.slice(target, target + size);
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const count = view.getUint32(0, true);
      const events: ScheduledMdrMidiEvent[] = [];
      let offset = 4;
      for (let index = 0; index < count; index += 1) {
        if (offset + 16 > bytes.length) throw new Error("MDRのMIDIイベント列が途中で終了しています。");
        const microseconds = Number(view.getBigUint64(offset, true));
        offset += 8;
        const sourceTrack = view.getUint32(offset, true);
        offset += 4;
        const length = view.getUint32(offset, true);
        offset += 4;
        if (offset + length > bytes.length) throw new Error("MDRのMIDIメッセージ長が不正です。");
        events.push({ at: microseconds / 1_000_000, sourceTrack, bytes: Array.from(bytes.slice(offset, offset + length)) });
        offset += length;
      }
      const hasSongLoop = (module._madrv_midi_has_song_loop as (() => number) | undefined)?.() === 1;
      const startSeconds = (module._madrv_midi_loop_start_seconds as (() => number) | undefined)?.();
      const endSeconds = (module._madrv_midi_loop_end_seconds as (() => number) | undefined)?.();
      const loopWindow = hasSongLoop && Number.isFinite(startSeconds) && Number.isFinite(endSeconds) && (startSeconds ?? 0) >= 0 && (endSeconds ?? 0) > (startSeconds ?? 0)
        ? { startSeconds: startSeconds!, endSeconds: endSeconds! }
        : undefined;
      return { events, loopWindow };
    } finally {
      module._free(target);
    }
  } finally {
    module._free(sourcePointer);
  }
}

class MadrvWasmPlayer {
  private converter?: MadrvWasmModule;
  private player?: MadrvWasmModule;
  private active = false;
  private outputSampleRate = MADRV_NATIVE_SAMPLE_RATE;
  private resamplePhase = 0;
  private resampleLeft = new Float32Array(0);
  private resampleRight = new Float32Array(0);
  private resampleAvailableFrames = 0;
  private nativeOutputPointer = 0;
  private nativeOutputCapacityFrames = 0;

  private setOutputSampleRate(sampleRate: number) {
    this.outputSampleRate = resolvePlaybackSampleRate(sampleRate);
    this.resamplePhase = 0;
    this.resampleAvailableFrames = 0;
  }

  private async loadModule(scriptUrl: string, wasmUrl: string): Promise<MadrvWasmModule> {
    const imported = await import(/* @vite-ignore */ scriptUrl) as { default: MadrvWasmFactory };
    return imported.default({ locateFile: (file) => file.endsWith(".wasm") ? wasmUrl : file });
  }

  private copyTo(module: MadrvWasmModule, bytes: Uint8Array): number {
    const pointer = module._malloc(bytes.length);
    module.HEAPU8.set(bytes, pointer);
    return pointer;
  }

  async load(mdr: ArrayBuffer, pdx: ArrayBuffer | undefined, loops: number, sampleRate: number): Promise<MdrPlaybackInfo> {
    const info = inspectMdr(mdr);
    if (mdrRequiresPdx(info.pdxName) && !pdx) throw new Error(`このMDRはPCMデータ「${formatPdxFileName(info.pdxName)}」を必要とします。PDXファイルも指定してください。`);
    // These independent cores can download and instantiate concurrently.
    const [converter, player] = await Promise.all([
      this.converter ?? this.loadModule(CONVERTER_MODULE_URL, CONVERTER_WASM_URL),
      this.player ?? this.loadModule(PLAYER_MODULE_URL, PLAYER_WASM_URL),
    ]);
    this.converter = converter;
    this.player = player;
    const source = new Uint8Array(mdr);
    const sourcePointer = this.copyTo(this.converter, source);
    try {
      const convert = this.converter._madrv_convert_mdr as (pointer: number, length: number) => number;
      let size = 0;
      try {
        size = convert(sourcePointer, source.length);
      } catch (error) {
        throw asPlaybackError(error, "MDRをOPM／PDX再生用データへ変換できませんでした。");
      }
      if (size <= 0) throw new Error("MDRをOPM／PDX再生用データへ変換できませんでした。");
      const convertedPointer = this.converter._malloc(size);
      try {
        const copyConverted = this.converter._madrv_copy_converted as (pointer: number, capacity: number) => number;
        if (copyConverted(convertedPointer, size) !== size) throw new Error("MDR変換データの読込に失敗しました。");
        const initialize = this.player._mdx_player_init as (sampleRate: number) => number;
        if (initialize(MADRV_NATIVE_SAMPLE_RATE) !== 0) throw new Error("OPM／PDX再生コアを初期化できませんでした。");
        this.setOutputSampleRate(sampleRate);
        const pdxBytes = pdx ? new Uint8Array(pdx) : new Uint8Array();
        const mdxPointer = this.copyTo(this.player, this.converter.HEAPU8.slice(convertedPointer, convertedPointer + size));
        const pdxPointer = pdxBytes.length ? this.copyTo(this.player, pdxBytes) : 0;
        try {
          const load = this.player._mdx_player_load as (mdxPointer: number, mdxSize: number, pdxPointer: number, pdxSize: number) => number;
          if (load(mdxPointer, size, pdxPointer, pdxBytes.length) !== 0) throw new Error("OPM／PDX再生コアへMDRデータを設定できませんでした。PDXの組合せを確認してください。");
          const measure = this.player._mdx_player_measure as (loopCount: number, fadeout: number) => number;
          const durationMs = measure(Math.max(1, Math.min(99, loops)), 0);
          if (durationMs <= 0) throw new Error("MDRの再生時間を計測できませんでした。");
          this.active = true;
          return { duration: durationMs / 1000, format: "MDR / OPM + PDX" };
        } finally {
          this.player._free(mdxPointer);
          if (pdxPointer) this.player._free(pdxPointer);
        }
      } finally {
        this.converter._free(convertedPointer);
      }
    } finally {
      this.converter._free(sourcePointer);
    }
  }

  async loadMdx(mdx: ArrayBuffer, pdx: ArrayBuffer | undefined, loops: number, sampleRate: number): Promise<MdrPlaybackInfo> {
    this.player ??= await this.loadModule(PLAYER_MODULE_URL, PLAYER_WASM_URL);
    const initialize = this.player._mdx_player_init as (sampleRate: number) => number;
    if (initialize(MADRV_NATIVE_SAMPLE_RATE) !== 0) throw new Error("OPM／PDX再生コアを初期化できませんでした。");
    this.setOutputSampleRate(sampleRate);
    const mdxBytes = new Uint8Array(mdx);
    const pdxBytes = pdx ? new Uint8Array(pdx) : new Uint8Array();
    const mdxPointer = this.copyTo(this.player, mdxBytes);
    const pdxPointer = pdxBytes.length ? this.copyTo(this.player, pdxBytes) : 0;
    try {
      const load = this.player._mdx_player_load as (mdxPointer: number, mdxSize: number, pdxPointer: number, pdxSize: number) => number;
      if (load(mdxPointer, mdxBytes.length, pdxPointer, pdxBytes.length) !== 0) throw new Error("MDXをOPM／PDX再生コアへ設定できませんでした。必要なPDXファイルとの組合せを確認してください。");
      const measure = this.player._mdx_player_measure as (loopCount: number, fadeout: number) => number;
      const durationMs = measure(Math.max(1, Math.min(99, loops)), 0);
      if (durationMs <= 0) throw new Error("MDXの再生時間を計測できませんでした。ファイル形式を確認してください。");
      this.active = true;
      return { duration: durationMs / 1000, format: "MDX / OPM + PDX" };
    } finally {
      this.player._free(mdxPointer);
      if (pdxPointer) this.player._free(pdxPointer);
    }
  }

  measureDuration(loopCount: number): number {
    if (!this.player || !this.active) throw new Error("MDR再生コアが準備できていません。");
    const measure = this.player._mdx_player_measure as (loops: number, fadeout: number) => number;
    const durationMs = measure(Math.max(1, Math.min(99, Math.floor(loopCount))), 0);
    if (durationMs <= 0) throw new Error("MDR／MDXの再生時間を計測できませんでした。");
    return durationMs / 1000;
  }

  start(loopCount = 1) { if (!this.player || !this.active) throw new Error("MDR再生コアが準備できていません。"); const play = this.player._mdx_player_play as (loops: number) => number; play(loopCount <= 0 ? 0 : Math.min(99, Math.floor(loopCount))); }

  setChannelMask(mask: number) { if (!this.player || !this.active) return; const setMask = this.player._mdx_player_set_channel_mask as (value: number) => number; setMask(mask); }

  getPcmActiveMask(): number {
    if (!this.player || !this.active) return 0;
    const getMask = this.player._mdx_player_get_pcm_active_mask as () => number;
    return getMask() & 0xff;
  }

  getHardwareTrackMidiNote(trackIndex: number): number | null {
    if (!this.player || !this.active) return null;
    const getRawNote = this.player._mdx_player_get_hardware_track_note_raw;
    if (typeof getRawNote !== "function") return null;
    return mxdrvRawNoteToMidiNote((getRawNote as (track: number) => number)(trackIndex));
  }

  getHardwareTrackPitchClass(trackIndex: number): number | null {
    const midiNote = this.getHardwareTrackMidiNote(trackIndex);
    return midiNote === null ? null : midiNote % 12;
  }

  getTimerB(): number | null {
    if (!this.player || !this.active) return null;
    const getTimerB = this.player._mdx_player_get_timer_b;
    if (typeof getTimerB !== "function") return null;
    const value = (getTimerB as () => number)();
    return Number.isInteger(value) && value >= 0 && value <= 255 ? value : null;
  }

  getPlayAtMilliseconds(): number | null {
    if (!this.player || !this.active) return null;
    const getPlayAt = this.player._mdx_player_get_play_at_ms;
    if (typeof getPlayAt !== "function") return null;
    const value = (getPlayAt as () => number)();
    return Number.isFinite(value) && value >= 0 ? value : null;
  }

  isTerminated(): boolean {
    if (!this.player || !this.active) return true;
    const getTerminated = this.player._mdx_player_is_terminated;
    return typeof getTerminated === "function" && (getTerminated as () => number)() !== 0;
  }

  private renderNativeInto(left: Float32Array, right: Float32Array): number {
    if (!this.player || !this.active) {
      left.fill(0);
      right.fill(0);
      return 0;
    }
    const frames = Math.min(left.length, right.length);
    if (this.nativeOutputCapacityFrames < frames) {
      if (this.nativeOutputPointer) this.player._free(this.nativeOutputPointer);
      this.nativeOutputPointer = this.player._malloc(frames * 4);
      this.nativeOutputCapacityFrames = frames;
    }
    const outputPointer = this.nativeOutputPointer;
    const render = this.player._mdx_player_render as (pointer: number, frames: number) => number;
      // MXDRV_GetPCM writes interleaved PCM into the supplied buffer and returns 0 on success.
      // Only negative values are errors; treating 0 as failure discarded every valid MDX/MDR block.
      if (isWasmPcmRenderFailure(render(outputPointer, frames))) {
        left.fill(0);
        right.fill(0);
        return 0;
      }
      const samples = this.player.HEAP16;
      const offset = outputPointer >> 1;
      let peak = 0;
      for (let index = 0; index < frames; index += 1) {
        const leftSample = samples[offset + index * 2] ?? 0;
        const rightSample = samples[offset + index * 2 + 1] ?? 0;
        const leftMagnitude = Math.abs(leftSample);
        const rightMagnitude = Math.abs(rightSample);
        if (leftMagnitude > peak) peak = leftMagnitude;
        if (rightMagnitude > peak) peak = rightMagnitude;
        left[index] = leftSample / 32768;
        right[index] = rightSample / 32768;
      }
      return peak;
  }

  renderInto(left: Float32Array, right: Float32Array): number {
    const frames = Math.min(left.length, right.length);
    if (this.outputSampleRate === MADRV_NATIVE_SAMPLE_RATE) return this.renderNativeInto(left, right);
    const ratio = MADRV_NATIVE_SAMPLE_RATE / this.outputSampleRate;
    const nativeFrames = Math.max(2, Math.floor(this.resamplePhase + Math.max(0, frames - 1) * ratio) + 2);
    if (this.resampleLeft.length < nativeFrames) {
      const capacity = Math.max(nativeFrames, this.resampleLeft.length * 2, 4096);
      const nextLeft = new Float32Array(capacity);
      const nextRight = new Float32Array(capacity);
      nextLeft.set(this.resampleLeft.subarray(0, this.resampleAvailableFrames));
      nextRight.set(this.resampleRight.subarray(0, this.resampleAvailableFrames));
      this.resampleLeft = nextLeft;
      this.resampleRight = nextRight;
    }
    if (this.resampleAvailableFrames < nativeFrames) {
      const missing = nativeFrames - this.resampleAvailableFrames;
      this.renderNativeInto(this.resampleLeft.subarray(this.resampleAvailableFrames, this.resampleAvailableFrames + missing), this.resampleRight.subarray(this.resampleAvailableFrames, this.resampleAvailableFrames + missing));
      this.resampleAvailableFrames = nativeFrames;
    }
    const sourceLeft = this.resampleLeft.subarray(0, this.resampleAvailableFrames);
    const sourceRight = this.resampleRight.subarray(0, this.resampleAvailableFrames);
    const result = resamplePcmFrames(left, right, sourceLeft, sourceRight, this.resamplePhase, MADRV_NATIVE_SAMPLE_RATE, this.outputSampleRate);
    const absoluteEnd = this.resamplePhase + frames * ratio;
    const consumed = Math.floor(absoluteEnd);
    this.resamplePhase = absoluteEnd - consumed;
    if (consumed > 0) {
      this.resampleLeft.copyWithin(0, consumed, this.resampleAvailableFrames);
      this.resampleRight.copyWithin(0, consumed, this.resampleAvailableFrames);
      this.resampleAvailableFrames -= consumed;
    }
    return result.peak;
  }

  stop() { if (this.player && this.active) { const stop = this.player._mdx_player_stop as () => number; stop(); } this.active = false; }
}

/** Measures one finite MDR pass and extends it through the final GS MIDI event for pre-playback metadata. */
export async function estimateMdrPlaybackDuration(mdr: ArrayBuffer, pdx: ArrayBuffer | undefined): Promise<number> {
  const player = new MadrvWasmPlayer();
  const hardware = await player.load(mdr, pdx, 1, 48_000);
  const midiTimeline = await extractMdrMidiEvents(mdr, 1, resolveMdrMidiTimingSampleRate());
  return resolveMdrPlaybackDuration(hardware.duration, midiTimeline.events, midiTimeline.loopWindow);
}

export class SignalDeckAudio {
  private context?: AudioContext;
  private masterGain?: GainNode;
  private gains?: Record<EngineKind, GainNode>;
  private activeNodes: AudioScheduledSourceNode[] = [];
  private timers: number[] = [];
  /** Preserve score order across live-clock corrections; STOP cancels unsent events. */
  private mdrSoundFontQueue = new OrderedMidiQueue<{ bytes: number[]; sourceTrack: number; playbackGeneration: number }>({
    now: () => this.graph.context.currentTime,
    dispatchLeadSeconds: () => resolveMdrMidiDispatchLeadSeconds(this.performanceProfile),
    schedule: (callback, delayMs) => window.setTimeout(callback, delayMs),
    cancel: (timer) => window.clearTimeout(timer),
    dispatch: ({ bytes, sourceTrack, playbackGeneration }, targetAt) => {
      if (!shouldDispatchQueuedSoundFontMdrEvent(playbackGeneration, this.playbackGeneration, this.gsLoaded)) return;
      // Preserve the original deadline for the cancellable Worklet so its
      // receipt/application telemetry exposes late main-thread submissions.
      this.sendMdrMidi(bytes, sourceTrack, 0, this.gsMidiPort ? targetAt : Math.max(this.graph.context.currentTime, targetAt));
    },
  });
  private endTimer?: number;
  private mdrMidiAnimationFrame?: number;
  private mdrMidiTimer?: number;
  private mdrMidiTimelineComplete = true;
  private mdrAudioTimeline?: MdrAudioTimeline;
  private mdrMidiPump?: () => void;
  private gsMidiPort?: MessagePort;
  private mdrMidiSchedulingStats: MdrMidiSchedulingStats | null = null;
  private mdrMidiMuteVersions = new Map<number, number>();
  /** Keyboard telemetry follows playback time even when audio is reserved a full block ahead. */
  private mdrMidiVisualQueue = new OrderedMidiQueue<{ bytes: number[]; sourceTrack: number; generation: number; muteVersion: number }>({
    now: () => this.graph.context.currentTime,
    schedule: (callback, delayMs) => window.setTimeout(callback, delayMs),
    cancel: timer => window.clearTimeout(timer),
    dispatch: ({ bytes, sourceTrack, generation, muteVersion }) => {
      if (generation === this.playbackGeneration && muteVersion === (this.mdrMidiMuteVersions.get(sourceTrack) ?? 0)
        && !this.mutedMdrTracks.has(sourceTrack)) this.updateMdrMidiTrackKeys(bytes, sourceTrack);
    },
  });
  /**
   * Large stable-profile audio blocks can contain several short OPM notes. Keep
   * their key states on the rendered audio timeline instead of sampling only
   * the final state at the end of the block.
   */
  private mdrHardwareVisualQueue = new OrderedMidiQueue<{ snapshot: MdrTrackKeyState; generation: number }>({
    now: () => this.graph.context.currentTime,
    schedule: (callback, delayMs) => window.setTimeout(callback, delayMs),
    cancel: timer => window.clearTimeout(timer),
    dispatch: ({ snapshot, generation }) => {
      if (generation === this.playbackGeneration) this.applyHardwareTrackKeys(snapshot);
    },
  });
  /** Latest planned or actually submitted MIDI timestamp, including late dispatch. */
  private mdrMidiLastEventAt: number | null = null;
  private gsSynth?: GsSynth;
  private gsLoaded = false;
  private workletReady?: Promise<void>;
  private midiOutput?: MIDIOutput;
  private recording = false;
  private mediaDestination?: MediaStreamAudioDestinationNode;
  private mdrNode?: ScriptProcessorNode;
  private mdrWorklet?: AudioWorkletNode;
  private mdrWorkletReady?: Promise<void>;
  private mdrWorkletWasm?: Promise<{ converter: ArrayBuffer; player: ArrayBuffer }>;
  private mdrPlayer?: MadrvWasmPlayer;
  private diagnostics: MidiDiagnosticEntry[] = [];
  private diagnosticListener?: (entries: MidiDiagnosticEntry[]) => void;
  private outputPeakListener?: (peak: number) => void;
  private pcmActivityListener?: (mask: number) => void;
  private mdrTrackKeyListener?: (state: MdrTrackKeyState) => void;
  private timerBListener?: (value: number | null) => void;
  private hardwarePlaybackPositionListener?: (milliseconds: number | null) => void;
  private mdrMidiSyncListener?: (snapshot: MdrMidiSyncSnapshot | null) => void;
  private lastMidiSyncUpdateAt = Number.NEGATIVE_INFINITY;
  private reportedTimerB: number | null = null;
  private mutedMdrTracks = new Set<number>();
  private mdrTrackKeys: MdrTrackKeyState = {};
  private mdrHardwareTrackIndexes: number[] = [];
  private publishedMdrTrackKeys: MdrTrackKeyState = {};
  private trackKeyPublishTimer?: number;
  private lastTrackKeyPublishAt = Number.NEGATIVE_INFINITY;
  private performanceProfile: PlaybackPerformanceProfile = "desktop";
  private safariCompatibilityMode = false;
  private lastProgressUpdateAt = Number.NEGATIVE_INFINITY;
  private lastRealtimeVisualUpdateAt = Number.NEGATIVE_INFINITY;
  private audioCallbackAt = new Map<string, number>();
  /** Increments on every stop so callbacks from a superseded source cannot update the active transport. */
  private playbackGeneration = 0;
  private externalMidiAdvanceMs = 0;
  private soundFontMdrDelayMs = 0;
  private midiOutputLevel = 0.72;
  private mdrSoundFontMuted = false;

  private get graph() {
    if (this.context && this.masterGain && this.gains) return { context: this.context, master: this.masterGain, gains: this.gains };
    const context = new AudioContext({ sampleRate: MADRV_NATIVE_SAMPLE_RATE });
    const master = context.createGain();
    master.gain.value = 0.78;
    master.connect(context.destination);
    const gains = {
      opm: context.createGain(),
      pcm: context.createGain(),
      midi: context.createGain(),
    };
    Object.values(gains).forEach((gain) => gain.connect(master));
    gains.opm.gain.value = 0.82;
    gains.pcm.gain.value = 0.63;
    gains.midi.gain.value = 0.72;
    this.context = context;
    this.masterGain = master;
    this.gains = gains;
    return { context, master, gains };
  }

  private silenceMdrSoundFont() {
    const { context, gains } = this.graph;
    this.mdrSoundFontMuted = true;
    const now = context.currentTime;
    gains.midi.gain.cancelScheduledValues(now);
    gains.midi.gain.setValueAtTime(gains.midi.gain.value, now);
    gains.midi.gain.setTargetAtTime(0, now, 0.004);
  }

  private restoreMdrSoundFont() {
    const { context, gains } = this.graph;
    this.mdrSoundFontMuted = false;
    const now = context.currentTime;
    gains.midi.gain.cancelScheduledValues(now);
    gains.midi.gain.setValueAtTime(gains.midi.gain.value, now);
    gains.midi.gain.setTargetAtTime(this.midiOutputLevel, now, 0.008);
  }

  getSampleRate(): number {
    return this.graph.context.sampleRate;
  }

  getAudioLatencyInfo(): { sampleRate: number; outputLatencySeconds: number; baseLatencySeconds: number } {
    const { context } = this.graph;
    return {
      sampleRate: context.sampleRate,
      outputLatencySeconds: Number.isFinite(context.outputLatency) ? context.outputLatency : 0,
      baseLatencySeconds: Number.isFinite(context.baseLatency) ? context.baseLatency : 0,
    };
  }

  setPerformanceProfile(profile: PlaybackPerformanceProfile, safariCompatibilityMode = false) {
    this.performanceProfile = profile;
    this.safariCompatibilityMode = safariCompatibilityMode;
    this.lastProgressUpdateAt = Number.NEGATIVE_INFINITY;
    this.lastRealtimeVisualUpdateAt = Number.NEGATIVE_INFINITY;
  }

  private shouldPublishProgress(force = false): boolean {
    const now = performance.now();
    if (!force && now - this.lastProgressUpdateAt < resolveProgressUpdateIntervalMs(this.performanceProfile, this.safariCompatibilityMode)) return false;
    this.lastProgressUpdateAt = now;
    return true;
  }

  private publishProgress(onProgress: (seconds: number) => void, seconds: number, force = false) {
    if (this.shouldPublishProgress(force)) onProgress(seconds);
  }

  private shouldPublishRealtimeVisuals(): boolean {
    const now = performance.now();
    if (now - this.lastRealtimeVisualUpdateAt < resolveRealtimeVisualUpdateIntervalMs(this.performanceProfile, this.safariCompatibilityMode)) return false;
    this.lastRealtimeVisualUpdateAt = now;
    return true;
  }

  private noteAudioCallback(stream: "opm" | "pcm", frames: number) {
    const now = performance.now();
    const previous = this.audioCallbackAt.get(stream);
    this.audioCallbackAt.set(stream, now);
    const expectedMs = (frames / this.graph.context.sampleRate) * 1000;
    if (previous !== undefined && now - previous > expectedMs * 1.8) {
      console.warn(`[MADRV audio] ${stream.toUpperCase()} callback late: ${(now - previous).toFixed(1)} ms (budget ${expectedMs.toFixed(1)} ms)`);
    }
  }

  private async ensureMadrvWorklet(): Promise<void> {
    const { context } = this.graph;
    if (!context.audioWorklet) throw new Error("AudioWorklet is unavailable");
    if (!this.mdrWorkletReady) {
      this.mdrWorkletReady = context.audioWorklet.addModule(MDX_WORKLET_PROCESSOR_URL).catch((error) => {
        this.mdrWorkletReady = undefined;
        throw error;
      });
    }
    await this.mdrWorkletReady;
  }

  private async getMadrvWorkletWasm(): Promise<{ converter: ArrayBuffer; player: ArrayBuffer }> {
    this.mdrWorkletWasm ??= Promise.all([
      fetch(CONVERTER_WASM_URL).then(async (response) => {
        if (!response.ok) throw new Error(`コンバーターWASMを取得できませんでした（HTTP ${response.status}）。`);
        return response.arrayBuffer();
      }),
      fetch(PLAYER_WASM_URL).then(async (response) => {
        if (!response.ok) throw new Error(`プレーヤーWASMを取得できませんでした（HTTP ${response.status}）。`);
        return response.arrayBuffer();
      }),
    ]).then(([converter, player]) => ({ converter, player })).catch((error) => {
      this.mdrWorkletWasm = undefined;
      throw error;
    });
    return this.mdrWorkletWasm;
  }

  private reportHardwareTrackKeysFromRaw(rawNotes: unknown) {
    if (!Array.isArray(rawNotes)) return;
    let next: MdrTrackKeyState | undefined;
    for (const track of this.mdrHardwareTrackIndexes) {
      if (track >= rawNotes.length) continue;
      const midiNote = mxdrvRawNoteToMidiNote(Number(rawNotes[track]));
      const current = this.mdrTrackKeys[track];
      if (midiNote === null) {
        if (!current) continue;
        next ??= { ...this.mdrTrackKeys };
        delete next[track];
        continue;
      }
      if (current?.length === 1 && current[0] === midiNote) continue;
      next ??= { ...this.mdrTrackKeys };
      next[track] = [midiNote];
    }
    if (!next) return;
    this.mdrTrackKeys = next;
    this.publishMdrTrackKeys();
  }

  private handleMadrvWorkletMessage(data: unknown) {
    if (!data || typeof data !== "object") return;
    const message = data as { type?: unknown; message?: unknown; peak?: unknown; pcmMask?: unknown; timer?: unknown; keys?: unknown };
    if (message.type !== "status") return;
    this.outputPeakListener?.(Number.isFinite(message.peak) ? Number(message.peak) : 0);
    this.reportPcmActivity(Number.isFinite(message.pcmMask) ? Number(message.pcmMask) : 0);
    this.reportTimerB(Number.isInteger(message.timer) && Number(message.timer) >= 0 && Number(message.timer) <= 255 ? Number(message.timer) : null);
    this.reportHardwareTrackKeysFromRaw(message.keys);
  }

  private async startMadrvWorklet(format: "mdr" | "mdx", source: ArrayBuffer, pdx: ArrayBuffer | undefined): Promise<void> {
    const { context, gains } = this.graph;
    await this.ensureMadrvWorklet();
    const node = new AudioWorkletNode(context, "madrv-mdx-renderer", { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2] });
    const ready = new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error("AudioWorkletの初期化がタイムアウトしました。")), 10_000);
      node.port.onmessage = (event) => {
        const data = event.data as { type?: string; message?: string };
        if (data.type === "ready") {
          window.clearTimeout(timeout);
          resolve();
          return;
        }
        if (data.type === "error") {
          window.clearTimeout(timeout);
          reject(new Error(data.message ?? "AudioWorkletの初期化に失敗しました。"));
          return;
        }
        this.handleMadrvWorkletMessage(data);
      };
    });
    const sourceCopy = source.slice(0);
    const pdxCopy = pdx?.slice(0);
    const wasm = await this.getMadrvWorkletWasm();
    const converterWasm = wasm.converter.slice(0);
    const playerWasm = wasm.player.slice(0);
    node.port.postMessage({
      type: "configure",
      format,
      source: sourceCopy,
      pdx: pdxCopy,
      sampleRate: resolvePlaybackSampleRate(context.sampleRate),
      wasm: {
        converter: converterWasm,
        player: playerWasm,
      },
    }, pdxCopy ? [sourceCopy, pdxCopy, converterWasm, playerWasm] : [sourceCopy, converterWasm, playerWasm]);
    try {
      await ready;
      node.connect(gains.opm);
      this.mdrWorklet = node;
      this.mdrWorklet?.port.postMessage({ type: "channel-mask", mask: Array.from(this.mutedMdrTracks).filter((index) => index < 16).reduce((mask, index) => mask | (1 << index), 0) });
    } catch (error) {
      node.disconnect();
      throw error;
    }
  }

  private getMediaDestination() {
    const { context, master } = this.graph;
    if (!this.mediaDestination) {
      this.mediaDestination = context.createMediaStreamDestination();
      master.connect(this.mediaDestination);
    }
    return this.mediaDestination;
  }

  private async ensureSpessaWorklet(): Promise<void> {
    const { context } = this.graph;
    if (!context.audioWorklet) throw new Error("このブラウザはAudioWorkletに対応していないため、内蔵SoundFontを初期化できません。外部MIDI機器または対応ブラウザを使用してください。");
    if (!this.workletReady) {
      this.workletReady = context.audioWorklet.addModule(SPESSA_PROCESSOR_URL).catch((error) => {
        this.workletReady = undefined;
        throw error;
      });
    }
    await this.workletReady;
  }

  setMaster(value: number) { this.graph.master.gain.setTargetAtTime(value / 100, this.graph.context.currentTime, 0.015); }
  setLevel(engine: EngineKind, value: number) {
    const next = value / 100;
    if (engine === "midi") this.midiOutputLevel = next;
    if (engine === "midi" && this.mdrSoundFontMuted) return;
    this.graph.gains[engine].gain.setTargetAtTime(next, this.graph.context.currentTime, 0.015);
  }
  setExternalMidiAdvanceMs(value: number) { this.externalMidiAdvanceMs = normalizeExternalMidiAdvanceMs(value); }
  setSoundFontMdrDelayMs(value: number) { this.soundFontMdrDelayMs = normalizeSoundFontMdrDelayMs(value); }

  setDiagnosticListener(listener: ((entries: MidiDiagnosticEntry[]) => void) | undefined) {
    this.diagnosticListener = listener;
    listener?.([...this.diagnostics]);
  }

  setOutputPeakListener(listener: ((peak: number) => void) | undefined) {
    this.outputPeakListener = listener;
  }

  setPcmActivityListener(listener: ((mask: number) => void) | undefined) {
    this.pcmActivityListener = listener;
    listener?.(0);
  }

  setMdrTrackKeyListener(listener: ((state: MdrTrackKeyState) => void) | undefined) {
    this.mdrTrackKeyListener = listener;
    this.publishMdrTrackKeys(true);
  }

  setTimerBListener(listener: ((value: number | null) => void) | undefined) {
    this.timerBListener = listener;
    listener?.(this.reportedTimerB);
  }

  setHardwarePlaybackPositionListener(listener: ((milliseconds: number | null) => void) | undefined) {
    this.hardwarePlaybackPositionListener = listener;
    listener?.(null);
  }

  setMdrMidiSyncListener(listener: ((snapshot: MdrMidiSyncSnapshot | null) => void) | undefined) {
    this.mdrMidiSyncListener = listener;
    listener?.(null);
  }

  private resetPcmActivity() {
    this.pcmActivityListener?.(0);
  }

  private reportPcmActivity(mask: number) {
    this.pcmActivityListener?.(mask & 0xff);
  }

  private reportTimerB(value: number | null) {
    if (this.reportedTimerB === value) return;
    this.reportedTimerB = value;
    this.timerBListener?.(value);
  }

  private reportHardwarePlaybackPosition(milliseconds: number | null) {
    this.hardwarePlaybackPositionListener?.(milliseconds);
  }

  private publishMdrTrackKeys(force = false) {
    if (force || !this.mdrTrackKeyListener) {
      if (this.trackKeyPublishTimer !== undefined) window.clearTimeout(this.trackKeyPublishTimer);
      this.trackKeyPublishTimer = undefined;
    }
    if (!this.mdrTrackKeyListener) return;
    const now = performance.now();
    const remainingMs = resolveRealtimeVisualUpdateIntervalMs(this.performanceProfile, this.safariCompatibilityMode) - (now - this.lastTrackKeyPublishAt);
    if (!force && remainingMs > 0) {
      if (this.trackKeyPublishTimer === undefined) {
        this.trackKeyPublishTimer = window.setTimeout(() => {
          this.trackKeyPublishTimer = undefined;
          this.publishMdrTrackKeys();
        }, remainingMs);
      }
      return;
    }
    if (this.trackKeyPublishTimer !== undefined) window.clearTimeout(this.trackKeyPublishTimer);
    this.trackKeyPublishTimer = undefined;
    // Notes are replaced, never mutated. Retain each unchanged array so the
    // memoized keyboards only render tracks whose visible notes changed.
    const visible: MdrTrackKeyState = {};
    for (const [track, pitches] of Object.entries(this.mdrTrackKeys)) {
      const index = Number(track);
      if (this.mutedMdrTracks.has(index)) continue;
      const previous = this.publishedMdrTrackKeys[index];
      visible[index] = previous?.length === pitches.length && previous.every((note, i) => note === pitches[i]) ? previous : pitches;
    }
    const changed = Object.keys(visible).length !== Object.keys(this.publishedMdrTrackKeys).length
      || Object.entries(visible).some(([track, pitches]) => pitches !== this.publishedMdrTrackKeys[Number(track)]);
    this.lastTrackKeyPublishAt = now;
    if (!force && !changed) return;
    this.publishedMdrTrackKeys = visible;
    this.mdrTrackKeyListener(visible);
  }

  private resetMdrTrackKeys() {
    this.mdrTrackKeys = {};
    this.publishMdrTrackKeys(true);
  }

  private readHardwareTrackKeys(): MdrTrackKeyState {
    const snapshot: MdrTrackKeyState = {};
    if (!this.mdrPlayer) return snapshot;
    for (const track of this.mdrHardwareTrackIndexes) {
      const midiNote = this.mdrPlayer.getHardwareTrackMidiNote(track);
      if (midiNote !== null) snapshot[track] = [midiNote];
    }
    return snapshot;
  }

  private applyHardwareTrackKeys(snapshot: MdrTrackKeyState) {
    let next: MdrTrackKeyState | undefined;
    for (const track of this.mdrHardwareTrackIndexes) {
      const current = this.mdrTrackKeys[track];
      const notes = snapshot[track];
      if (!notes) {
        if (!current) continue;
        next ??= { ...this.mdrTrackKeys };
        delete next[track];
        continue;
      }
      if (current?.length === notes.length && current.every((note, index) => note === notes[index])) continue;
      next ??= { ...this.mdrTrackKeys };
      next[track] = notes;
    }
    if (!next) return;
    this.mdrTrackKeys = next;
    this.publishMdrTrackKeys();
  }

  private reportHardwareTrackKeys() {
    this.applyHardwareTrackKeys(this.readHardwareTrackKeys());
  }

  private queueHardwareTrackKeys(targetAt: number) {
    if (!this.mdrTrackKeyListener || !this.mdrPlayer || !this.mdrHardwareTrackIndexes.length) return;
    this.mdrHardwareVisualQueue.enqueue({ snapshot: this.readHardwareTrackKeys(), generation: this.playbackGeneration }, targetAt);
  }

  /** Render in small internal slices so short OPM notes are visible to the UI
   * while retaining the larger ScriptProcessor buffer used for audio stability. */
  private renderMdrOutputBlock(left: Float32Array, right: Float32Array, blockPlaybackTime: number): number {
    if (!this.mdrPlayer) {
      left.fill(0);
      right.fill(0);
      return 0;
    }
    const sampleRate = resolvePlaybackSampleRate(this.graph.context.sampleRate);
    const sliceFrames = this.mdrTrackKeyListener ? 2048 : left.length;
    let peak = 0;
    for (let offset = 0; offset < left.length; offset += sliceFrames) {
      const end = Math.min(left.length, offset + sliceFrames);
      peak = Math.max(peak, this.mdrPlayer.renderInto(left.subarray(offset, end), right.subarray(offset, end)));
      if (this.mdrTrackKeyListener) this.queueHardwareTrackKeys(blockPlaybackTime + end / sampleRate);
    }
    return peak;
  }

  private updateMdrMidiTrackKeys(bytes: number[], sourceTrack: number) {
    const status = bytes[0] & 0xf0;
    // Controller, bend, patch and SysEx traffic does not change the keyboard.
    // Never let that traffic schedule React work on the audio callback thread.
    if (bytes.length < 2 || (status !== 0x80 && status !== 0x90)) return;
    const current = this.mdrTrackKeys[sourceTrack] ?? [];
    const next = updateMidiTrackNotes(current, bytes);
    if (current.length === next.length && current.every((note, index) => note === next[index])) return;
    if (next.length) this.mdrTrackKeys[sourceTrack] = next;
    else delete this.mdrTrackKeys[sourceTrack];
    this.publishMdrTrackKeys();
  }

  getDiagnostics() { return [...this.diagnostics]; }

  setMdrMutedTracks(trackIndexes: number[]) {
    const muted = new Set(trackIndexes.filter((index) => index >= 0 && index < 32));
    for (const track of Array.from(muted)) {
      if (this.mutedMdrTracks.has(track)) continue;
      // The Worklet cancels this track's future notes. Its visual reservations
      // must stay cancelled even if the user unmutes before their deadline.
      this.mdrMidiMuteVersions.set(track, (this.mdrMidiMuteVersions.get(track) ?? 0) + 1);
      if (this.gsMidiPort && track >= 16) delete this.mdrTrackKeys[track];
    }
    this.mutedMdrTracks = muted;
    const hardwareMask = trackIndexes.filter((index) => index >= 0 && index < 16).reduce((mask, index) => mask | (1 << index), 0);
    // MXDRV returns one mixed OPM/PCM stream. ChannelMask only controls muted
    // tracks; it does not expose separate PCM stems, so a second player would
    // emit the same score again and eventually phase against the first.
    this.mdrPlayer?.setChannelMask(hardwareMask);
    this.mdrWorklet?.port.postMessage({ type: "channel-mask", mask: hardwareMask });
    this.gsMidiPort?.postMessage({ type: "madrv-mute", generation: this.playbackGeneration, tracks: Array.from(this.mutedMdrTracks) });
    this.publishMdrTrackKeys(true);
  }

  private addDiagnostic(label: string, bytes: number[], status: MidiDiagnosticEntry["status"] = "sent") {
    const entry: MidiDiagnosticEntry = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      time: new Date().toLocaleTimeString("ja-JP", { hour12: false }),
      device: this.midiOutput?.name ?? "Browser SoundFont",
      label,
      bytes: [...bytes],
      status,
    };
    this.diagnostics = [entry, ...this.diagnostics].slice(0, 80);
    this.diagnosticListener?.([...this.diagnostics]);
  }

  private sendHardware(bytes: number[], label: string, timestamp?: number) {
    if (!this.midiOutput) throw new Error("外部MIDI出力機器を選択してください。");
    try {
      this.midiOutput.send(bytes, timestamp);
      this.addDiagnostic(label, bytes, "sent");
    } catch (error) {
      this.addDiagnostic(label, bytes, "error");
      throw error;
    }
  }

  private assertSoundFontCanBeReplaced() {
    if (this.mdrNode || this.mdrWorklet || this.mdrMidiPump || !this.isMdrMidiPlaybackDrained()) {
      throw new Error("予約済みの音を失わないよう、再生を停止してからSoundFontを変更してください。");
    }
  }

  async loadSoundFontData(data: ArrayBuffer): Promise<void> {
    this.assertSoundFontCanBeReplaced();
    const { context, gains } = this.graph;
    await this.ensureSpessaWorklet();
    const module = await import("spessasynth_lib");
    let port: MessagePort | undefined;
    const synth = new module.WorkletSynthesizer(context, {
      audioNodeCreators: { worklet: (audioContext, _name, options) => {
        const node = new AudioWorkletNode(audioContext, "madrv-spessasynth-worklet", options);
        port = node.port;
        // Install before the library's handler; our private telemetry is not a
        // SpessaSynth protocol message and must not reach that handler.
        node.port.addEventListener("message", event => {
          if (event.data?.type !== "madrv-midi-timing") return;
          event.stopImmediatePropagation();
          if (this.gsMidiPort === node.port) this.handleMdrMidiTiming(event.data);
        });
        return node;
      } },
    }) as unknown as GsSynth;
    try {
      await synth.isReady;
      synth.connect(gains.midi);
      await synth.soundBankManager.addSoundBank(data, "user-gs");
      // Playback may have begun with the old bank while this one was loading.
      // Swapping its Worklet would discard already-reserved notes and CC state.
      this.assertSoundFontCanBeReplaced();
      this.gsSynth?.destroy();
      this.gsSynth = synth;
      this.gsMidiPort = port;
      this.resetMdrMidiScheduler();
      this.gsLoaded = true;
    } catch (error) {
      synth.destroy();
      throw error;
    }
  }

  async loadSoundFont(file: File): Promise<void> {
    await this.loadSoundFontData(await file.arrayBuffer());
  }

  async listMidiOutputs(): Promise<MidiOutputDevice[]> {
    if (!("requestMIDIAccess" in navigator)) {
      this.addDiagnostic("Web MIDI APIはこのブラウザでは利用できません", [], "info");
      return [];
    }
    const access = await navigator.requestMIDIAccess();
    const outputs = Array.from(access.outputs.values());
    this.addDiagnostic(`出力機器を検出: ${outputs.length}台`, [], "info");
    return outputs.map((output) => ({ id: output.id, name: output.name ?? "MIDI Output" }));
  }

  async selectMidiOutput(id: string | undefined): Promise<void> {
    if (!id) {
      this.midiOutput = undefined;
      this.addDiagnostic("出力先をBrowser SoundFontへ切替", [], "info");
      return;
    }
    if (!("requestMIDIAccess" in navigator)) throw new Error("このブラウザはWeb MIDI APIに対応していません。");
    const access = await navigator.requestMIDIAccess();
    const output = Array.from(access.outputs.values()).find((candidate) => candidate.id === id);
    if (!output) throw new Error("選択したMIDI出力機器が見つかりません。接続状態を確認してください。");
    this.midiOutput = output;
    this.addDiagnostic(`外部出力を選択: ${output.name ?? "MIDI Output"}`, [], "info");
  }

  sendGsReset() {
    this.gsSynth?.stopAll(true);
    if (this.midiOutput) this.sendHardware(GS_RESET, "GS Reset");
  }

  setGsPartReceive(part: number, enabled: boolean) {
    if (!this.midiOutput) throw new Error("GS Part設定の送出先となる外部MIDI機器を選択してください。");
    this.sendHardware(gsPartReceive(part, enabled), `GS Part ${part} Rx ${enabled ? "On" : "Off"}`);
    if (!enabled) this.sendHardware([0xb0 | ((part - 1) & 0x0f), 123, 0], `GS Part ${part} All Notes Off`);
  }

  setGsPartProgram(part: number, program: number) {
    const channel = (Math.max(1, Math.min(16, part)) - 1) & 0x0f;
    const value = Math.max(0, Math.min(127, Math.floor(program)));
    const messages = [[0xb0 | channel, 0, 0], [0xb0 | channel, 32, 0], [0xc0 | channel, value]];
    if (this.midiOutput) {
      messages.forEach((message) => this.sendHardware(message, `GS Part ${part} Patch ${value}`));
      return;
    }
    if (!this.gsSynth?.sendMessage) throw new Error("パッチを適用するには、外部MIDI機器またはSoundFontを選択してください。");
    messages.forEach((message) => this.gsSynth?.sendMessage?.(message));
  }

  setGsPartLevel(part: number, level: number) {
    const channel = (Math.max(1, Math.min(16, part)) - 1) & 0x0f;
    const value = Math.max(0, Math.min(127, Math.floor(level)));
    const message = [0xb0 | channel, 7, value];
    if (this.midiOutput) {
      this.sendHardware(message, `GS Part ${part} Level ${value}`);
      return;
    }
    if (!this.gsSynth?.sendMessage) throw new Error("レベルを適用するには、外部MIDI機器またはSoundFontを選択してください。");
    this.gsSynth.sendMessage(message);
  }

  testExternalGs(part = 1): string {
    if (!this.midiOutput) throw new Error("先に外部MIDI機器を選択してください。");
    const channel = (Math.max(1, Math.min(16, part)) - 1) & 0x0f;
    this.sendHardware(GS_RESET, "GS診断: Reset");
    this.sendHardware(gsPartReceive(part, true), `GS診断: Part ${part} Rx On`);
    this.sendHardware([0xb0 | channel, 7, 100], `GS診断: Part ${part} Level`);
    this.sendHardware([0xc0 | channel, 0], `GS診断: Part ${part} Patch`);
    this.sendHardware([0x90 | channel, 60, 96], `GS診断: Part ${part} C4 Note On`);
    this.timers.push(window.setTimeout(() => {
      if (!this.midiOutput) return;
      this.sendHardware([0x80 | channel, 60, 0], `GS診断: Part ${part} C4 Note Off`);
      this.sendHardware([0xb0 | channel, 123, 0], `GS診断: Part ${part} All Notes Off`);
    }, 420));
    return this.midiOutput.name ?? "外部MIDI機器";
  }

  private sendMdrMidi(bytes: number[], sourceTrack: number, advanceMs = 0, scheduleAt?: number) {
    if (bytes.length === 0) return;
    this.mdrMidiLastEventAt = Math.max(this.mdrMidiLastEventAt ?? 0, this.graph.context.currentTime, scheduleAt ?? 0);
    if (this.gsMidiPort && !this.midiOutput) {
      const targetAt = scheduleAt ?? this.graph.context.currentTime;
      this.gsMidiPort.postMessage({ type: "madrv-midi", generation: this.playbackGeneration, sourceTrack, bytes, targetAt });
      if ((bytes[0] & 0xe0) === 0x80) this.mdrMidiVisualQueue.enqueue({ bytes, sourceTrack, generation: this.playbackGeneration,
        muteVersion: this.mdrMidiMuteVersions.get(sourceTrack) ?? 0 }, targetAt);
      return;
    }
    this.updateMdrMidiTrackKeys(bytes, sourceTrack);
    if (this.midiOutput) {
      const correction = normalizeExternalMidiAdvanceMs(advanceMs);
      const timestamp = scheduleAt === undefined ? undefined : performance.now() + Math.max(0, (scheduleAt - this.graph.context.currentTime) * 1000);
      this.sendHardware(bytes, `MDR MIDI Track ${sourceTrack + 1}${correction ? ` · ${correction > 0 ? "advance" : "delay"} ${Math.abs(correction)} ms` : ""}`, timestamp);
      return;
    }
    const options = scheduleAt === undefined ? undefined : { time: scheduleAt };
    const status = bytes[0] & 0xf0;
    const channel = bytes[0] & 0x0f;
    if (status === 0x90 && bytes.length >= 3) {
      if (bytes[2] === 0) this.gsSynth?.noteOff(channel, bytes[1], options);
      else if (this.gsLoaded) this.gsSynth?.noteOn(channel, bytes[1], bytes[2], options);
    } else if (status === 0x80 && bytes.length >= 2) {
      this.gsSynth?.noteOff(channel, bytes[1], options);
    } else if (bytes[0] === 0xf0) {
      const isGsReset = bytes.join(",") === GS_RESET.join(",");
      if (shouldStopGsSynthImmediatelyForMdrReset(isGsReset, scheduleAt, this.graph.context.currentTime)) this.gsSynth?.stopAll(true);
      this.gsSynth?.systemExclusive?.(bytes.slice(1), 0, options);
    } else {
      this.gsSynth?.sendMessage?.(bytes, 0, options);
    }
  }

  private queueSoundFontMdrMidi(bytes: number[], sourceTrack: number, targetAt: number, playbackGeneration: number, scheduleInWorklet = false) {
    // Independent timers could send a pitch reset before an older bend whose
    // deadline was computed against the previous hardware-clock sample.
    this.mdrSoundFontQueue.enqueue({ bytes, sourceTrack, playbackGeneration }, targetAt, scheduleInWorklet);
  }

  private hasMdrMidiTailElapsed(): boolean {
    const lastEventAt = Math.max(this.mdrMidiLastEventAt ?? Number.NEGATIVE_INFINITY, this.mdrSoundFontQueue.latestTargetAt ?? Number.NEGATIVE_INFINITY);
    return this.mdrSoundFontQueue.pendingCount === 0
      && this.graph.context.currentTime >= lastEventAt + MDR_MIDI_RELEASE_SECONDS;
  }

  private isMdrMidiPlaybackDrained(): boolean {
    return this.mdrMidiTimelineComplete && this.hasMdrMidiTailElapsed();
  }

  getMdrMidiSchedulingStats(): MdrMidiSchedulingStats | null {
    return this.mdrMidiSchedulingStats ? { ...this.mdrMidiSchedulingStats } : null;
  }

  private resetMdrMidiScheduler() {
    this.mdrMidiSchedulingStats = null;
    this.gsMidiPort?.postMessage({ type: "madrv-reset", generation: this.playbackGeneration });
    this.gsMidiPort?.postMessage({ type: "madrv-mute", generation: this.playbackGeneration, tracks: Array.from(this.mutedMdrTracks) });
  }

  private handleMdrMidiTiming(data: MdrMidiSchedulingStats) {
    if (data.generation !== this.playbackGeneration) return;
    this.mdrMidiSchedulingStats = { generation: data.generation, appliedCount: data.appliedCount, lateCount: data.lateCount, maxLateSeconds: data.maxLateSeconds, receivedLateCount: data.receivedLateCount, maxReceiptLateSeconds: data.maxReceiptLateSeconds, lastAppliedAt: data.lastAppliedAt, lastTargetAt: data.lastTargetAt, pendingCount: data.pendingCount };
    if (data.appliedCount === 0 || data.lastTargetAt === null || data.lastAppliedAt === null || !Number.isFinite(data.lastTargetAt) || !Number.isFinite(data.lastAppliedAt)) return;
    this.mdrMidiSyncListener?.({ kind: "worklet-dispatch", scheduledSeconds: data.lastTargetAt, dispatchedSeconds: data.lastAppliedAt, hardwareMilliseconds: this.mdrPlayer?.getPlayAtMilliseconds() ?? null });
  }

  private startMdrMidiTimeline(events: readonly ScheduledMdrMidiEvent[], startsAt: number, loopWindow?: MdrMidiLoopWindow) {
    if (!events.length) {
      this.mdrMidiTimelineComplete = true;
      return;
    }
    const { context } = this.graph;
    const playbackGeneration = this.playbackGeneration;
    const hardwareOutput = Boolean(this.midiOutput);
    const lookaheadSeconds = hardwareOutput ? 0 : resolveMdrMidiLookaheadSeconds(this.performanceProfile);
    const pumpIntervalMs = resolveMdrMidiPumpIntervalMs(this.performanceProfile);
    const infinite = Boolean(loopWindow && Number.isFinite(loopWindow.startSeconds) && Number.isFinite(loopWindow.endSeconds) && loopWindow.startSeconds >= 0 && loopWindow.endSeconds > loopWindow.startSeconds);
    const safeLoopWindow = infinite ? loopWindow! : undefined;
    const safeLoopPeriod = safeLoopWindow ? safeLoopWindow.endSeconds - safeLoopWindow.startSeconds : 0;
    // Keep the converted intro and exactly one complete song cycle. On later
    // passes, resume from the converter's L-derived loop window rather than
    // replaying all events from t=0 or following a trailing release tail.
    const timelineEvents = safeLoopWindow ? selectMdrMidiLoopWindowEvents(events, safeLoopWindow) : events;
    const loopStartIndex = safeLoopWindow ? timelineEvents.findIndex((event) => event.at >= safeLoopWindow.startSeconds) : 0;
    let cursor = 0;
    let cycle = 0;
    const midiClock = new MdrPlaybackClock();
    this.mdrMidiTimelineComplete = false;
    this.lastMidiSyncUpdateAt = Number.NEGATIVE_INFINITY;
    const pump = () => {
      if (!isCurrentPlaybackGeneration(playbackGeneration, this.playbackGeneration)) return;
      if (this.mdrMidiTimer !== undefined) window.clearTimeout(this.mdrMidiTimer);
      this.mdrMidiTimer = undefined;
      const outputTimeline = !hardwareOutput && this.mdrAudioTimeline?.ready ? this.mdrAudioTimeline : undefined;
      if (!outputTimeline && context.currentTime < startsAt) {
        this.mdrMidiTimer = window.setTimeout(pump, pumpIntervalMs);
        return;
      }
      const elapsed = Math.max(0, context.currentTime - startsAt);
      const hardwareMilliseconds = this.mdrPlayer?.getPlayAtMilliseconds() ?? null;
      // Keep the initial buffering offset while OPM/PCM runs. After its shorter
      // ending, advance from that final song position on the live audio clock.
      const hardwareElapsed = outputTimeline
        ? outputTimeline.songSecondsAt(context.currentTime)
        : midiClock.read(elapsed, hardwareMilliseconds, this.mdrPlayer?.isTerminated() ?? false);
      if (infinite && safeLoopWindow && cursor >= timelineEvents.length && loopStartIndex >= 0) {
        const nextCycleBoundary = safeLoopWindow.endSeconds + cycle * safeLoopPeriod;
        if ((outputTimeline && !outputTimeline.ended ? outputTimeline.renderedSeconds : hardwareElapsed + lookaheadSeconds) >= nextCycleBoundary) {
          cycle += 1;
          cursor = loopStartIndex;
        }
      }
      let mostRecentEvent: ScheduledMdrMidiEvent | undefined;
      let mostRecentDispatchAt = 0;
      while (cursor < timelineEvents.length) {
        const event = timelineEvents[cursor++]!;
        const eventAt = safeLoopWindow ? resolveMdrMidiLoopDispatchAtSeconds(event.at, cycle, safeLoopWindow) : event.at;
        if (eventAt === undefined) continue;
        mostRecentDispatchAt = hardwareOutput
          ? resolveExternalMidiDispatchAtSeconds(eventAt, this.externalMidiAdvanceMs, hardwareOutput)
          : resolveSoundFontMdrDispatchAtSeconds(eventAt, this.soundFontMdrDelayMs);
        const targetAt = outputTimeline
          ? outputTimeline.targetAt(mostRecentDispatchAt)
          : resolveMdrMidiLiveTargetAtSeconds(context.currentTime, hardwareElapsed, mostRecentDispatchAt);
        if (targetAt === undefined || ((!outputTimeline || outputTimeline.ended) && mostRecentDispatchAt > hardwareElapsed + lookaheadSeconds)) {
          cursor -= 1;
          break;
        }
        // Muting a track must not shorten the song's finite timeline.
        this.mdrMidiLastEventAt = Math.max(this.mdrMidiLastEventAt ?? 0, targetAt);
        if (!this.mutedMdrTracks.has(event.sourceTrack) && !shouldSkipMdrMidiEventAtLoopCycle(event.bytes, cycle)) {
          if (hardwareOutput) this.sendMdrMidi(event.bytes, event.sourceTrack, this.externalMidiAdvanceMs, targetAt);
          else this.queueSoundFontMdrMidi(event.bytes, event.sourceTrack, targetAt, playbackGeneration, Boolean(this.gsMidiPort) || shouldScheduleMdrMidiDirectlyAtLoopStart(infinite, cycle, safeLoopWindow ? event.at - safeLoopWindow.startSeconds : event.at, lookaheadSeconds));
        }
        mostRecentEvent = event;
      }
      if (!this.gsMidiPort && mostRecentEvent && performance.now() - this.lastMidiSyncUpdateAt >= resolveRealtimeVisualUpdateIntervalMs(this.performanceProfile, this.safariCompatibilityMode)) {
        this.lastMidiSyncUpdateAt = performance.now();
        // Events may be queued ahead into the AudioWorklet. Compare the most
        // recently audible event with the actual MXDRV core playhead, rather
        // than substituting AudioContext elapsed time for the hardware clock.
        const audibleSeconds = Math.min(mostRecentDispatchAt, hardwareElapsed);
        this.mdrMidiSyncListener?.({
          scheduledSeconds: audibleSeconds,
          dispatchedSeconds: hardwareElapsed,
          hardwareMilliseconds,
        });
      }
      if (cursor >= timelineEvents.length) {
        if (infinite) {
          // The musical loop is governed by the live MXDRV position. Do not
          // advance because the last MIDI event happened early; that causes
          // duplicate setup events and long second-loop delays.
          this.mdrMidiTimer = window.setTimeout(pump, pumpIntervalMs);
          return;
        }
        this.mdrMidiTimelineComplete = true;
        this.mdrMidiPump = undefined;
        this.mdrMidiAnimationFrame = undefined;
        return;
      }
      this.mdrMidiTimer = window.setTimeout(pump, pumpIntervalMs);
    };
    this.mdrMidiPump = pump;
    pump();
  }

  stop() {
    this.playbackGeneration += 1;
    this.resetMdrMidiScheduler();
    this.mdrMidiVisualQueue.clear();
    this.mdrHardwareVisualQueue.clear();
    this.mdrMidiMuteVersions.clear();
    this.mdrAudioTimeline = undefined;
    this.mdrMidiPump = undefined;
    this.mdrNode?.disconnect();
    this.mdrNode = undefined;
    this.mdrWorklet?.port.postMessage({ type: "stop" });
    this.mdrWorklet?.disconnect();
    this.mdrWorklet = undefined;
    this.mdrPlayer?.stop();
    this.mdrHardwareTrackIndexes = [];
    this.audioCallbackAt.clear();
    this.outputPeakListener?.(0);
    this.resetPcmActivity();
    this.resetMdrTrackKeys();
    this.reportTimerB(null);
    this.reportHardwarePlaybackPosition(null);
    this.mdrMidiSyncListener?.(null);
    this.activeNodes.forEach((node) => { try { node.stop(); } catch { /* node may have completed */ } });
    this.activeNodes = [];
    if (this.mdrMidiAnimationFrame) cancelAnimationFrame(this.mdrMidiAnimationFrame);
    this.mdrMidiAnimationFrame = undefined;
    if (this.mdrMidiTimer) window.clearTimeout(this.mdrMidiTimer);
    this.mdrMidiTimer = undefined;
    this.mdrSoundFontQueue.clear();
    this.mdrMidiTimelineComplete = true;
    this.mdrMidiLastEventAt = null;
    this.timers.forEach((timer) => window.clearTimeout(timer));
    this.timers = [];
    if (this.endTimer) window.clearTimeout(this.endTimer);
    this.endTimer = undefined;
    this.silenceMdrSoundFont();
    this.gsSynth?.stopAll(true);
    if (this.midiOutput) for (let channel = 0; channel < 16; channel += 1) this.sendHardware([0xb0 | channel, 123, 0], `停止: Ch ${channel + 1} All Notes Off`);
  }

  async play(score: CompiledMml, onProgress: (seconds: number) => void, onEnd: () => void) {
    this.stop();
    const playbackGeneration = this.playbackGeneration;
    const { context } = this.graph;
    await context.resume();
    throwIfPlaybackSuperseded(playbackGeneration, this.playbackGeneration);
    this.restoreMdrSoundFont();
    const startsAt = context.currentTime + 0.04;
    score.events.forEach((event) => this.scheduleEvent(event, startsAt));
    this.lastProgressUpdateAt = Number.NEGATIVE_INFINITY;
    let animationFrame = 0;
    const animate = () => {
      if (!isCurrentPlaybackGeneration(playbackGeneration, this.playbackGeneration)) return;
      const elapsed = Math.min(score.duration, Math.max(0, context.currentTime - startsAt));
      this.publishProgress(onProgress, elapsed);
      if (elapsed < score.duration) animationFrame = requestAnimationFrame(animate);
    };
    animationFrame = requestAnimationFrame(animate);
    this.endTimer = window.setTimeout(() => {
      if (!isCurrentPlaybackGeneration(playbackGeneration, this.playbackGeneration)) return;
      cancelAnimationFrame(animationFrame);
      this.publishProgress(onProgress, score.duration, true);
      onEnd();
    }, (score.duration + 0.12) * 1000);
  }

  async playMdr(mdr: ArrayBuffer, pdx: ArrayBuffer | undefined, loops: number, onProgress: (seconds: number) => void, onEnd: () => void): Promise<MdrPlaybackInfo> {
    this.stop();
    const playbackGeneration = this.playbackGeneration;
    const { context, gains } = this.graph;
    await context.resume();
    throwIfPlaybackSuperseded(playbackGeneration, this.playbackGeneration);
    this.restoreMdrSoundFont();
    const sourceInfo = inspectMdr(mdr);
    this.mdrHardwareTrackIndexes = listMdrMixerTracks(mdr).filter((track) => track.active && track.engine !== "midi").map((track) => track.index);
    let needsHardwareRenderer = requiresMdrHardwareRenderer(sourceInfo.hardwareTracks);
    if (sourceInfo.midiTracks > 0 && !this.midiOutput && !this.gsLoaded) throw new Error("このMDRにはGS MIDIトラックがあります。SoundFont bankでSF2/DLSを読み込むか、External MIDIを選択してから再生してください。");
    const measuredLoops = loops <= 0 ? 1 : loops;
    let info: MdrPlaybackInfo;
    if (needsHardwareRenderer) {
      try {
        this.mdrPlayer ??= new MadrvWasmPlayer();
        info = await this.mdrPlayer.load(mdr, pdx, 1, context.sampleRate);
      } catch (error) {
        // Only GS-capable MDR may skip OPM conversion. MDX and OPM-only MDR keep failing loudly.
        if (sourceInfo.midiTracks <= 0) throw asPlaybackError(error, "MDRをOPM／PDX再生用データへ変換できませんでした。");
        needsHardwareRenderer = false;
        info = { duration: 0, format: "MDR / GS MIDI" };
      }
    } else {
      info = { duration: 0, format: "MDR / GS MIDI" };
    }
    throwIfPlaybackSuperseded(playbackGeneration, this.playbackGeneration);
    this.setMdrMutedTracks(Array.from(this.mutedMdrTracks));
    this.outputPeakListener?.(0);
    this.resetMdrTrackKeys();
    // OPM／PCM still render at 48 kHz. The offline extractor uses an independent
    // exact Timer-B clock so rounding a tick to audio samples cannot accumulate
    // timing error; the resulting seconds map onto the rendered output frames.
    const midiTimeline = await extractMdrMidiEvents(mdr, measuredLoops, resolveMdrMidiTimingSampleRate());
    const songMidiTimeline = measuredLoops === 1 ? midiTimeline : await extractMdrMidiEvents(mdr, 1, resolveMdrMidiTimingSampleRate());
    const midiEvents = midiTimeline.events;
    throwIfPlaybackSuperseded(playbackGeneration, this.playbackGeneration);
    const totalHardwareDuration = needsHardwareRenderer && measuredLoops > 1 ? this.mdrPlayer!.measureDuration(measuredLoops) : info.duration;
    // Duration probing mutates the renderer: finish every measurement before
    // start(), otherwise infinite playback can leave OPM/PCM silent.
    const hardwareCycleSeconds = needsHardwareRenderer && (loops <= 0 || Boolean(midiTimeline.loopWindow))
      ? resolveMdrHardwareLoopCycleSeconds(info.duration, this.mdrPlayer!.measureDuration(2))
      : undefined;
    const trustedSongMidiLoopWindow = resolveTrustedMdrMidiLoopWindow(
      songMidiTimeline.loopWindow,
      needsHardwareRenderer ? info.duration : undefined,
      hardwareCycleSeconds,
    );
    const trustedFiniteMidiLoopWindow = resolveTrustedMdrMidiLoopWindow(
      midiTimeline.loopWindow,
      needsHardwareRenderer ? info.duration : undefined,
      hardwareCycleSeconds,
    );
    const songInfo: MdrPlaybackInfo = {
      ...info,
      duration: resolveMdrPlaybackDuration(info.duration, songMidiTimeline.events, trustedSongMidiLoopWindow),
    };
    const totalPlaybackDuration = resolveMdrPlaybackDuration(totalHardwareDuration, midiEvents, trustedFiniteMidiLoopWindow);
    // The MDR path keeps rendering in the stateful v11 core so actual MXDRV termination
    // and the browser's finite-loop setting cannot diverge from the displayed transport.
    // `AudioProcessingEvent.playbackTime` is the AudioContext timestamp at which
    // the block being rendered reaches the graph output. The callback itself
    // runs one ScriptProcessor block earlier, so using `currentTime` here makes
    // SoundFont MIDI start roughly one large buffer ahead on stable profiles.
    const fallbackStartsAt = context.currentTime + (needsHardwareRenderer
      ? resolveMdrPlaybackStartLatencySeconds(this.performanceProfile, context.sampleRate, context.outputLatency, context.baseLatency)
      : 0.025);
    const trustedMidiLoopWindow = loops <= 0 ? trustedFiniteMidiLoopWindow : undefined;
    const infiniteMidiLoopWindow = loops <= 0
      ? trustedMidiLoopWindow ?? (() => {
          const period = resolveMdrInfiniteMidiLoopPeriodSeconds(info.duration, songInfo.duration, needsHardwareRenderer);
          return period ? { startSeconds: 0, endSeconds: period } : undefined;
        })()
      : undefined;
    let startsAt = fallbackStartsAt;
    let midiTimelineStarted = false;
    let hardwareEndAt: number | undefined;
    this.mdrAudioTimeline = needsHardwareRenderer && !this.midiOutput ? new MdrAudioTimeline(context.sampleRate) : undefined;
    const startMidiTimeline = (audibleStartAt?: number) => {
      if (midiTimelineStarted) return;
      midiTimelineStarted = true;
      startsAt = Number.isFinite(audibleStartAt) ? Math.max(context.currentTime, audibleStartAt as number) : fallbackStartsAt;
      this.startMdrMidiTimeline(midiEvents, startsAt, infiniteMidiLoopWindow);
    };
    if (needsHardwareRenderer) {
      const node = context.createScriptProcessor(resolveScriptProcessorBufferSize(this.performanceProfile), 0, 2);
      node.onaudioprocess = (event) => {
        const left = event.outputBuffer.getChannelData(0);
        const right = event.outputBuffer.getChannelData(1);
        if (!isCurrentPlaybackGeneration(playbackGeneration, this.playbackGeneration)) { left.fill(0); right.fill(0); return; }
        const reportedPlaybackTime = Number((event as AudioProcessingEvent).playbackTime);
        const blockPlaybackTime = Number.isFinite(reportedPlaybackTime) && reportedPlaybackTime >= 0
          ? reportedPlaybackTime : context.currentTime + left.length / context.sampleRate;
        const peak = this.renderMdrOutputBlock(left, right, blockPlaybackTime);
        this.mdrAudioTimeline?.recordBlock(blockPlaybackTime, left.length, this.mdrPlayer?.isTerminated() ?? false);
        if (hardwareEndAt === undefined && this.mdrPlayer?.isTerminated()) {
          const playbackTime = Number((event as AudioProcessingEvent).playbackTime);
          const blockStartsAt = Number.isFinite(playbackTime) ? Math.max(context.currentTime, playbackTime) : context.currentTime;
          hardwareEndAt = blockStartsAt + left.length / context.sampleRate;
        }
        this.noteAudioCallback("opm", left.length);
        if (this.shouldPublishRealtimeVisuals()) {
          this.outputPeakListener?.(peak);
          this.reportPcmActivity(this.mdrPlayer?.getPcmActiveMask() ?? 0);
          if (!this.mdrTrackKeyListener) this.reportHardwareTrackKeys();
          this.reportTimerB(this.mdrPlayer?.getTimerB() ?? null);
          this.reportHardwarePlaybackPosition(this.mdrPlayer?.getPlayAtMilliseconds() ?? null);
        }
        if (!midiTimelineStarted) {
          startMidiTimeline(blockPlaybackTime);
        } else this.mdrMidiPump?.();
      };
      node.connect(gains.opm);
      this.mdrNode = node;
      this.reportPcmActivity(this.mdrPlayer?.getPcmActiveMask() ?? 0);
      this.mdrPlayer!.start(loops);
    } else {
      this.outputPeakListener?.(0);
      this.reportPcmActivity(0);
      // GS MIDI-only MDR has no live OPM Timer-B; surface the score's $FF/$FE $12 tempo instead.
      this.reportTimerB(resolveMdrDisplayTempoTimerB(mdr));
      this.reportHardwarePlaybackPosition(null);
      startMidiTimeline(fallbackStartsAt);
    }
    this.lastProgressUpdateAt = Number.NEGATIVE_INFINITY;
    const progressClock = new MdrPlaybackClock(false);
    let frame = 0;
    const finish = () => {
      if (!isCurrentPlaybackGeneration(playbackGeneration, this.playbackGeneration)) return;
      cancelAnimationFrame(frame);
      this.stop();
      this.publishProgress(onProgress, songInfo.duration, true);
      onEnd();
    };
    const animate = () => {
      if (!isCurrentPlaybackGeneration(playbackGeneration, this.playbackGeneration)) return;
      const hardwareMilliseconds = needsHardwareRenderer ? this.mdrPlayer?.getPlayAtMilliseconds() ?? null : null;
      const hardwareTerminated = needsHardwareRenderer && (this.mdrPlayer?.isTerminated() ?? false);
      const elapsed = progressClock.read(context.currentTime - startsAt, hardwareMilliseconds, hardwareTerminated);
      const displayedElapsed = songInfo.duration > 0 && loops !== 1 ? elapsed % songInfo.duration : Math.min(songInfo.duration, elapsed);
      this.publishProgress(onProgress, displayedElapsed);
      const hardwareDrained = hardwareTerminated && hardwareEndAt !== undefined && context.currentTime >= hardwareEndAt;
      if (loops > 0 && midiTimelineStarted && shouldEndFiniteMdrPlayback(needsHardwareRenderer, hardwareDrained, this.isMdrMidiPlaybackDrained())) {
        finish();
        return;
      }
      frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    // MXDRV may retain an intentional song loop after its runtime state is no
    // longer useful for a browser transport. A saturated hardware measurement
    // is bounded by the converted MIDI loop window; other songs retain a longer
    // wall-clock failsafe in case the termination export stalls.
    if (loops > 0) {
      const midiBoundaryIsReliable = needsHardwareRenderer
        && Boolean(trustedFiniteMidiLoopWindow);
      const endDelaySeconds = needsHardwareRenderer && !midiBoundaryIsReliable
        ? resolveMdrPlaybackFailsafeSeconds(totalPlaybackDuration)
        : totalPlaybackDuration + 0.12;
      const checkFiniteEnd = () => {
        if (!isCurrentPlaybackGeneration(playbackGeneration, this.playbackGeneration)) return;
        const now = context.currentTime;
        const boundaryReached = now >= startsAt + endDelaySeconds;
        const failsafeReached = now >= startsAt + resolveMdrPlaybackFailsafeSeconds(totalPlaybackDuration);
        const hardwareTailElapsed = hardwareEndAt === undefined || now >= hardwareEndAt;
        // A finite L boundary may end an intentionally looping MXDRV core, but
        // never discard known queued MIDI or its release tail. The larger
        // failsafe still bounds a broken/unstarted timeline with no output left.
        if (boundaryReached && hardwareTailElapsed && this.hasMdrMidiTailElapsed()
          && ((midiTimelineStarted && this.mdrMidiTimelineComplete) || failsafeReached)) {
          finish();
          return;
        }
        this.endTimer = window.setTimeout(checkFiniteEnd, 50);
      };
      this.endTimer = window.setTimeout(checkFiniteEnd, endDelaySeconds * 1000);
    }
    return songInfo;
  }

  async playMdx(mdx: ArrayBuffer, pdx: ArrayBuffer | undefined, loops: number, onProgress: (seconds: number) => void, onEnd: () => void): Promise<MdrPlaybackInfo> {
    this.stop();
    this.mdrHardwareTrackIndexes = Array.from({ length: 16 }, (_, index) => index);
    const playbackGeneration = this.playbackGeneration;
    const { context, gains } = this.graph;
    await context.resume();
    throwIfPlaybackSuperseded(playbackGeneration, this.playbackGeneration);
    this.restoreMdrSoundFont();
    this.mdrPlayer ??= new MadrvWasmPlayer();
    const measuredLoops = loops <= 0 ? 1 : loops;
    const info = await this.mdrPlayer.loadMdx(mdx, pdx, 1, context.sampleRate);
    const totalPlaybackDuration = measuredLoops > 1 ? this.mdrPlayer.measureDuration(measuredLoops) : info.duration;
    throwIfPlaybackSuperseded(playbackGeneration, this.playbackGeneration);
    this.setMdrMutedTracks([]);
    this.outputPeakListener?.(0);
    // Keep MDX in the same single renderer as the measured transport. The former
    // mobile AudioWorklet created a second MXDRV instance, so its independent
    // render cadence could diverge from the main player used for duration and
    // diagnostics. A larger mobile ScriptProcessor buffer preserves audio priority
    // while guaranteeing one sample-rate clock for audible output and telemetry.
    {
      const node = context.createScriptProcessor(resolveScriptProcessorBufferSize(this.performanceProfile), 0, 2);
      node.onaudioprocess = (event) => {
        const left = event.outputBuffer.getChannelData(0);
        const right = event.outputBuffer.getChannelData(1);
        const reportedPlaybackTime = Number((event as AudioProcessingEvent).playbackTime);
        const blockPlaybackTime = Number.isFinite(reportedPlaybackTime) && reportedPlaybackTime >= 0
          ? reportedPlaybackTime : context.currentTime + left.length / context.sampleRate;
        const peak = this.renderMdrOutputBlock(left, right, blockPlaybackTime);
        this.noteAudioCallback("opm", left.length);
        if (this.shouldPublishRealtimeVisuals()) {
          this.outputPeakListener?.(peak);
          this.reportPcmActivity(this.mdrPlayer?.getPcmActiveMask() ?? 0);
          if (!this.mdrTrackKeyListener) this.reportHardwareTrackKeys();
          this.reportTimerB(this.mdrPlayer?.getTimerB() ?? null);
          this.reportHardwarePlaybackPosition(this.mdrPlayer?.getPlayAtMilliseconds() ?? null);
        }
      };
      node.connect(gains.opm);
      this.mdrNode = node;
      this.mdrPlayer.start(loops);
    }
    const startsAt = context.currentTime;
    this.lastProgressUpdateAt = Number.NEGATIVE_INFINITY;
    let frame = 0;
    const animate = () => {
      if (!isCurrentPlaybackGeneration(playbackGeneration, this.playbackGeneration)) return;
      const tick = resolveMdxPlaybackTick(context.currentTime - startsAt, info.duration, loops, this.mdrPlayer?.isTerminated() ?? true);
      this.publishProgress(onProgress, tick.elapsed);
      if (tick.ended) {
        this.stop();
        this.publishProgress(onProgress, tick.elapsed, true);
        onEnd();
        return;
      }
      if (loops <= 0 || tick.elapsed < info.duration) frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    if (loops > 0) this.endTimer = window.setTimeout(() => {
      if (!isCurrentPlaybackGeneration(playbackGeneration, this.playbackGeneration)) return;
      cancelAnimationFrame(frame);
      this.stop();
      this.publishProgress(onProgress, info.duration, true);
      onEnd();
    }, (totalPlaybackDuration + 0.12) * 1000);
    return info;
  }

  async exportVideo(score: CompiledMml, onProgress: (seconds: number) => void): Promise<ExportResult> {
    if (!("MediaRecorder" in window)) throw new Error("このブラウザはMP4書き出しに必要なMediaRecorderに対応していません。");
    const { context } = this.graph;
    await context.resume();
    const canvas = document.createElement("canvas");
    canvas.width = 1280;
    canvas.height = 720;
    const drawing = canvas.getContext("2d");
    if (!drawing || !("captureStream" in canvas)) throw new Error("このブラウザは書き出し用のCanvas映像トラックに対応していません。");
    const canvasStream = canvas.captureStream(30);
    const stream = new MediaStream([...canvasStream.getVideoTracks(), ...this.getMediaDestination().stream.getAudioTracks()]);
    const preferredTypes = ["video/mp4;codecs=avc1.42E01E,mp4a.40.2", "video/mp4", "video/webm;codecs=vp8,opus"];
    const mimeType = preferredTypes.find((candidate) => MediaRecorder.isTypeSupported(candidate));
    if (!mimeType) throw new Error("このブラウザで利用できるMP4またはWebMエンコーダーが見つかりません。");
    const chunks: BlobPart[] = [];
    const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 1_250_000, audioBitsPerSecond: 192_000 });
    const extension: "mp4" | "webm" = mimeType.startsWith("video/mp4") ? "mp4" : "webm";
    let renderedSeconds = 0;
    let frame = 0;
    const drawFrame = () => {
      const ratio = Math.min(1, renderedSeconds / score.duration);
      drawing.fillStyle = "#11120f";
      drawing.fillRect(0, 0, canvas.width, canvas.height);
      drawing.fillStyle = "#d8ff3e";
      drawing.fillRect(88, 84, 12, 12);
      drawing.fillStyle = "#f5f4ec";
      drawing.font = "600 52px sans-serif";
      drawing.fillText("MADRV PLAYER", 124, 97);
      drawing.fillStyle = "#a9aca2";
      drawing.font = "20px monospace";
      drawing.fillText("SIGNAL DECK / MML EXPORT", 124, 132);
      drawing.strokeStyle = "rgba(245,244,236,0.2)";
      drawing.lineWidth = 1;
      drawing.beginPath();
      for (let index = 0; index < 950; index += 12) {
        const y = 355 + Math.sin((index / 34) + renderedSeconds * 7) * (28 + ((index % 5) * 7));
        if (index === 0) drawing.moveTo(165 + index, y); else drawing.lineTo(165 + index, y);
      }
      drawing.stroke();
      drawing.fillStyle = "#d8ff3e";
      drawing.fillRect(165, 535, 950 * ratio, 7);
      drawing.strokeStyle = "rgba(245,244,236,0.26)";
      drawing.strokeRect(165, 535, 950, 7);
      drawing.fillStyle = "#f5f4ec";
      drawing.font = "24px monospace";
      const current = Math.floor(renderedSeconds).toString().padStart(2, "0");
      const total = Math.ceil(score.duration).toString().padStart(2, "0");
      drawing.fillText(`00:${current}.000  —  00:${total}.000`, 165, 588);
      drawing.fillStyle = "#a9aca2";
      drawing.font = "18px monospace";
      drawing.fillText(`OPM / PCM / GS MIDI  ·  LOOP BOUNDED  ·  ${extension.toUpperCase()}`, 165, 642);
      frame = requestAnimationFrame(drawFrame);
    };

    return new Promise<ExportResult>((resolve, reject) => {
      recorder.addEventListener("dataavailable", (event) => { if (event.data.size) chunks.push(event.data); });
      recorder.addEventListener("error", () => reject(new Error("MP4書き出し中にエンコーダーエラーが発生しました。")));
      recorder.addEventListener("stop", () => {
        cancelAnimationFrame(frame);
        canvasStream.getTracks().forEach((track) => track.stop());
        stream.getTracks().forEach((track) => track.stop());
        this.recording = false;
        resolve({ blob: new Blob(chunks, { type: mimeType }), extension, mimeType });
      }, { once: true });
      this.recording = true;
      recorder.start(1000);
      this.play(score, (seconds) => {
        renderedSeconds = seconds;
        onProgress(seconds);
      }, () => recorder.stop()).catch((error) => {
        this.recording = false;
        try { recorder.stop(); } catch { /* recorder may already be inactive */ }
        reject(error);
      });
      drawFrame();
    });
  }

  private scheduleEvent(event: MmlEvent, startsAt: number) {
    const { context, gains } = this.graph;
    const at = startsAt + event.start;
    const releaseAt = at + event.duration * 0.92;
    const frequency = 440 * 2 ** ((event.midi - 69) / 12);
    if (event.engine === "opm") {
      const carrier = context.createOscillator();
      const modulator = context.createOscillator();
      const modulationGain = context.createGain();
      const envelope = context.createGain();
      carrier.type = "sine";
      modulator.type = "sine";
      carrier.frequency.setValueAtTime(frequency, at);
      modulator.frequency.setValueAtTime(frequency * 2.01, at);
      modulationGain.gain.setValueAtTime(frequency * 0.52, at);
      modulationGain.gain.exponentialRampToValueAtTime(0.01, releaseAt);
      envelope.gain.setValueAtTime(0.0001, at);
      envelope.gain.exponentialRampToValueAtTime(Math.max(0.03, event.velocity / 420), at + 0.012);
      envelope.gain.exponentialRampToValueAtTime(0.0001, at + event.duration);
      modulator.connect(modulationGain).connect(carrier.frequency);
      carrier.connect(envelope).connect(gains.opm);
      carrier.start(at); modulator.start(at); carrier.stop(at + event.duration + 0.05); modulator.stop(at + event.duration + 0.05);
      this.activeNodes.push(carrier, modulator);
      return;
    }
    if (event.engine === "pcm") {
      const sampleLength = Math.max(1, Math.floor(context.sampleRate * Math.min(event.duration, 0.22)));
      const buffer = context.createBuffer(1, sampleLength, context.sampleRate);
      const data = buffer.getChannelData(0);
      for (let index = 0; index < sampleLength; index += 1) data[index] = (Math.random() * 2 - 1) * Math.exp((-5 * index) / sampleLength);
      const source = context.createBufferSource();
      const filter = context.createBiquadFilter();
      const envelope = context.createGain();
      source.buffer = buffer;
      source.playbackRate.value = Math.max(0.4, frequency / 261.63);
      filter.type = "lowpass"; filter.frequency.value = Math.min(14000, frequency * 5);
      envelope.gain.setValueAtTime(Math.max(0.03, event.velocity / 400), at);
      envelope.gain.exponentialRampToValueAtTime(0.0001, at + Math.min(event.duration, 0.22));
      source.connect(filter).connect(envelope).connect(gains.pcm);
      source.start(at); source.stop(at + Math.min(event.duration, 0.24));
      this.activeNodes.push(source);
      return;
    }
    const triggerMidi = () => {
      if (this.midiOutput && !this.recording) {
        const correction = this.externalMidiAdvanceMs;
        this.sendHardware([0x90, event.midi, event.velocity], `MML MIDI Note On${correction ? ` · ${correction > 0 ? "advance" : "delay"} ${Math.abs(correction)} ms` : ""}`);
        this.timers.push(window.setTimeout(() => { if (this.midiOutput) this.sendHardware([0x80, event.midi, 0], "MML MIDI Note Off"); }, event.duration * 1000));
      } else if (this.gsLoaded && this.gsSynth) {
        this.gsSynth.noteOn(0, event.midi, event.velocity);
        this.timers.push(window.setTimeout(() => this.gsSynth?.noteOff(0, event.midi), event.duration * 1000));
      } else {
        const oscillator = context.createOscillator();
        const envelope = context.createGain();
        oscillator.type = "triangle"; oscillator.frequency.value = frequency;
        envelope.gain.setValueAtTime(0.0001, context.currentTime);
        envelope.gain.exponentialRampToValueAtTime(Math.max(0.02, event.velocity / 520), context.currentTime + 0.01);
        envelope.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + event.duration * 0.9);
        oscillator.connect(envelope).connect(gains.midi);
        oscillator.start(); oscillator.stop(context.currentTime + event.duration + 0.04);
        this.activeNodes.push(oscillator);
      }
    };
    const hardwareAdvance = this.midiOutput && !this.recording ? this.externalMidiAdvanceMs / 1000 : 0;
    this.timers.push(window.setTimeout(triggerMidi, Math.max(0, (at - context.currentTime - hardwareAdvance) * 1000)));
  }
}
