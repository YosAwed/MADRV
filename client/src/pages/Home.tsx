import { CompactPanel, type CompactPanelHandle } from "@/components/CompactPanel";
/* Compact Signal Deck: persistent playback controls and independently folding sections. */
import { HelpTooltip } from "@/components/HelpTooltip";
import { Button } from "@/components/ui/button";
import {
  ChevronDown,
  CircleStop,
  CloudDownload,
  FileAudio,
  FolderOpen,
  Info,
  KeyboardMusic,
  ListMusic,
  LoaderCircle,
  Play,
  RotateCcw,
  Share2,
  SlidersHorizontal,
  Upload,
  Volume2,
  Waves,
} from "lucide-react";
import { ChangeEvent, DragEvent, lazy, memo, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { compileMml, extractMmlInitialTempo, fetchRemoteCatalog, fetchRemoteSoundFont, fetchSharedSoundFont, formatMidiNoteName, formatPdxFileName, inspectMadrvSource, inspectMdr, inspectMdx, isGoogleDriveShareUrl, isGsMidiEngineArmed, isMidiPlaybackDestinationReady, isOpmPcmEngineArmed, isPcmPdxEngineArmed, isPcmVoiceActive, isSafariBrowserUserAgent, isSignedTimingCorrectionDraft, limitScore, listMdrMixerTracks, mdrRequiresPdx, MdrInfo, MdrMixerTrack, MdxInfo, MidiDiagnosticEntry, MidiOutputDevice, MmlSyntaxError, normalizeExternalMidiAdvanceMs, normalizeRemoteAssetUrl, normalizeSoundFontMdrDelayMs, normalizeSoundFontMdrDelayProfiles, parseRemoteCatalogPayload, playbackProgressPercent, recommendPlaybackTuning, recommendSoundFontMdrDelayMs, RemoteCatalogEntry, requiresStableMadrvProfileForHybridTracks, requiresStableMadrvProfileForSoundFont, resolveNextPlaylistIndex, resolvePlaylistInterTrackSilenceSeconds, resolveSoundFontMdrDelayProfile, resolveSoundFontMdrTimingComparisonDelay, setSoundFontMdrDelayProfile, SignalDeckAudio, stepSoundFontMdrDelayMs, timerBToEstimatedBpm, updateSoundFontMdrDelayMeasurement, type MdrMidiSyncSnapshot, type MdrTrackKeyState, type PlaybackLoadProbe, type PlaybackPerformanceProfile, type PlaybackTuningPreset, type PlaybackTuningRecommendation, type SoundFontMdrDelayMeasurement, type SoundFontMdrDelayProfiles, type SoundFontMdrTimingComparisonMode } from "@/lib/madrvEngine";
import { DEFAULT_PLAYLIST_LOOP_COUNT, isPersistablePlaylistEntry, movePlaylistEntry, normalizePlaylistLoopCount, parseSavedPlaylist, SAVED_PLAYLIST_STORAGE_KEY, setPlaylistEntryLoopCount, type SavedPlaylistEntry } from "@/lib/playlistEntries";
import { parseRecentSources, RECENT_SOURCES_STORAGE_KEY, removeRecentSource, upsertRecentSource, type RecentSource } from "@/lib/recentSources";
import { persistLocalSoundFontSelection, persistRemoteSoundFontSelection, readCachedLocalSoundFont, readPersistedSoundFontSelection } from "@/lib/soundFontStorage";
import { useIsMobile } from "@/hooks/useMobile";
import { trpc } from "@/lib/trpc";

const FormatGuideDialog = lazy(() => import("@/components/FormatGuideDialog").then((module) => ({ default: module.FormatGuideDialog })));

type SourceMode = "local" | "mml" | "remote";

const defaultMml = "; MML input — T: tempo / O: octave / L: default length\nT132 O4 L8 V10\nc d e g  > c < g e d c r4\n; channels can be added after the first line";
const generalUserGsPresetUrl = "https://raw.githubusercontent.com/JustEnoughLinuxOS/generaluser-gs/main/GeneralUser%20GS%20v1.471.sf2";
const signalDeckDemoCatalogUrl = "/manus-storage/signal-deck-demo-catalog_5f939bfb.json";

type LocalPdxCandidate = { name: string; data: ArrayBuffer };
type PlaylistEntry = {
  id: string;
  title: string;
  format: "mdr" | "mdx";
  source?: ArrayBuffer;
  pdx?: ArrayBuffer;
  pdxName?: string;
  requiredPdxName?: string;
  remoteMdrUrl?: string;
  remotePdxUrl?: string;
  origin: "local" | "remote";
  path?: string;
  loopCount?: number;
};

function toSavedPlaylistEntry(entry: PlaylistEntry): SavedPlaylistEntry {
  return {
    id: entry.id,
    title: entry.title,
    format: entry.format,
    origin: entry.origin,
    loopCount: normalizePlaylistLoopCount(entry.loopCount ?? DEFAULT_PLAYLIST_LOOP_COUNT),
    ...(entry.remoteMdrUrl ? { remoteMdrUrl: entry.remoteMdrUrl } : {}),
    ...(entry.remotePdxUrl ? { remotePdxUrl: entry.remotePdxUrl } : {}),
    ...(entry.pdxName ? { pdxName: entry.pdxName } : {}),
    ...(entry.requiredPdxName ? { requiredPdxName: entry.requiredPdxName } : {}),
    ...(entry.path ? { path: entry.path } : {}),
  };
}

function playlistTitleFromUrl(value: string): string {
  try {
    const pathname = new URL(value).pathname;
    return decodeURIComponent(pathname.split("/").filter(Boolean).at(-1) ?? value);
  } catch {
    return value.split("/").filter(Boolean).at(-1) ?? value;
  }
}

type LoadDiagnosis = {
  measuring: boolean;
  probe?: PlaybackLoadProbe;
  recommendation?: PlaybackTuningRecommendation;
  benchmarkMs?: number;
  frameP95Ms?: number;
  assetMiB?: number;
};

type RemoteSoundFontProgress = {
  loadedBytes: number;
  totalBytes: number | null;
  stage: "downloading" | "initializing" | "ready" | "failed";
};

function isCloudShareLink(value: string): boolean {
  try {
    const host = new URL(value.trim()).hostname.toLowerCase();
    return host === "drive.google.com" || host === "drive.usercontent.google.com" || host === "www.dropbox.com" || host === "dropbox.com" || host === "dl.dropboxusercontent.com";
  } catch {
    return false;
  }
}

function fileStem(value: string): string {
  return value.trim().split(/[\\/]/).at(-1)?.replace(/\.[^.]+$/, "").toLowerCase() ?? "";
}

function base64ToArrayBuffer(value: string): ArrayBuffer {
  const binary = window.atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes.buffer;
}

function formatTime(value: number) {
  const minutes = Math.floor(value / 60).toString().padStart(2, "0");
  const seconds = Math.floor(value % 60).toString().padStart(2, "0");
  const milliseconds = Math.floor((value % 1) * 1000).toString().padStart(3, "0");
  return `${minutes}:${seconds}.${milliseconds}`;
}

function formatByteSize(value: number) {
  if (value < 1024 * 1024) return `${Math.max(0, Math.round(value / 1024))} KB`;
  return `${(value / 1024 / 1024).toFixed(value < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

const engineRows = [
  { id: "opm", label: "OPM / PCM", note: "X68000 chip mix · YM2151 + PDX", level: 82, color: "bg-[#d8ff3e]" },
  { id: "midi", label: "GS MIDI", note: "SF2 or Web MIDI", level: 72, color: "bg-[#8fa7cc]" },
];

function SignalMark() {
  return (
    <div className="relative grid h-10 w-10 place-items-center border border-primary bg-primary text-primary-foreground shadow-[4px_4px_0_0_rgba(216,255,62,0.2)]" aria-label="MADRV Player">
      <div className="absolute left-1 top-2 h-5 w-2 border-y-2 border-l-2 border-current" />
      <div className="h-0 w-0 border-y-[6px] border-l-[10px] border-y-transparent border-l-current" />
      <div className="absolute right-1 top-2 h-5 w-2 border-y-2 border-r-2 border-current" />
    </div>
  );
}

function SmallLabel({ children, help }: { children: React.ReactNode; help?: React.ReactNode }) {
  return <span className="mono inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-[0.2em] text-[#a9aca2]"><span>{children}</span>{help && <HelpTooltip label={String(children)}>{help}</HelpTooltip>}</span>;
}

function EngineStatus({ active = false }: { active?: boolean }) {
  return (
    <span className={`mono inline-flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.14em] ${active ? "text-primary" : "text-[#a9aca2]"}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${active ? "bg-primary signal-pulse" : "bg-[#5e6259]"}`} />
      {active ? "armed" : "await"}
    </span>
  );
}

const emptyMidiNotes: number[] = [];
/** Eight octaves from MIDI C0 (12) through B7 (107). */
const KEYBOARD_MIDI_START = 12;
const KEYBOARD_OCTAVES = 8;
const KEYBOARD_WHITE_PITCHES = [0, 2, 4, 5, 7, 9, 11] as const;
/** Black keys sit after these white-key indices within an octave (C=0…B=6): 2+gap+3 pattern. */
const KEYBOARD_BLACK_AFTER_WHITE = [
  { pitch: 1, afterWhite: 0 },
  { pitch: 3, afterWhite: 1 },
  { pitch: 6, afterWhite: 3 },
  { pitch: 8, afterWhite: 4 },
  { pitch: 10, afterWhite: 5 },
] as const;
const KEYBOARD_WHITE_COUNT = KEYBOARD_OCTAVES * KEYBOARD_WHITE_PITCHES.length;
/** Piano strip colors: muted white keys + Signal Deck primary highlight. */
const KEYBOARD_WHITE_IDLE = "#bfbfbf";
const KEYBOARD_ACTIVE = "#d8ff3e";
const KEYBOARD_ACTIVE_GLOW = "rgba(216,255,62,0.45)";
const KEYBOARD_BED = "#2a2b28";
const KEYBOARD_BLACK_IDLE = "#52564e";
const KEYBOARD_BLACK_BORDER = "#1a1b18";
/** Black keys sit in the upper ~62% of white-key depth on a real piano. */
const KEYBOARD_BLACK_HEIGHT_RATIO = 0.62;
const KEYBOARD_BLACK_WIDTH_RATIO = 0.52;

/** LIVE KEYBOARD: channel ON/OFF strip only (no merged piano). PCM is pad activity, not pitch. */
const ChannelNoteState = memo(function ChannelNoteState({ tracks, trackKeyState, mutedTracks, pcmActivityMask }: { tracks: MdrMixerTrack[]; trackKeyState: MdrTrackKeyState; mutedTracks: number[]; pcmActivityMask: number }) {
  const muted = new Set(mutedTracks);
  const isTrackOn = (track: MdrMixerTrack) => {
    if (muted.has(track.index)) return false;
    if (track.engine === "pcm") return isPcmVoiceActive(pcmActivityMask, track.pcmVoice ?? 1);
    return (trackKeyState[track.index] ?? emptyMidiNotes).length > 0;
  };
  const soundingCount = tracks.filter(isTrackOn).length;
  return <div data-testid="channel-note-state" className="mt-3">
    <div className="mb-2 flex items-center justify-between gap-3"><span className="mono text-[10px] uppercase tracking-[0.12em] text-[#c3c6bd]">Channel note state</span><span className="mono text-[10px] text-primary">{soundingCount} / {tracks.length} CH ON</span></div>
    <div className="grid grid-cols-2 gap-1 sm:grid-cols-4 xl:grid-cols-8">{tracks.map((track) => {
      const isMuted = muted.has(track.index);
      const isPad = track.engine === "pcm";
      const notes = trackKeyState[track.index] ?? emptyMidiNotes;
      const isOn = isTrackOn(track);
      const noteLabel = isMuted ? "—" : isPad ? (isOn ? "PAD" : "—") : notes.map((note) => formatMidiNoteName(note)).join(" ");
      return <div key={track.index} className={`border px-2 py-1.5 ${isMuted ? "border-[#ff746c]/45 bg-[#52241f]/20" : isOn ? "border-primary bg-primary/[0.1]" : "border-white/15 bg-black/20"}`}>
        <span className="mono block truncate text-[9px] text-[#f5f4ec]">{track.label}</span>
        <span className={`display mt-0.5 block text-base font-semibold leading-none tracking-[-0.03em] ${isMuted ? "text-[#6f746a]" : isOn ? "text-primary" : "text-[#5e6359]"}`}>{noteLabel || "—"}</span>
        <span className={`mono mt-1 block text-[8px] font-medium uppercase ${isMuted ? "text-[#ffb0a8]" : isOn ? "text-primary" : "text-[#a8aca2]"}`}>{isMuted ? "MUTED" : isOn ? (isPad ? "HIT" : "ON") : "AWAIT"}</span>
      </div>;
    })}</div>
  </div>;
});

/** Per-track / engine-bus piano strip: white keys as base, black keys overlaid in the 2+3 groups. */
const TrackFullKeyboard = memo(function TrackFullKeyboard({ label, midiNotes, muted, dense = true }: { label: string; midiNotes: number[]; muted: boolean; dense?: boolean }) {
  const active = new Set(muted ? [] : midiNotes);
  const litNames = Array.from(active).sort((left, right) => left - right).map((note) => formatMidiNoteName(note));
  const description = muted ? `${label}はミュート中です。` : litNames.length ? `${label}で${litNames.join("、")}が発音中です。` : `${label}は発音待機中です。`;
  const whiteWidthPercent = 100 / KEYBOARD_WHITE_COUNT;
  const blackWidthPercent = whiteWidthPercent * KEYBOARD_BLACK_WIDTH_RATIO;
  const blackHeightPercent = KEYBOARD_BLACK_HEIGHT_RATIO * 100;
  return <div data-testid="track-full-keyboard" className="min-w-0 flex-1 overflow-x-auto" role="img" aria-label={description}>
    <div
      className={`relative min-w-[560px] overflow-hidden rounded-[1px] border border-white/20 ${dense ? "h-7 sm:h-8" : "h-10 sm:h-11"}`}
      style={{ backgroundColor: KEYBOARD_BED }}
    >
      <div className="absolute inset-0 flex gap-0">
        {Array.from({ length: KEYBOARD_WHITE_COUNT }, (_, whiteIndex) => {
          const octave = Math.floor(whiteIndex / KEYBOARD_WHITE_PITCHES.length);
          const pitch = KEYBOARD_WHITE_PITCHES[whiteIndex % KEYBOARD_WHITE_PITCHES.length]!;
          const midiNote = KEYBOARD_MIDI_START + octave * 12 + pitch;
          const isActive = active.has(midiNote);
          const isLastInOctave = whiteIndex % KEYBOARD_WHITE_PITCHES.length === KEYBOARD_WHITE_PITCHES.length - 1;
          return <span
            key={midiNote}
            title={formatMidiNoteName(midiNote)}
            className={`h-full min-w-0 flex-1 ${isLastInOctave ? "" : "border-r"}`}
            style={{
              backgroundColor: isActive ? KEYBOARD_ACTIVE : KEYBOARD_WHITE_IDLE,
              borderRightColor: isActive ? "rgba(26,27,24,0.35)" : "rgba(26,27,24,0.55)",
              borderRightWidth: "1px",
              boxShadow: isActive ? `inset 0 -1px 0 ${KEYBOARD_ACTIVE_GLOW}` : "inset 0 -1px 0 rgba(0,0,0,0.12)",
            }}
          />;
        })}
      </div>
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10" style={{ height: `${blackHeightPercent}%` }}>
        {Array.from({ length: KEYBOARD_OCTAVES }, (_, octave) => KEYBOARD_BLACK_AFTER_WHITE.map(({ pitch, afterWhite }) => {
          const midiNote = KEYBOARD_MIDI_START + octave * 12 + pitch;
          const isActive = active.has(midiNote);
          const leftPercent = (octave * KEYBOARD_WHITE_PITCHES.length + afterWhite + 1) * whiteWidthPercent - blackWidthPercent / 2;
          return <span
            key={midiNote}
            title={formatMidiNoteName(midiNote)}
            style={{
              left: `${leftPercent}%`,
              width: `${blackWidthPercent}%`,
              height: "100%",
              backgroundColor: isActive ? KEYBOARD_ACTIVE : KEYBOARD_BLACK_IDLE,
              border: `1px solid ${isActive ? KEYBOARD_ACTIVE_GLOW : KEYBOARD_BLACK_BORDER}`,
              boxShadow: isActive ? `0 0 6px ${KEYBOARD_ACTIVE_GLOW}` : "0 1px 0 rgba(255,255,255,0.08)",
            }}
            className="absolute top-0 rounded-b-[2px]"
          />;
        }))}
      </div>
    </div>
  </div>;
});

type KeyboardMatrixMode = "tracks" | "engines";
const KEYBOARD_MATRIX_MODE_KEY = "madrv-player.keyboard-matrix-mode-v1";
const PLAYBACK_TUNING_STORAGE_KEY = "madrv-player.playback-tuning-preset-v1";

type PlaybackTuningSelection = "auto" | PlaybackTuningPreset;

function parsePlaybackTuningPreset(value: string | null): PlaybackTuningSelection {
  if (value === "auto" || value === "standard" || value === "low-latency" || value === "stable") return value;
  return "auto";
}
/** Track matrix keyboards: pitched buses only (PCM has no meaningful keyboard). */
const ENGINE_BUS_ORDER = ["opm", "midi"] as const;
const ENGINE_BUS_META: Record<(typeof ENGINE_BUS_ORDER)[number], { label: string; tone: string; note: string }> = {
  opm: { label: "OPM", tone: "text-primary", note: "YM2151 buses merged" },
  midi: { label: "MIDI", tone: "text-[#a8c5ec]", note: "GS MIDI buses merged" },
};

function mergeEngineBusNotes(tracks: MdrMixerTrack[], trackKeyState: MdrTrackKeyState, mutedTracks: number[], engine: (typeof ENGINE_BUS_ORDER)[number]): number[] {
  const muted = new Set(mutedTracks);
  const notes = new Set<number>();
  for (const track of tracks) {
    if (track.engine !== engine || muted.has(track.index)) continue;
    for (const note of trackKeyState[track.index] ?? emptyMidiNotes) notes.add(note);
  }
  return Array.from(notes).sort((left, right) => left - right);
}

function MdrMetadataPanel({ info, linkedPdxName, sourceLabel, estimatedDuration }: { info: MdrInfo; linkedPdxName: string; sourceLabel: string; estimatedDuration: number | null | undefined }) {
  const requiresPdx = mdrRequiresPdx(info.pdxName);
  const linkedLabel = linkedPdxName.trim() ? linkedPdxName.split(/[\\/]/).at(-1) ?? linkedPdxName : "Not selected";
  const linkState = !requiresPdx ? "PDX NOT REQUIRED" : linkedPdxName ? "PDX READY" : "PDX REQUIRED";
  return <div className="mt-4 border border-primary/30 bg-primary/[0.045] p-4" aria-label="MDR metadata">
    <div className="flex items-center justify-between gap-3"><SmallLabel>MDR link analysis</SmallLabel><span className={`mono text-[9px] uppercase tracking-[0.1em] ${linkState === "PDX READY" || linkState === "PDX NOT REQUIRED" ? "text-primary" : "text-[#ffb8b2]"}`}>{linkState}</span></div>
    <dl className="mt-3 grid gap-x-4 gap-y-3 sm:grid-cols-2">
      <div><dt className="mono text-[9px] uppercase tracking-[0.12em] text-[#a9aca2]">MDR title</dt><dd className="mono mt-1 break-words text-xs text-[#f5f4ec]">{info.title || "UNTITLED"}</dd></div>
      <div><dt className="mono text-[9px] uppercase tracking-[0.12em] text-[#a9aca2]">Required PDX</dt><dd className="mono mt-1 break-words text-xs text-[#f5f4ec]">{requiresPdx ? formatPdxFileName(info.pdxName) : "Not required"}</dd></div>
      <div><dt className="mono text-[9px] uppercase tracking-[0.12em] text-[#a9aca2]">Linked PDX</dt><dd className="mono mt-1 break-words text-xs text-[#f5f4ec]">{linkedLabel}</dd></div>
      <div><dt className="mono text-[9px] uppercase tracking-[0.12em] text-[#a9aca2]">Source</dt><dd className="mono mt-1 text-xs text-[#f5f4ec]">{sourceLabel}</dd></div>
      <div><dt className="mono text-[9px] uppercase tracking-[0.12em] text-[#a9aca2]">OPM / PCM tracks</dt><dd className="mono mt-1 text-xs text-[#f5f4ec]">{info.hardwareTracks} active</dd></div>
      <div><dt className="mono text-[9px] uppercase tracking-[0.12em] text-[#a9aca2]">GS MIDI tracks</dt><dd className="mono mt-1 text-xs text-[#f5f4ec]">{info.midiTracks} active</dd></div>
      <div><dt className="mono text-[9px] uppercase tracking-[0.12em] text-[#a9aca2]">Estimated duration</dt><dd className="mono mt-1 text-xs text-[#f5f4ec]">{estimatedDuration === undefined ? "Preparing…" : estimatedDuration === null ? (requiresPdx && !linkedPdxName ? "PDX未読込" : "未計測") : formatTime(estimatedDuration)}</dd></div>
      <div><dt className="mono text-[9px] uppercase tracking-[0.12em] text-[#a9aca2]">MDR tracks</dt><dd className="mono mt-1 text-xs text-[#f5f4ec]">{info.activeTracks} / 32 active</dd></div>
      <div><dt className="mono text-[9px] uppercase tracking-[0.12em] text-[#a9aca2]">PCM layout</dt><dd className="mono mt-1 text-xs text-[#f5f4ec]">{info.hasExtendedPcm ? "Extended PCM" : "Standard ADPCM"}</dd></div>
    </dl>
  </div>;
}

function PlaybackAdvisorPanel({ diagnosis, activeProfile, tuningPreset, safariCompatibilityMode, onSelect }: { diagnosis: LoadDiagnosis; activeProfile: PlaybackPerformanceProfile; tuningPreset: "auto" | PlaybackTuningPreset; safariCompatibilityMode: boolean; onSelect: (preset: "auto" | PlaybackTuningPreset) => void }) {
  const recommendation = diagnosis.recommendation;
  const presetLabels: Record<PlaybackTuningPreset, string> = { "low-latency": "低遅延", standard: "標準", stable: "安定優先" };
  const activeLabel = safariCompatibilityMode ? "Safari安定" : activeProfile === "mobile" ? "安定優先" : "低遅延";
  return <section data-testid="playback-advisor" className="mt-4 border border-[#8fa7cc]/40 bg-[#8fa7cc]/[0.06] p-4" aria-label="端末負荷診断">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><SmallLabel help={<>{recommendation && <>{recommendation.reason}<br /><br /></>}設定は次回の再生開始時に反映されます。安定優先は大きい音声バッファと更新間引き、低遅延は小さいバッファを使用します。{safariCompatibilityMode && <><br /><br />Safari互換モード: 長時間再生ではOPM処理を優先するため、位置・鍵盤・メーター表示を500 ms間隔に抑えます。</>}</>}>Playback advisor</SmallLabel><p className="mono mb-0 mt-2 text-xs text-[#f5f4ec]">{diagnosis.measuring ? "端末負荷を測定中…" : recommendation ? `推奨: ${presetLabels[recommendation.preset]} / 負荷 ${recommendation.score} / 100` : "音源未読込"}</p></div><span className="mono border border-[#8fa7cc]/45 px-2 py-1 text-[9px] uppercase tracking-[0.1em] text-[#c2d6f4]">{tuningPreset === "auto" ? `auto · ${activeLabel}` : presetLabels[tuningPreset]}</span></div>
    {recommendation && <><dl className="mt-3 grid gap-2 border-y border-white/10 py-3 text-[9px] sm:grid-cols-3"><div><dt className="mono uppercase tracking-[0.1em] text-[#8b9085]">Asset</dt><dd className="mono m-0 mt-1 text-[#f5f4ec]">{diagnosis.assetMiB?.toFixed(2)} MiB</dd></div><div><dt className="mono uppercase tracking-[0.1em] text-[#8b9085]">Probe</dt><dd className="mono m-0 mt-1 text-[#f5f4ec]">{diagnosis.benchmarkMs?.toFixed(1)} ms</dd></div><div><dt className="mono uppercase tracking-[0.1em] text-[#8b9085]">Frame p95</dt><dd className="mono m-0 mt-1 text-[#f5f4ec]">{diagnosis.frameP95Ms?.toFixed(1)} ms</dd></div></dl><div className="mt-3 flex flex-wrap gap-2"><button onClick={() => onSelect("auto")} className={`mono border px-2.5 py-2 text-[9px] uppercase tracking-[0.08em] ${tuningPreset === "auto" ? "border-primary bg-primary text-primary-foreground" : "border-white/20 text-[#dfe1d8] hover:border-primary"}`}>推奨を適用</button>{(["low-latency", "standard", "stable"] as const).map((preset) => <button key={preset} onClick={() => onSelect(preset)} className={`mono border px-2.5 py-2 text-[9px] uppercase tracking-[0.08em] ${tuningPreset === preset ? "border-primary bg-primary/[0.12] text-primary" : "border-white/20 text-[#a9aca2] hover:border-primary hover:text-primary"}`}>{presetLabels[preset]}</button>)}</div></>}
  </section>;
}

export default function Home() {
  const isMobile = useIsMobile();
  const isSafari = useMemo(() => typeof navigator !== "undefined" && isSafariBrowserUserAgent(navigator.userAgent), []);
  const [mode, setMode] = useState<SourceMode>("local");
  const [mml, setMml] = useState(defaultMml);
  const [fileName, setFileName] = useState<string | null>(null);
  const [localMdr, setLocalMdr] = useState<ArrayBuffer | null>(null);
  const [localPdx, setLocalPdx] = useState<ArrayBuffer | undefined>(undefined);
  const [localSourceFormat, setLocalSourceFormat] = useState<"mdr" | "mdx" | null>(null);
  const [localMdxPdxName, setLocalMdxPdxName] = useState("");
  const [localPdxFileName, setLocalPdxFileName] = useState("");
  const [localMdxInfo, setLocalMdxInfo] = useState<MdxInfo | null>(null);
  const [localPdxCandidates, setLocalPdxCandidates] = useState<LocalPdxCandidate[]>([]);
  const [localPdxAutoMatched, setLocalPdxAutoMatched] = useState(false);
  const [mixOutputPeak, setMixOutputPeak] = useState(0);
  const [pcmActivityMask, setPcmActivityMask] = useState(0);
  const [remoteSource, setRemoteSource] = useState<{ source: ArrayBuffer; pdx?: ArrayBuffer; format: "mdr" | "mdx"; title: string } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPreparingPlayback, setIsPreparingPlayback] = useState(false);
  const [audioSampleRate, setAudioSampleRate] = useState(48_000);
  const [audioLatencyInfo, setAudioLatencyInfo] = useState({ sampleRate: 48_000, outputLatencySeconds: 0, baseLatencySeconds: 0 });
  const [soundFontMdrDelayMeasurement, setSoundFontMdrDelayMeasurement] = useState<SoundFontMdrDelayMeasurement | null>(null);
  const [timerB, setTimerB] = useState<number | null>(null);
  const [hardwarePlaybackPositionMs, setHardwarePlaybackPositionMs] = useState<number | null>(null);
  const [mdrMidiSync, setMdrMidiSync] = useState<MdrMidiSyncSnapshot | null>(null);
  const [volume, setVolume] = useState(78);
  const [opmLevel, setOpmLevel] = useState(82);
  const [pcmLevel, setPcmLevel] = useState(82);
  const [midiLevel, setMidiLevel] = useState(72);
  const [remoteMdr, setRemoteMdr] = useState("");
  const [remotePdx, setRemotePdx] = useState("");
  const [catalogUrl, setCatalogUrl] = useState("");
  const [catalogSourcePreset, setCatalogSourcePreset] = useState<"cors" | "google-drive" | "dropbox" | "signal-deck-demo">("cors");
  const [catalogEntries, setCatalogEntries] = useState<RemoteCatalogEntry[]>([]);
  const [catalogQuery, setCatalogQuery] = useState("");
  const [recentSources, setRecentSources] = useState<RecentSource[]>(() => {
    try {
      const parsed = parseRecentSources(JSON.parse(window.localStorage.getItem(RECENT_SOURCES_STORAGE_KEY) ?? "[]"));
      window.localStorage.setItem(RECENT_SOURCES_STORAGE_KEY, JSON.stringify(parsed));
      return parsed;
    } catch {
      return [];
    }
  });
  const [playlistEntries, setPlaylistEntries] = useState<PlaylistEntry[]>(() => {
    try {
      const parsed = parseSavedPlaylist(JSON.parse(window.localStorage.getItem(SAVED_PLAYLIST_STORAGE_KEY) ?? "[]"));
      window.localStorage.setItem(SAVED_PLAYLIST_STORAGE_KEY, JSON.stringify(parsed));
      return parsed;
    } catch {
      return [];
    }
  });
  const [playlistIndex, setPlaylistIndex] = useState<number | null>(null);
  const [playlistDragIndex, setPlaylistDragIndex] = useState<number | null>(null);
  const [favoriteEntries, setFavoriteEntries] = useState<RemoteCatalogEntry[]>([]);
  const [soundfontName, setSoundfontName] = useState("No SoundFont selected");
  const [soundFontByteLength, setSoundFontByteLength] = useState(0);
  const [remoteSoundfontUrl, setRemoteSoundfontUrl] = useState("");
  const [remoteSoundfontLoading, setRemoteSoundfontLoading] = useState(false);
  const [remoteSoundfontProgress, setRemoteSoundfontProgress] = useState<RemoteSoundFontProgress | null>(null);
  const [sessionLink, setSessionLink] = useState("");
  const [midiOutputMode, setMidiOutputMode] = useState<"soundfont" | "hardware">("soundfont");
  const [midiDevices, setMidiDevices] = useState<MidiOutputDevice[]>([]);
  const [selectedMidiDevice, setSelectedMidiDevice] = useState("");
  const [externalMidiAdvanceMs, setExternalMidiAdvanceMs] = useState(() => {
    try { return normalizeExternalMidiAdvanceMs(Number(window.localStorage.getItem("madrv-player.external-midi-advance-ms") ?? "0")); } catch { return 0; }
  });
  const [externalMidiAdvanceDraft, setExternalMidiAdvanceDraft] = useState(String(externalMidiAdvanceMs));
  const [defaultSoundFontMdrDelayMs, setDefaultSoundFontMdrDelayMs] = useState(() => {
    try { return normalizeSoundFontMdrDelayMs(Number(window.localStorage.getItem("madrv-player.soundfont-mdr-delay-ms") ?? "0")); } catch { return 0; }
  });
  const [soundFontMdrDelayMs, setSoundFontMdrDelayMs] = useState(defaultSoundFontMdrDelayMs);
  const [soundFontMdrDelayDraft, setSoundFontMdrDelayDraft] = useState(String(defaultSoundFontMdrDelayMs));
  const [soundFontMdrDelayProfiles, setSoundFontMdrDelayProfiles] = useState<SoundFontMdrDelayProfiles>(() => {
    try { return normalizeSoundFontMdrDelayProfiles(JSON.parse(window.localStorage.getItem("madrv-player.soundfont-mdr-delay-profiles-v1") ?? "{}")); } catch { return {}; }
  });
  const [soundFontProfileKey, setSoundFontProfileKey] = useState("");
  const [soundFontTimingComparisonMode, setSoundFontTimingComparisonMode] = useState<SoundFontMdrTimingComparisonMode>("corrected");
  const [gsPart, setGsPart] = useState(1);
  const [gsPatch, setGsPatch] = useState(0);
  const [gsPartLevel, setGsPartLevel] = useState(100);
  const [midiDiagnostics, setMidiDiagnostics] = useState<MidiDiagnosticEntry[]>([]);
  const [mixerTracks, setMixerTracks] = useState<MdrMixerTrack[]>([]);
  const activeMixerTracks = useMemo(() => mixerTracks.filter((track) => track.active), [mixerTracks]);
  const mixerTracksByEngine = useMemo(() => ({
    opm: activeMixerTracks.filter((track) => track.engine === "opm"),
    pcm: activeMixerTracks.filter((track) => track.engine === "pcm"),
    midi: activeMixerTracks.filter((track) => track.engine === "midi"),
  }), [activeMixerTracks]);
  const [mutedTracks, setMutedTracks] = useState<number[]>([]);
  const [soloTrack, setSoloTrack] = useState<number | null>(null);
  const [trackKeyState, setTrackKeyState] = useState<MdrTrackKeyState>({});
  const [keyboardMatrixMode, setKeyboardMatrixMode] = useState<KeyboardMatrixMode>(() => {
    try {
      const stored = window.localStorage.getItem(KEYBOARD_MATRIX_MODE_KEY);
      return stored === "engines" || stored === "tracks" ? stored : "tracks";
    } catch {
      return "tracks";
    }
  });
  const [loopCount, setLoopCount] = useState(1);
  const [exportLimit, setExportLimit] = useState(60);
  const [isExporting, setIsExporting] = useState(false);
  const [mmlError, setMmlError] = useState<string | null>(null);
  const [loadDiagnosisState, setLoadDiagnosis] = useState<LoadDiagnosis>({ measuring: false });
  const [tuningPreset, setTuningPresetState] = useState<PlaybackTuningSelection>(() => {
    try { return parsePlaybackTuningPreset(window.localStorage.getItem(PLAYBACK_TUNING_STORAGE_KEY)); } catch { return "auto"; }
  });
  const setTuningPreset = (preset: PlaybackTuningSelection) => {
    setTuningPresetState(preset);
    try { window.localStorage.setItem(PLAYBACK_TUNING_STORAGE_KEY, preset); } catch { /* Preference remains active for this session. */ }
  };
  const [formatGuideOpen, setFormatGuideOpen] = useState(false);
  const [notice, setNotice] = useState("音源未選択");
  const [remoteLoading, setRemoteLoading] = useState(false);
  const [mdrInfo, setMdrInfo] = useState<MdrInfo | null>(null);
  const [mdrEstimatedDuration, setMdrEstimatedDuration] = useState<number | null | undefined>(null);
  const [elapsed, setElapsed] = useState(0);
  const [duration, setDuration] = useState(0);
  const sourceInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const sf2InputRef = useRef<HTMLInputElement>(null);
  const soundFontBankButtonRef = useRef<HTMLButtonElement>(null);
  const soundFontPanelRef = useRef<CompactPanelHandle>(null);
  const audioRef = useRef<SignalDeckAudio | null>(null);
  const sessionRestoredRef = useRef(false);
  const sessionRestoreSourceLoadingRef = useRef(false);
  const sessionSoundFontTemporaryRef = useRef(false);
  const sessionInitialSourceKeyRef = useRef<string | null>(null);
  const playlistRunRef = useRef(false);
  const playlistStartRequestRef = useRef(0);
  const diagnosisRequestRef = useRef(0);
  const publicStorage = trpc.publicStorage.fetchAsset.useMutation();
  const sharedSessionCreate = trpc.sharedSession.create.useMutation();
  const trpcUtils = trpc.useUtils();
  const activeSoundFontMdrDelayMs = resolveSoundFontMdrTimingComparisonDelay(soundFontMdrDelayMs, soundFontTimingComparisonMode);

  function refreshAudioClock() {
    const info = audio().getAudioLatencyInfo();
    setAudioSampleRate(info.sampleRate);
    setAudioLatencyInfo(info);
  }

  function audio() {
    if (!audioRef.current) audioRef.current = new SignalDeckAudio();
    return audioRef.current;
  }

  function ensureMidiPlaybackDestination(needsMidi: boolean): boolean {
    const ready = isMidiPlaybackDestinationReady(soundFontByteLength > 0, midiOutputMode === "hardware" && Boolean(selectedMidiDevice));
    if (!needsMidi || ready) return true;
    playlistRunRef.current = false;
    setIsPlaying(false);
    setIsPreparingPlayback(false);
    setNotice("この曲にはGS MIDIトラックがあります。SoundFont bankでSF2/DLSを読み込むか、External MIDIを選択するまで再生は開始しません。");
    soundFontPanelRef.current?.reveal();
    window.requestAnimationFrame(() => {
      soundFontBankButtonRef.current?.focus({ preventScroll: true });
      soundFontBankButtonRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    return false;
  }

  useEffect(() => {
    try { window.localStorage.setItem(KEYBOARD_MATRIX_MODE_KEY, keyboardMatrixMode); } catch { /* Browser storage may be unavailable. */ }
  }, [keyboardMatrixMode]);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        SAVED_PLAYLIST_STORAGE_KEY,
        JSON.stringify(playlistEntries.filter((entry) => isPersistablePlaylistEntry(entry)).map(toSavedPlaylistEntry)),
      );
    } catch { /* Browser storage may be unavailable. */ }
  }, [playlistEntries]);

  function persistRecentSources(next: RecentSource[]) {
    setRecentSources(next);
    try { window.localStorage.setItem(RECENT_SOURCES_STORAGE_KEY, JSON.stringify(next)); } catch { /* Browser storage can be unavailable in private modes. */ }
  }

  function rememberRecentSource(source: Omit<RecentSource, "usedAt">) {
    setRecentSources((current) => {
      const next = upsertRecentSource(current, { ...source, usedAt: Date.now() });
      try { window.localStorage.setItem(RECENT_SOURCES_STORAGE_KEY, JSON.stringify(next)); } catch { /* Browser storage can be unavailable in private modes. */ }
      return next;
    });
  }

  function removeSourceHistory(id: string) {
    setRecentSources((current) => {
      const next = removeRecentSource(current, id);
      try { window.localStorage.setItem(RECENT_SOURCES_STORAGE_KEY, JSON.stringify(next)); } catch { /* Browser storage can be unavailable in private modes. */ }
      return next;
    });
  }

  function clearSourceHistory() {
    persistRecentSources([]);
  }

  function reopenRecentSource(source: RecentSource) {
    if (source.kind === "remote" && source.mdrUrl) {
      setMode("remote");
      setRemoteMdr(source.mdrUrl);
      setRemotePdx(source.pdxUrl ?? "");
      void loadRemoteEntry(source.mdrUrl, source.pdxUrl, source.label);
      return;
    }
    setNotice(`「${source.label}」は再読込できません。ブラウザはローカルファイルを履歴に保持できないため、Remote URLの履歴のみワンクリックで開けます。`);
  }

  function changeExternalMidiAdvance(value: number, syncDraft = true) {
    const normalized = normalizeExternalMidiAdvanceMs(value);
    setExternalMidiAdvanceMs(normalized);
    if (syncDraft) setExternalMidiAdvanceDraft(String(normalized));
  }

  function updateExternalMidiAdvanceDraft(value: string) {
    if (!isSignedTimingCorrectionDraft(value)) return;
    setExternalMidiAdvanceDraft(value);
    if (value !== "" && value !== "-") changeExternalMidiAdvance(Number(value), false);
  }

  function commitExternalMidiAdvanceDraft() {
    changeExternalMidiAdvance(externalMidiAdvanceDraft === "" || externalMidiAdvanceDraft === "-" ? 0 : Number(externalMidiAdvanceDraft));
  }

  function activateSoundFontTimingProfile(profileKey: string) {
    const nextDelay = resolveSoundFontMdrDelayProfile(soundFontMdrDelayProfiles, profileKey, defaultSoundFontMdrDelayMs);
    setSoundFontProfileKey(profileKey);
    setSoundFontMdrDelayMs(nextDelay);
    setSoundFontMdrDelayDraft(String(nextDelay));
  }

  function changeSoundFontMdrDelay(value: number, syncDraft = true) {
    const normalized = normalizeSoundFontMdrDelayMs(value);
    setSoundFontMdrDelayMs(normalized);
    if (syncDraft) setSoundFontMdrDelayDraft(String(normalized));
    if (soundFontProfileKey) {
      setSoundFontMdrDelayProfiles((current) => setSoundFontMdrDelayProfile(current, soundFontProfileKey, normalized));
      return;
    }
    setDefaultSoundFontMdrDelayMs(normalized);
    try { window.localStorage.setItem("madrv-player.soundfont-mdr-delay-ms", String(normalized)); } catch { /* Preference remains active for this session. */ }
  }

  function stepSoundFontMdrDelay(delta: number) {
    changeSoundFontMdrDelay(stepSoundFontMdrDelayMs(soundFontMdrDelayMs, delta));
  }

  function resetSoundFontMdrDelay() {
    if (!soundFontProfileKey) {
      changeSoundFontMdrDelay(0);
      return;
    }
    setSoundFontMdrDelayProfiles((current) => {
      const next = { ...current };
      delete next[soundFontProfileKey];
      return next;
    });
    setSoundFontMdrDelayMs(defaultSoundFontMdrDelayMs);
    setSoundFontMdrDelayDraft(String(defaultSoundFontMdrDelayMs));
  }

  function updateSoundFontMdrDelayDraft(value: string) {
    if (!isSignedTimingCorrectionDraft(value)) return;
    setSoundFontMdrDelayDraft(value);
    if (value !== "" && value !== "-") changeSoundFontMdrDelay(Number(value), false);
  }

  function commitSoundFontMdrDelayDraft() {
    changeSoundFontMdrDelay(soundFontMdrDelayDraft === "" || soundFontMdrDelayDraft === "-" ? 0 : Number(soundFontMdrDelayDraft));
  }

  // Re-evaluate the stored probe when the output destination changes, including
  // when a source diagnosis completes after that switch.
  const loadDiagnosis = useMemo<LoadDiagnosis>(() => loadDiagnosisState.probe
    ? { ...loadDiagnosisState, recommendation: recommendPlaybackTuning({ ...loadDiagnosisState.probe, soundFont: midiOutputMode === "soundfont" }) }
    : loadDiagnosisState, [loadDiagnosisState, midiOutputMode]);

  const activePerformanceProfile = useMemo<PlaybackPerformanceProfile>(() => {
    const preset = tuningPreset === "auto" ? loadDiagnosis.recommendation?.preset ?? "standard" : tuningPreset;
    if (tuningPreset === "auto" && (requiresStableMadrvProfileForSoundFont(soundFontByteLength) || requiresStableMadrvProfileForHybridTracks(mdrInfo?.hardwareTracks ?? 0, mdrInfo?.midiTracks ?? 0, midiOutputMode === "soundfont"))) return "mobile";
    if (preset === "stable") return "mobile";
    if (preset === "low-latency") return "desktop";
    if (isSafari) return "mobile";
    return isMobile ? "mobile" : "desktop";
  }, [isMobile, isSafari, loadDiagnosis.recommendation?.preset, soundFontByteLength, tuningPreset, mdrInfo?.hardwareTracks, mdrInfo?.midiTracks, midiOutputMode]);
  const safariCompatibilityMode = isSafari && tuningPreset !== "low-latency";
  const soundFontMdrDelayRecommendation = useMemo(
    () => recommendSoundFontMdrDelayMs({
      profile: activePerformanceProfile,
      sampleRate: audioLatencyInfo.sampleRate,
      outputLatencySeconds: audioLatencyInfo.outputLatencySeconds,
      baseLatencySeconds: audioLatencyInfo.baseLatencySeconds,
      frameP95Ms: loadDiagnosis.frameP95Ms,
    }),
    [activePerformanceProfile, audioLatencyInfo, loadDiagnosis.frameP95Ms],
  );

  useEffect(() => {
    if (!isPlaying || midiOutputMode !== "soundfont" || !mdrMidiSync || !mdrInfo?.hardwareTracks) {
      if (!isPlaying) setSoundFontMdrDelayMeasurement(null);
      return;
    }
    setSoundFontMdrDelayMeasurement((current) => updateSoundFontMdrDelayMeasurement(current, mdrMidiSync, activeSoundFontMdrDelayMs));
  }, [activeSoundFontMdrDelayMs, isPlaying, mdrInfo?.hardwareTracks, mdrMidiSync, midiOutputMode]);

  async function diagnoseLoadedSource(source: ArrayBuffer, pdx: ArrayBuffer | undefined, hardwareTracks: number, midiTracks: number) {
    const requestId = ++diagnosisRequestRef.current;
    setLoadDiagnosis({ measuring: true });
    const frameGaps: number[] = [];
    let priorFrame = performance.now();
    for (let index = 0; index < 3; index += 1) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => { const now = performance.now(); frameGaps.push(now - priorFrame); priorFrame = now; resolve(); }));
    }
    const startedAt = performance.now();
    let checksum = 0;
    const bytes = new Uint8Array(source);
    const step = Math.max(1, Math.floor(bytes.length / 180_000));
    for (let offset = 0; offset < bytes.length; offset += step) checksum = ((checksum * 33) ^ bytes[offset]!) >>> 0;
    const benchmarkMs = performance.now() - startedAt;
    const sortedFrames = [...frameGaps].sort((left, right) => left - right);
    const frameP95Ms = sortedFrames[Math.max(0, Math.floor((sortedFrames.length - 1) * 0.95))] ?? 16.7;
    const device = navigator as Navigator & { deviceMemory?: number };
    const probe: PlaybackLoadProbe = { sourceBytes: source.byteLength, pcmBytes: pdx?.byteLength ?? 0, hardwareTracks, midiTracks, benchmarkMs, frameP95Ms, hardwareConcurrency: navigator.hardwareConcurrency, deviceMemoryGb: device.deviceMemory, mobile: isMobile };
    void checksum;
    if (requestId === diagnosisRequestRef.current) setLoadDiagnosis({ measuring: false, probe, benchmarkMs, frameP95Ms, assetMiB: (source.byteLength + (pdx?.byteLength ?? 0)) / (1024 * 1024) });
  }

  function resetMdrEstimatedDuration() {
    // Full-song measuring creates separate WASM players. On a cold production cache it can
    // compete with PLAY and make a loaded MDR look unresponsive for many seconds.
    // playMdr returns the authoritative finite duration once the audible transport starts.
    setMdrEstimatedDuration(null);
  }

  useEffect(() => {
    const player = audio();
    player.setDiagnosticListener(setMidiDiagnostics);
    player.setOutputPeakListener(setMixOutputPeak);
    player.setPcmActivityListener(setPcmActivityMask);
    player.setMdrTrackKeyListener(setTrackKeyState);
    player.setTimerBListener(setTimerB);
    player.setHardwarePlaybackPositionListener(setHardwarePlaybackPositionMs);
    player.setMdrMidiSyncListener(setMdrMidiSync);
    return () => {
      player.setDiagnosticListener(undefined);
      player.setOutputPeakListener(undefined);
      player.setPcmActivityListener(undefined);
      player.setMdrTrackKeyListener(undefined);
      player.setTimerBListener(undefined);
      player.setHardwarePlaybackPositionListener(undefined);
      player.setMdrMidiSyncListener(undefined);
    };
  }, []);

  useEffect(() => {
    audio().setPerformanceProfile(activePerformanceProfile, safariCompatibilityMode);
  }, [activePerformanceProfile, safariCompatibilityMode]);

  useEffect(() => {
    const normalized = normalizeExternalMidiAdvanceMs(externalMidiAdvanceMs);
    audio().setExternalMidiAdvanceMs(normalized);
    try { window.localStorage.setItem("madrv-player.external-midi-advance-ms", String(normalized)); } catch { /* Preference remains active for this session. */ }
  }, [externalMidiAdvanceMs]);

  useEffect(() => {
    audio().setSoundFontMdrDelayMs(activeSoundFontMdrDelayMs);
  }, [activeSoundFontMdrDelayMs]);

  useEffect(() => {
    try { window.localStorage.setItem("madrv-player.soundfont-mdr-delay-profiles-v1", JSON.stringify(soundFontMdrDelayProfiles)); } catch { /* Profiles remain active for this session. */ }
  }, [soundFontMdrDelayProfiles]);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem("madrv-player.catalog-favorites");
      const parsed: unknown = stored ? JSON.parse(stored) : [];
      if (Array.isArray(parsed)) setFavoriteEntries(parsed.filter((entry): entry is RemoteCatalogEntry => Boolean(entry && typeof entry === "object" && typeof (entry as RemoteCatalogEntry).id === "string" && typeof (entry as RemoteCatalogEntry).mdrUrl === "string")));
    } catch { /* Favorites are optional and remain browser-local. */ }
  }, []);

  useEffect(() => {
    try { window.localStorage.setItem("madrv-player.catalog-favorites", JSON.stringify(favoriteEntries)); } catch { /* Storage may be unavailable. */ }
  }, [favoriteEntries]);

  useEffect(() => {
    if (sessionRestoredRef.current) return;
    sessionRestoredRef.current = true;
    const params = new URLSearchParams(window.location.search);
    const bounded = (value: string | null, fallback: number, minimum: number, maximum: number) => {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, Math.round(parsed))) : fallback;
    };
    const restoreSessionPayload = (payload: { source: { kind: "mml"; mml: string } | { kind: "remote"; mdrUrl: string; pdxUrl?: string }; loopCount: number; exportLimit: number; catalogUrl?: string; soundFontUrl?: string }, label: string) => {
      setLoopCount(payload.loopCount === 0 ? 0 : bounded(String(payload.loopCount), 1, 1, 99));
      setExportLimit(bounded(String(payload.exportLimit), 60, 10, 600));
      setCatalogUrl(payload.catalogUrl?.trim() ?? "");
      const restoredSoundfont = payload.soundFontUrl?.trim() ?? "";
      sessionInitialSourceKeyRef.current = payload.source.kind === "remote"
        ? sourceKeyForRemote(payload.source.mdrUrl, payload.source.pdxUrl)
        : `mml:${payload.source.mml}`;
      if (restoredSoundfont) {
        sessionSoundFontTemporaryRef.current = true;
        setRemoteSoundfontUrl(restoredSoundfont);
        void loadRemoteSoundFont(restoredSoundfont, { persistSelection: false });
      } else {
        void restorePersistedSoundFont();
      }
      if (payload.source.kind === "remote") {
        setRemoteMdr(payload.source.mdrUrl);
        setRemotePdx(payload.source.pdxUrl ?? "");
        setMode("remote");
        setNotice(`${label}を復元しました。公開MDRを読み込みます。再生はこのブラウザでPLAYを押して開始してください。`);
        sessionRestoreSourceLoadingRef.current = true;
        void loadRemoteEntry(payload.source.mdrUrl, payload.source.pdxUrl, label).finally(() => {
          sessionRestoreSourceLoadingRef.current = false;
        });
        return;
      }
      setMode("mml");
      setMml(payload.source.mml);
      setNotice(`${label}のMMLと再生上限を復元しました。再生はこのブラウザでPLAYを押して開始してください。`);
    };
    const shortSessionId = params.get("s")?.trim();
    if (shortSessionId) {
      void trpcUtils.sharedSession.get.fetch({ id: shortSessionId }).then((payload) => restoreSessionPayload(payload, "短縮共有セッション")).catch((error: unknown) => {
        setNotice(error instanceof Error ? error.message : "短縮共有セッションを復元できませんでした。リンクが正しいか確認してください。");
        void restorePersistedSoundFont();
      });
      return;
    }
    if (params.get("sd") !== "1") {
      void restorePersistedSoundFont();
      return;
    }
    const restoredMdr = params.get("mdr")?.trim() ?? "";
    const restoredPdx = params.get("pdx")?.trim() ?? "";
    const restoredMml = params.get("mml");
    if (restoredMdr) {
      restoreSessionPayload({ source: { kind: "remote", mdrUrl: restoredMdr, pdxUrl: restoredPdx || undefined }, loopCount: params.get("loops") === "infinite" ? 0 : bounded(params.get("loops"), 1, 1, 99), exportLimit: bounded(params.get("maxSec"), 60, 10, 600), catalogUrl: params.get("catalog")?.trim() ?? "", soundFontUrl: params.get("sf")?.trim() ?? "" }, "共有セッション");
      return;
    }
    if (restoredMml) {
      restoreSessionPayload({ source: { kind: "mml", mml: restoredMml }, loopCount: params.get("loops") === "infinite" ? 0 : bounded(params.get("loops"), 1, 1, 99), exportLimit: bounded(params.get("maxSec"), 60, 10, 600), catalogUrl: params.get("catalog")?.trim() ?? "", soundFontUrl: params.get("sf")?.trim() ?? "" }, "共有セッション");
      return;
    }
    void restorePersistedSoundFont();
  }, []);

  const sourceTitle = useMemo(() => {
    if (mode === "mml") return "UNTITLED MML SCORE";
    if (mode === "remote") return remoteSource?.title || "REMOTE MADRV SOURCE";
    return fileName?.toUpperCase() ?? "LOCAL FILE SOURCE";
  }, [fileName, mode, remoteSource]);

  const filteredCatalogEntries = useMemo(() => {
    const query = catalogQuery.trim().toLowerCase();
    if (!query) return catalogEntries;
    return catalogEntries.filter((entry) => [entry.title, entry.artist ?? "", ...entry.tags].join(" ").toLowerCase().includes(query));
  }, [catalogEntries, catalogQuery]);
  const remoteMdrIsDriveLink = useMemo(() => isGoogleDriveShareUrl(remoteMdr), [remoteMdr]);
  const remotePdxIsDriveLink = useMemo(() => isGoogleDriveShareUrl(remotePdx), [remotePdx]);
  const catalogIsDriveLink = useMemo(() => isGoogleDriveShareUrl(catalogUrl), [catalogUrl]);

  function initializeMixer(mdr: ArrayBuffer) {
    const tracks = listMdrMixerTracks(mdr);
    setMixerTracks(tracks);
    setMutedTracks([]);
    setSoloTrack(null);
    setTrackKeyState({});
    audio().setMdrMutedTracks([]);
  }

  function initializeMdxMixer(hasPdx: boolean) {
    const tracks: MdrMixerTrack[] = Array.from({ length: 16 }, (_, index) => ({
      index,
      engine: index < 8 ? "opm" : "pcm",
      label: index < 8 ? `OPM ${index + 1}` : `PCM ${index - 7}`,
      active: index < 8 || hasPdx,
      ...(index >= 8 ? { pcmVoice: index - 7 } : {}),
    }));
    setMixerTracks(tracks);
    setMutedTracks([]);
    setSoloTrack(null);
    setTrackKeyState({});
    audio().setMdrMutedTracks([]);
  }

  function applyMutedTracks(nextMuted: number[], message?: string) {
    const unique = Array.from(new Set(nextMuted));
    setMutedTracks(unique);
    audio().setMdrMutedTracks(unique);
    if (message) setNotice(message);
  }

  function toggleTrackMute(track: MdrMixerTrack) {
    setSoloTrack(null);
    const next = mutedTracks.includes(track.index) ? mutedTracks.filter((index) => index !== track.index) : [...mutedTracks, track.index];
    applyMutedTracks(next, `${track.label}を${next.includes(track.index) ? "ミュート" : "ミュート解除"}しました。`);
  }

  function toggleTrackSolo(track: MdrMixerTrack) {
    if (soloTrack === track.index) {
      setSoloTrack(null);
      applyMutedTracks([], "ソロを解除し、すべてのアクティブトラックを有効にしました。");
      return;
    }
    const next = mixerTracks.filter((candidate) => candidate.active && candidate.index !== track.index).map((candidate) => candidate.index);
    setSoloTrack(track.index);
    applyMutedTracks(next, `${track.label}をソロにしました。`);
  }

  async function loadLocalFiles(files: File[]) {
    await maybeRevertSessionSoundFontBeforeSourceLoad();
    const mdrFile = files.find((file) => file.name.toLowerCase().endsWith(".mdr"));
    const mdxFile = files.find((file) => file.name.toLowerCase().endsWith(".mdx"));
    const pdxFiles = files.filter((file) => file.name.toLowerCase().endsWith(".pdx"));
    const sourceFile = mdrFile ?? mdxFile;
    if (!sourceFile && !pdxFiles.length) {
      setNotice("MDR、MDX、またはPDXファイルを選択してください。");
      return;
    }
    setMode("local");
    setMmlError(null);
    try {
      const incomingPdx = await Promise.all(pdxFiles.map(async (file) => ({ name: file.name, data: await file.arrayBuffer() })));
      const mergedPdx = [...localPdxCandidates.filter((candidate) => !incomingPdx.some((incoming) => fileStem(incoming.name) === fileStem(candidate.name))), ...incomingPdx];
      if (incomingPdx.length) setLocalPdxCandidates(mergedPdx);
      const sourceBuffer = sourceFile ? await sourceFile.arrayBuffer() : localMdr;
      const pdxCandidate = incomingPdx[0] ?? (localPdxFileName ? { name: localPdxFileName, data: localPdx } : undefined);
      if (mdrFile) {
        const info = inspectMdr(sourceBuffer!);
        void diagnoseLoadedSource(sourceBuffer!, pdxCandidate?.data, info.hardwareTracks, info.midiTracks);
        setLocalMdr(sourceBuffer);
        setLocalSourceFormat("mdr");
        setLocalMdxPdxName("");
        setLocalMdxInfo(null);
        setLocalPdxAutoMatched(false);
        if (pdxCandidate?.data) {
          setLocalPdx(pdxCandidate.data);
          setLocalPdxFileName(pdxCandidate.name);
        }
        initializeMixer(sourceBuffer!);
        setMdrInfo(info);
        resetMdrEstimatedDuration();
        setFileName(mdrFile.name);
        setPlaylistEntries((current) => current.map((entry) => entry.origin === "local" && fileStem(entry.path ?? entry.title) === fileStem(mdrFile.name) ? { ...entry, source: sourceBuffer!, pdx: pdxCandidate?.data, pdxName: pdxCandidate?.name, format: "mdr" } : entry));
        rememberRecentSource({ id: `local:${mdrFile.name.toLowerCase()}`, kind: "local", label: mdrFile.name, format: "mdr", pdxName: pdxCandidate?.name });
        setNotice(`${info.title}を読込みました。OPM／PDX ${info.hardwareTracks}トラック、GS MIDI ${info.midiTracks}トラックを検出。${pdxCandidate?.data ? " PDXペアを使用できます。" : ""}`);
      }
      if (mdxFile) {
        const info = inspectMdx(sourceBuffer!);
        const requiredPdxName = info.pdxName === "UNTITLED" ? "" : info.pdxName;
        const matchingPdx = requiredPdxName ? mergedPdx.find((candidate) => fileStem(candidate.name) === fileStem(requiredPdxName)) : undefined;
        const hasMatchingPdx = !requiredPdxName || Boolean(matchingPdx);
        void diagnoseLoadedSource(sourceBuffer!, matchingPdx?.data, 8, 0);
        setLocalMdr(sourceBuffer);
        setLocalSourceFormat("mdx");
        setLocalMdxPdxName(requiredPdxName);
        setLocalMdxInfo(info);
        setLocalPdx(matchingPdx?.data);
        setLocalPdxFileName(matchingPdx?.name ?? "");
        setLocalPdxAutoMatched(Boolean(matchingPdx));
        setMdrInfo(null);
        setMdrEstimatedDuration(null);
        initializeMdxMixer(Boolean(matchingPdx?.data));
        setFileName(mdxFile.name);
        setPlaylistEntries((current) => current.map((entry) => entry.origin === "local" && fileStem(entry.path ?? entry.title) === fileStem(mdxFile.name) ? { ...entry, source: sourceBuffer!, pdx: matchingPdx?.data, pdxName: matchingPdx?.name, requiredPdxName, format: "mdx" } : entry));
        rememberRecentSource({ id: `local:${mdxFile.name.toLowerCase()}`, kind: "local", label: mdxFile.name, format: "mdx", pdxName: matchingPdx?.name ?? (requiredPdxName || undefined) });
        const requiredPdx = requiredPdxName ? ` PDX「${formatPdxFileName(requiredPdxName)}」を追加してください。` : "";
        setNotice(`MDX「${mdxFile.name}」を読込みました。${hasMatchingPdx && matchingPdx ? ` PDX「${matchingPdx.name}」を自動選択して` : requiredPdx || " PDXなしで"}OPM／PCM再生します。`);
      }
      if (incomingPdx.length && !sourceFile) {
        const matchingPdx = localSourceFormat === "mdx" && localMdxPdxName ? mergedPdx.find((candidate) => fileStem(candidate.name) === fileStem(localMdxPdxName)) : incomingPdx[0];
        if (matchingPdx) {
          setLocalPdx(matchingPdx.data);
          setLocalPdxFileName(matchingPdx.name);
          setLocalPdxAutoMatched(localSourceFormat === "mdx");
          if (localSourceFormat === "mdx") initializeMdxMixer(true);
          if (localSourceFormat === "mdr" && localMdr) resetMdrEstimatedDuration();
          const modeLabel = localSourceFormat === "mdx" ? "必要PDXとして自動選択しました。" : "MDRと組み合わせて完全再生します。";
          setNotice(`PDX「${matchingPdx.name}」を追加しました。${modeLabel}`);
        } else {
          setNotice(`PDX候補を${incomingPdx.length}件追加しました。必要PDX「${formatPdxFileName(localMdxPdxName)}」と一致するファイルを追加してください。`);
        }
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "MDR／PDXの読込に失敗しました。");
    }
  }

  async function loadLocalFolder(files: File[]) {
    await maybeRevertSessionSoundFontBeforeSourceLoad();
    const sources = files.filter((file) => /\.(mdr|mdx)$/i.test(file.name)).sort((left, right) => (left.webkitRelativePath || left.name).localeCompare(right.webkitRelativePath || right.name, "ja"));
    const pdxFiles = files.filter((file) => /\.pdx$/i.test(file.name));
    if (!sources.length) {
      setNotice("指定フォルダにMDR／MDXファイルが見つかりませんでした。");
      return;
    }
    try {
      const pdxCandidates = await Promise.all(pdxFiles.map(async (file) => ({ name: file.name, data: await file.arrayBuffer() })));
      const entries: PlaylistEntry[] = [];
      for (const file of sources) {
        const source = await file.arrayBuffer();
        const format = file.name.toLowerCase().endsWith(".mdx") ? "mdx" : "mdr";
        const info = format === "mdx" ? inspectMdx(source) : inspectMdr(source);
        const requiredPdx = format === "mdx" ? (info.pdxName === "UNTITLED" ? "" : info.pdxName) : info.pdxName;
        const pdx = requiredPdx ? pdxCandidates.find((candidate) => fileStem(candidate.name) === fileStem(requiredPdx)) : undefined;
        entries.push({
          id: `local:${file.webkitRelativePath || file.name}:${file.size}`,
          title: info.title || file.name,
          format,
          source,
          pdx: pdx?.data,
          pdxName: pdx?.name,
          requiredPdxName: requiredPdx,
          origin: "local",
          path: file.webkitRelativePath || file.name,
          loopCount: DEFAULT_PLAYLIST_LOOP_COUNT,
        });
      }
      setPlaylistEntries((current) => {
        const ids = new Set(current.map((entry) => entry.id));
        return [...current, ...entries.filter((entry) => !ids.has(entry.id))];
      });
      setPlaylistIndex((current) => current ?? (entries.length ? 0 : null));
      playlistRunRef.current = false;
      playlistStartRequestRef.current += 1;
      setNotice(`ローカルフォルダから${entries.length}曲をプレイリストへ追加しました。各曲は初期設定で${DEFAULT_PLAYLIST_LOOP_COUNT}回ループします。PDX未一致の曲は一覧で確認できます。`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "ローカルフォルダをプレイリストとして読み込めませんでした。");
    }
  }

  async function selectSource(event: ChangeEvent<HTMLInputElement>) {
    await loadLocalFiles(Array.from(event.target.files ?? []));
    event.target.value = "";
  }

  async function selectFolder(event: ChangeEvent<HTMLInputElement>) {
    await loadLocalFolder(Array.from(event.target.files ?? []));
    event.target.value = "";
  }

  async function selectSoundFont(event: ChangeEvent<HTMLInputElement>) {
    const soundfont = event.target.files?.[0];
    if (!soundfont) return;
    setSoundfontName("Loading SoundFont…");
    try {
      const data = await soundfont.arrayBuffer();
      await audio().loadSoundFontData(data);
      await persistLocalSoundFontSelection(soundfont, data);
      sessionSoundFontTemporaryRef.current = false;
      sessionInitialSourceKeyRef.current = null;
      setRemoteSoundfontUrl("");
      setSoundfontName(soundfont.name);
      setSoundFontByteLength(soundfont.size);
      activateSoundFontTimingProfile(`local:${soundfont.name}:${soundfont.size}:${soundfont.lastModified}`);
      setRemoteSoundfontProgress({ loadedBytes: soundfont.size, totalBytes: soundfont.size, stage: "ready" });
      setNotice("GS MIDI出力用のSoundFontを読み込みました。次回訪問時もこのブラウザから自動復元します。");
    } catch (error) {
      setSoundfontName("SoundFont load failed");
      setNotice(error instanceof Error ? `SoundFontを読み込めませんでした: ${error.message}` : "SoundFontを読み込めませんでした。");
      setRemoteSoundfontProgress(current => current ? { ...current, stage: "failed" } : { loadedBytes: 0, totalBytes: null, stage: "failed" });
    }
  }

  async function loadRemoteSoundFont(sourceUrl = remoteSoundfontUrl, options: { persistSelection?: boolean } = {}) {
    const persistSelection = options.persistSelection ?? true;
    setRemoteSoundfontLoading(true);
    setSoundfontName("Loading remote SoundFont…");
    setRemoteSoundfontProgress({ loadedBytes: 0, totalBytes: null, stage: "downloading" });
    try {
      const usesStorageProxy = isCloudShareLink(sourceUrl);
      const reportProgress = ({ loadedBytes, totalBytes }: { loadedBytes: number; totalBytes: number | null }) => setRemoteSoundfontProgress({ loadedBytes, totalBytes, stage: "downloading" });
      const result = usesStorageProxy ? await fetchSharedSoundFont(sourceUrl, reportProgress) : await fetchRemoteSoundFont(sourceUrl, reportProgress);
      const data = result.data;
      const downloadedBytes = data.byteLength;
      setRemoteSoundfontProgress({ loadedBytes: downloadedBytes, totalBytes: downloadedBytes, stage: "initializing" });
      await audio().loadSoundFontData(data);
      const resolvedUrl = result.resolvedUrl;
      const remoteName = new URL(resolvedUrl).pathname.split("/").filter(Boolean).at(-1) || "Remote SoundFont";
      setSoundfontName(`Remote · ${remoteName}`);
      setSoundFontByteLength(downloadedBytes);
      activateSoundFontTimingProfile(`remote:${sourceUrl.trim()}`);
      if (persistSelection) {
        persistRemoteSoundFontSelection(sourceUrl);
        sessionSoundFontTemporaryRef.current = false;
        sessionInitialSourceKeyRef.current = null;
      }
      const transport = "transport" in result ? result.transport : "direct";
      setNotice(persistSelection
        ? usesStorageProxy && transport === "proxy"
          ? "共有ストレージのSoundFontを補助取得経路からブラウザ内へ読み込みました。次回訪問時もこのブラウザから自動復元します。"
          : "CORS対応SoundFontをブラウザ内へ直接読み込みました。次回訪問時もこのブラウザから自動復元します。"
        : usesStorageProxy && transport === "proxy"
          ? "共有セッション指定のSoundFontを一時適用しました。別の曲を読み込むと、保存済みのSoundFontへ戻ります。"
          : "共有セッション指定のSoundFontを一時適用しました。別の曲を読み込むと、保存済みのSoundFontへ戻ります。");
      setRemoteSoundfontProgress({ loadedBytes: downloadedBytes, totalBytes: downloadedBytes, stage: "ready" });
    } catch (error) {
      setSoundfontName("Remote SoundFont load failed");
      setNotice(error instanceof Error ? error.message : "リモートSoundFontを読み込めませんでした。");
      setRemoteSoundfontProgress(current => current ? { ...current, stage: "failed" } : { loadedBytes: 0, totalBytes: null, stage: "failed" });
    } finally {
      setRemoteSoundfontLoading(false);
    }
  }

  function sourceKeyForRemote(mdrUrl: string, pdxUrl?: string) {
    return `remote:${mdrUrl.trim()}|${pdxUrl?.trim() ?? ""}`;
  }

  async function revertSessionSoundFontIfNeeded() {
    if (!sessionSoundFontTemporaryRef.current) return;
    sessionSoundFontTemporaryRef.current = false;
    sessionInitialSourceKeyRef.current = null;
    await restorePersistedSoundFont();
  }

  async function maybeRevertSessionSoundFontBeforeSourceLoad(nextSourceKey?: string) {
    if (!sessionSoundFontTemporaryRef.current || sessionRestoreSourceLoadingRef.current) return;
    if (nextSourceKey && sessionInitialSourceKeyRef.current === nextSourceKey) return;
    await revertSessionSoundFontIfNeeded();
  }

  async function loadDefaultSoundFont() {
    if (remoteSoundfontLoading) return;
    setRemoteSoundfontUrl(generalUserGsPresetUrl);
    await loadRemoteSoundFont(generalUserGsPresetUrl);
  }

  async function restorePersistedSoundFont() {
    const saved = readPersistedSoundFontSelection();
    if (!saved) {
      await loadDefaultSoundFont();
      return;
    }
    if (saved.kind === "remote") {
      setRemoteSoundfontUrl(saved.sourceUrl);
      await loadRemoteSoundFont(saved.sourceUrl);
      return;
    }
    setRemoteSoundfontLoading(true);
    setSoundfontName("Loading saved SoundFont…");
    setRemoteSoundfontProgress({ loadedBytes: 0, totalBytes: null, stage: "initializing" });
    try {
      const cached = await readCachedLocalSoundFont(saved);
      if (!cached) {
        setRemoteSoundfontLoading(false);
        await loadDefaultSoundFont();
        return;
      }
      await audio().loadSoundFontData(cached);
      setRemoteSoundfontUrl("");
      setSoundfontName(saved.name);
      setSoundFontByteLength(cached.byteLength);
      activateSoundFontTimingProfile(`local:${saved.name}:${saved.size}:${saved.lastModified}`);
      setRemoteSoundfontProgress({ loadedBytes: cached.byteLength, totalBytes: cached.byteLength, stage: "ready" });
      setNotice("前回選択したSoundFontをこのブラウザから復元しました。");
    } catch (error) {
      setSoundfontName("SoundFont load failed");
      setNotice(error instanceof Error ? `保存済みSoundFontを復元できませんでした: ${error.message}` : "保存済みSoundFontを復元できませんでした。デフォルトへ切り替えます。");
      setRemoteSoundfontProgress(current => current ? { ...current, stage: "failed" } : { loadedBytes: 0, totalBytes: null, stage: "failed" });
      setRemoteSoundfontLoading(false);
      await loadDefaultSoundFont();
    } finally {
      setRemoteSoundfontLoading(false);
    }
  }

  async function enableExternalMidi() {
    try {
      const devices = await audio().listMidiOutputs();
      setMidiDevices(devices);
      if (devices.length === 0) {
        setMidiOutputMode("soundfont");
        setNotice("外部MIDI出力は見つかりませんでした。機器を接続してから再試行してください。");
        return;
      }
      const defaultDevice = selectedMidiDevice || devices[0].id;
      await audio().selectMidiOutput(defaultDevice);
      setSelectedMidiDevice(defaultDevice);
      setMidiOutputMode("hardware");
      setNotice(`${devices.find((device) => device.id === defaultDevice)?.name ?? "外部MIDI機器"}へGS MIDIを出力します。`);
    } catch (error) {
      setMidiOutputMode("soundfont");
      setNotice(error instanceof Error ? error.message : "外部MIDI出力を初期化できませんでした。");
    }
  }

  async function changeMidiDevice(deviceId: string) {
    try {
      await audio().selectMidiOutput(deviceId);
      setSelectedMidiDevice(deviceId);
      setMidiOutputMode("hardware");
      setNotice(`${midiDevices.find((device) => device.id === deviceId)?.name ?? "外部MIDI機器"}へGS MIDIを出力します。`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "MIDI出力を切り替えられませんでした。");
    }
  }

  async function useSoundFont() {
    await audio().selectMidiOutput(undefined);
    setMidiOutputMode("soundfont");
    setNotice("GS MIDIはブラウザ内のSoundFontシンセサイザーへ出力します。");
  }

  function sendGsReset() {
    try {
      audio().sendGsReset();
      setNotice(midiOutputMode === "hardware" ? "GS Resetを選択中の外部MIDI機器へ送出しました。" : "内蔵SoundFontのGS状態をリセットしました。外部機器を選択するとGS Reset SysExも送出できます。");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "GS Resetを送出できませんでした。");
    }
  }

  function sendGsPartReceive(enabled: boolean) {
    try {
      audio().setGsPartReceive(gsPart, enabled);
      setNotice(`GS Part ${gsPart}の受信を${enabled ? "有効" : "無効"}にしました。`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "GS Part設定を送出できませんでした。");
    }
  }

  function testExternalGs() {
    try {
      const destination = audio().testExternalGs(gsPart);
      setNotice(`${destination}へGS Reset、Part ${gsPart}有効化、C4テストノート、All Notes Offを送出しました。`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "外部GS音源テストを実行できませんでした。");
    }
  }

  function applyGsPartPatch() {
    try {
      audio().setGsPartProgram(gsPart, gsPatch);
      setNotice(`GS Part ${gsPart}へPatch ${gsPatch}を適用しました。`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "GS Patchを適用できませんでした。");
    }
  }

  function applyGsPartLevel() {
    try {
      audio().setGsPartLevel(gsPart, gsPartLevel);
      setNotice(`GS Part ${gsPart}のレベルを${gsPartLevel}へ設定しました。`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "GSレベルを設定できませんでした。");
    }
  }

  function exportMidiDiagnostics() {
    const entries = audio().getDiagnostics();
    if (!entries.length) {
      setNotice("保存できる外部MIDI診断ログはまだありません。");
      return;
    }
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), entries }, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `madrv-gs-diagnostic-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
    setNotice("外部GS音源の診断ログをJSONとして保存しました。");
  }

  async function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(false);
    await loadLocalFiles(Array.from(event.dataTransfer.files ?? []));
  }

  async function loadRemoteEntry(mdrUrl: string, pdxUrl?: string, label?: string): Promise<{ source: ArrayBuffer; pdx?: ArrayBuffer; format: "mdr" | "mdx"; title: string } | undefined> {
    await maybeRevertSessionSoundFontBeforeSourceLoad(sourceKeyForRemote(mdrUrl, pdxUrl));
    setRemoteLoading(true);
    setMdrInfo(null);
    setMdrEstimatedDuration(null);
    try {
      const fetchBinary = async (url: string, kind: "mdr" | "mdx" | "pdx") => {
        if (isCloudShareLink(url)) {
          const proxied = await publicStorage.mutateAsync({ url, kind });
          return base64ToArrayBuffer(proxied.dataBase64);
        }
        let response: Response;
        try {
          response = await fetch(normalizeRemoteAssetUrl(url), { mode: "cors" });
        } catch {
          throw new Error(`${kind.toUpperCase()} URLを取得できませんでした。CORS対応URLか、Google Drive／Dropboxの公開共有リンクを指定してください。`);
        }
        if (!response.ok) throw new Error(`${kind.toUpperCase()} URLの取得に失敗しました（HTTP ${response.status}）。`);
        return response.arrayBuffer();
      };
      const requestedFormat = /\.mdx(?:$|[?#])/i.test(mdrUrl) ? "mdx" : "mdr";
      const [source, pdx] = await Promise.all([
        fetchBinary(mdrUrl.trim(), requestedFormat),
        pdxUrl?.trim() ? fetchBinary(pdxUrl.trim(), "pdx") : undefined,
      ]);
      const detected = inspectMadrvSource(source);
      const title = detected.info.title.trim() || label?.trim() || `REMOTE ${detected.format.toUpperCase()}`;
      if (detected.format === "mdr") {
        void diagnoseLoadedSource(source, pdx, detected.info.hardwareTracks, detected.info.midiTracks);
        setMdrInfo(detected.info);
        resetMdrEstimatedDuration();
        initializeMixer(source);
      } else {
        void diagnoseLoadedSource(source, pdx, 8, 0);
        setMdrInfo(null);
        setMdrEstimatedDuration(null);
        initializeMdxMixer(Boolean(pdx));
      }
      setRemoteSource({ source, pdx, format: detected.format, title });
      setRemoteMdr(mdrUrl.trim());
      setRemotePdx(pdxUrl?.trim() ?? "");
      setMode("remote");
      rememberRecentSource({ id: `remote:${mdrUrl.trim()}`, kind: "remote", label: title, format: detected.format, mdrUrl: mdrUrl.trim(), pdxUrl: pdxUrl?.trim() || undefined });
      setNotice(`リモート${detected.format.toUpperCase()}を読込みました。${title}${detected.format === "mdr" ? ` / ${detected.info.activeTracks} active tracks` : detected.info.pdxName ? ` / PDX ${formatPdxFileName(detected.info.pdxName)}` : " / PDXなし"}。データはブラウザのメモリ内だけで再生します。`);
      return { source, pdx, format: detected.format, title };
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "リモートMDR／MDXを取得できませんでした。");
      return undefined;
    } finally {
      setRemoteLoading(false);
    }
  }

  async function loadRemote() {
    if (!remoteMdr.trim()) {
      setNotice("先にMDR／MDX URLを入力してください。");
      return;
    }
    await loadRemoteEntry(remoteMdr, remotePdx);
  }

  async function loadCatalog() {
    if (!catalogUrl.trim()) {
      setNotice("先にCORS対応のカタログJSON URLを入力してください。");
      return;
    }
    setRemoteLoading(true);
    try {
      const trimmedCatalogUrl = catalogUrl.trim();
      const entries = isCloudShareLink(trimmedCatalogUrl)
        ? parseRemoteCatalogPayload(JSON.parse(new TextDecoder().decode(base64ToArrayBuffer((await publicStorage.mutateAsync({ url: trimmedCatalogUrl, kind: "catalog" })).dataBase64))))
        : await fetchRemoteCatalog(trimmedCatalogUrl);
      setCatalogEntries(entries);
      const playlistItems: PlaylistEntry[] = entries.map((entry) => ({ id: `remote:${entry.id}`, title: entry.title, format: entry.mdrUrl.toLowerCase().includes(".mdx") ? "mdx" : "mdr", remoteMdrUrl: entry.mdrUrl, remotePdxUrl: entry.pdxUrl, origin: "remote", path: entry.mdrUrl, loopCount: DEFAULT_PLAYLIST_LOOP_COUNT }));
      setPlaylistEntries((current) => {
        const ids = new Set(current.map((entry) => entry.id));
        return [...current, ...playlistItems.filter((entry) => !ids.has(entry.id))];
      });
      setPlaylistIndex((current) => current ?? (playlistItems.length ? 0 : null));
      playlistRunRef.current = false;
      playlistStartRequestRef.current += 1;
      setCatalogQuery("");
      setNotice(`リモートフォルダ／JSONから${entries.length}曲をプレイリストへ追加しました。各曲は初期設定で${DEFAULT_PLAYLIST_LOOP_COUNT}回ループします。`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "リモートカタログを取得できませんでした。");
    } finally {
      setRemoteLoading(false);
    }
  }

  function toggleCatalogFavorite(entry: RemoteCatalogEntry) {
    setFavoriteEntries((previous) => previous.some((favorite) => favorite.id === entry.id) ? previous.filter((favorite) => favorite.id !== entry.id) : [entry, ...previous].slice(0, 50));
  }

  function addCurrentSourceToPlaylist() {
    let entry: PlaylistEntry | undefined;
    if (mode === "local" && localMdr && localSourceFormat) {
      const title = localSourceFormat === "mdr" ? (mdrInfo?.title || fileName || "Local MDR") : (localMdxInfo?.title || fileName || "Local MDX");
      entry = { id: `local:${(fileName ?? title).toLowerCase()}`, title, format: localSourceFormat, source: localMdr, pdx: localPdx, pdxName: localPdxFileName || undefined, requiredPdxName: localSourceFormat === "mdx" ? localMdxPdxName || undefined : undefined, origin: "local", path: fileName ?? title, loopCount: DEFAULT_PLAYLIST_LOOP_COUNT };
    } else if (mode === "remote" && remoteMdr.trim()) {
      const mdrUrl = remoteMdr.trim();
      entry = { id: `remote:${mdrUrl}`, title: remoteSource?.title || playlistTitleFromUrl(mdrUrl), format: /\.mdx(?:$|[?#])/i.test(mdrUrl) ? "mdx" : "mdr", remoteMdrUrl: mdrUrl, remotePdxUrl: remotePdx.trim() || undefined, origin: "remote", path: mdrUrl, loopCount: DEFAULT_PLAYLIST_LOOP_COUNT };
    }
    if (!entry) {
      setNotice("ローカルまたはリモートのMDR／MDXを読み込んでからプレイリストへ追加してください。MMLスコアは対象外です。");
      return;
    }
    setPlaylistEntries((current) => {
      const index = current.findIndex((candidate) => candidate.id === entry.id);
      if (index < 0) return [...current, entry];
      return current.map((candidate, candidateIndex) => candidateIndex === index ? { ...candidate, ...entry, loopCount: candidate.loopCount ?? DEFAULT_PLAYLIST_LOOP_COUNT } : candidate);
    });
    setPlaylistIndex((current) => current ?? playlistEntries.length);
    setNotice(`「${entry.title}」をプレイリストへ追加しました。`);
  }

  function clearPlaylist() {
    playlistStartRequestRef.current += 1;
    playlistRunRef.current = false;
    audio().stop();
    setPlaylistEntries([]);
    setPlaylistIndex(null);
    setIsPlaying(false);
    setNotice("プレイリストを消去しました。");
  }

  function removeEntryFromPlaylist(entryId: string) {
    const removedIndex = playlistEntries.findIndex((entry) => entry.id === entryId);
    setPlaylistEntries((current) => current.filter((entry) => entry.id !== entryId));
    setPlaylistIndex((current) => current === null ? null : current === removedIndex ? null : current > removedIndex ? current - 1 : current);
  }

  function moveEntryInPlaylist(fromIndex: number, toIndex: number) {
    const activeId = playlistIndex === null ? undefined : playlistEntries[playlistIndex]?.id;
    const savedOrder = movePlaylistEntry(playlistEntries.map(toSavedPlaylistEntry), fromIndex, toIndex);
    const next = savedOrder.flatMap((saved) => {
      const original = playlistEntries.find((entry) => entry.id === saved.id);
      return original ? [{ ...original, ...saved }] : [];
    });
    setPlaylistEntries(next);
    if (activeId) setPlaylistIndex(next.findIndex((entry) => entry.id === activeId));
  }

  function updatePlaylistEntryLoops(entryId: string, loopCount: number) {
    setPlaylistEntries((current) => setPlaylistEntryLoopCount(current.map(toSavedPlaylistEntry), entryId, loopCount).flatMap((saved) => {
      const original = current.find((entry) => entry.id === saved.id);
      return original ? [{ ...original, ...saved }] : [];
    }));
  }

  function playAdjacentPlaylistEntry(direction: -1 | 1) {
    if (!playlistEntries.length) return;
    const current = playlistIndex ?? 0;
    const nextIndex = Math.max(0, Math.min(playlistEntries.length - 1, current + direction));
    const entry = playlistEntries[nextIndex];
    if (!entry) return;
    playlistRunRef.current = true;
    void playPlaylistEntry(entry.id);
  }

  function buildSharedSessionPayload() {
    const source = mode === "remote" && remoteMdr.trim()
      ? { kind: "remote" as const, mdrUrl: remoteMdr.trim(), ...(remotePdx.trim() ? { pdxUrl: remotePdx.trim() } : {}) }
      : { kind: "mml" as const, mml };
    return {
      source,
      loopCount,
      exportLimit,
      ...(catalogUrl.trim() ? { catalogUrl: catalogUrl.trim() } : {}),
      ...(remoteSoundfontUrl.trim() ? { soundFontUrl: remoteSoundfontUrl.trim() } : {}),
    };
  }

  async function copySessionLink() {
    try {
      const id = await sharedSessionCreate.mutateAsync(buildSharedSessionPayload());
      const link = `${window.location.origin}${window.location.pathname}?s=${id}`;
      setSessionLink(link);
      await navigator.clipboard.writeText(link);
      setNotice("短縮共有リンクをコピーしました。受信者は公開URL・MML・再生上限を復元し、自分でPLAYを押して開始できます。");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "短縮共有リンクを生成できませんでした。しばらくしてからもう一度お試しください。");
    }
  }

  async function playPlaylistEntry(entryId: string) {
    const requestId = ++playlistStartRequestRef.current;
    const index = playlistEntries.findIndex((candidate) => candidate.id === entryId);
    const entry = index >= 0 ? playlistEntries[index] : undefined;
    if (!entry) {
      setNotice("選択したプレイリスト項目が見つかりません。");
      return;
    }
    setPlaylistIndex(index);
    try {
      let source: { source: ArrayBuffer; pdx?: ArrayBuffer; format: "mdr" | "mdx"; title: string } | undefined;
      if (entry.origin === "remote") {
        source = await loadRemoteEntry(entry.remoteMdrUrl ?? "", entry.remotePdxUrl, entry.title);
      } else if (entry.source) {
        if (entry.format === "mdx" && entry.requiredPdxName && !entry.pdx) throw new Error(`必要PDX「${formatPdxFileName(entry.requiredPdxName)}」がフォルダ内に見つかりません。`);
        source = { source: entry.source, pdx: entry.pdx, format: entry.format, title: entry.title };
        setMode("local");
        setFileName(entry.path ?? entry.title);
        setLocalMdr(entry.source);
        setLocalPdx(entry.pdx);
        setLocalPdxFileName(entry.pdxName ?? "");
        setLocalSourceFormat(entry.format);
        if (entry.format === "mdr") {
          const info = inspectMdr(entry.source);
          void diagnoseLoadedSource(entry.source, entry.pdx, info.hardwareTracks, info.midiTracks);
          setMdrInfo(info);
          setLocalMdxInfo(null);
          setLocalMdxPdxName("");
          initializeMixer(entry.source);
          resetMdrEstimatedDuration();
        } else {
          const info = inspectMdx(entry.source);
          void diagnoseLoadedSource(entry.source, entry.pdx, 8, 0);
          setMdrInfo(null);
          setMdrEstimatedDuration(null);
          setLocalMdxInfo(info);
          setLocalMdxPdxName(entry.requiredPdxName ?? "");
          initializeMdxMixer(Boolean(entry.pdx));
        }
      } else {
        setMode("local");
        setPlaylistIndex(index);
        setNotice(`ローカル曲「${entry.title}」は、このセッションで読み込んだ本体がある間だけ再生可能です。ページ再読込後はリモート曲のみ保存され、ローカル曲はフォルダ／ファイルから再度 Add current してください。`);
        if (playlistRunRef.current) {
          const nextIndex = resolveNextPlaylistIndex(index, playlistEntries.length);
          if (nextIndex !== null) {
            void playPlaylistEntry(playlistEntries[nextIndex]!.id);
            return;
          }
          playlistRunRef.current = false;
        }
        return;
      }
      if (requestId !== playlistStartRequestRef.current) return;
      if (!source) throw new Error("プレイリストの曲データを取得できませんでした。");
      const playbackMdrInfo = source.format === "mdr" ? inspectMdr(source.source) : null;
      if (!ensureMidiPlaybackDestination((playbackMdrInfo?.midiTracks ?? 0) > 0)) return;
      // Playlist transitions can start before React applies the new source's
      // diagnosis. Choose the actual buffer profile before creating its node.
      const sourceProfile = tuningPreset === "auto" && requiresStableMadrvProfileForHybridTracks(playbackMdrInfo?.hardwareTracks ?? 0, playbackMdrInfo?.midiTracks ?? 0, midiOutputMode === "soundfont") ? "mobile" : activePerformanceProfile;
      audio().setPerformanceProfile(sourceProfile, safariCompatibilityMode);
      setElapsed(0);
      audio().setMaster(volume);
      audio().setLevel("opm", opmLevel);
      audio().setLevel("pcm", pcmLevel);
      audio().setLevel("midi", midiLevel);
      const entryLoopCount = normalizePlaylistLoopCount(entry.loopCount ?? DEFAULT_PLAYLIST_LOOP_COUNT);
      let singleLoopDuration = 0;
      const onEnd = () => {
        if (requestId !== playlistStartRequestRef.current) return;
        if (!playlistRunRef.current) return;
        const nextIndex = resolveNextPlaylistIndex(index, playlistEntries.length);
        if (nextIndex !== null) {
          const silenceSeconds = resolvePlaylistInterTrackSilenceSeconds(singleLoopDuration, entryLoopCount);
          const playNext = () => {
            if (requestId !== playlistStartRequestRef.current || !playlistRunRef.current) return;
            void playPlaylistEntry(playlistEntries[nextIndex]!.id);
          };
          void revertSessionSoundFontIfNeeded().then(() => {
            if (silenceSeconds > 0) {
              setIsPlaying(false);
              setNotice(`「${entry.title}」を${entryLoopCount}回再生しました。短い曲のため${silenceSeconds.toFixed(1)}秒の無音後に次の曲へ進みます（${nextIndex + 1} / ${playlistEntries.length}）。`);
              window.setTimeout(playNext, silenceSeconds * 1000);
            } else {
              setNotice(`「${entry.title}」を${entryLoopCount}回再生しました。次の曲へ進みます（${nextIndex + 1} / ${playlistEntries.length}）。`);
              playNext();
            }
          });
          return;
        }
        playlistRunRef.current = false;
        setIsPlaying(false);
        setNotice(`プレイリスト最終曲「${entry.title}」を${normalizePlaylistLoopCount(entry.loopCount ?? DEFAULT_PLAYLIST_LOOP_COUNT)}回再生しました。再生を停止しました。`);
      };
      const rendered = source.format === "mdx"
        ? await audio().playMdx(source.source, source.pdx, entryLoopCount, setElapsed, onEnd)
        : await audio().playMdr(source.source, source.pdx, entryLoopCount, setElapsed, onEnd);
      if (requestId !== playlistStartRequestRef.current) return;
      singleLoopDuration = rendered.duration;
      setDuration(rendered.duration);
      refreshAudioClock();
      setIsPlaying(true);
      setNotice(`プレイリスト ${index + 1} / ${playlistEntries.length}「${entry.title}」を${entryLoopCount}回ループで再生中です。`);
    } catch (error) {
      if (requestId !== playlistStartRequestRef.current) return;
      const message = error instanceof Error ? error.message : "プレイリストの曲を再生できませんでした。";
      const nextIndex = resolveNextPlaylistIndex(index, playlistEntries.length);
      if (playlistRunRef.current && nextIndex !== null) {
        setNotice(`${message} 次の曲へ進みます（${nextIndex + 1} / ${playlistEntries.length}）。`);
        void revertSessionSoundFontIfNeeded().then(() => {
          void playPlaylistEntry(playlistEntries[nextIndex]!.id);
        });
        return;
      }
      playlistRunRef.current = false;
      setIsPlaying(false);
      setNotice(message);
    }
  }

  async function togglePlayback() {
    if (isPlaying || isPreparingPlayback) {
      playlistStartRequestRef.current += 1;
      audio().stop();
      playlistRunRef.current = false;
      setIsPlaying(false);
      setIsPreparingPlayback(false);
      setNotice("再生を停止しました。");
      return;
    }
    setIsPreparingPlayback(true);
    setNotice(mode === "mml" ? "MML再生を準備しています…" : "MDR／MDX再生を準備しています。初回はWebAssembly音源の読込に少し時間がかかることがあります。もう一度押すと中止します。");
    try {
      if (playlistEntries.length && playlistIndex !== null) {
        const selectedEntry = playlistEntries[playlistIndex];
        if (!selectedEntry) throw new Error("選択したプレイリスト項目が見つかりません。");
        playlistRunRef.current = true;
        await playPlaylistEntry(selectedEntry.id);
        return;
      }
      if (mode !== "mml") {
        const source = mode === "local" ? (localMdr ? { source: localMdr, pdx: localPdx, format: localSourceFormat ?? "mdr" } : null) : remoteSource;
        if (!source) throw new Error("先にMDR／MDXファイルまたはCORS許可済みの共有URLを読み込んでください。");
        if (mode === "local" && localSourceFormat === "mdx" && localMdxPdxName && !source.pdx) {
          throw new Error(`このMDXはPDX「${formatPdxFileName(localMdxPdxName)}」を必要とします。MDXとPDXを同時に選択するか、PDXを追加してください。`);
        }
        if (mode === "local" && localSourceFormat === "mdx" && localMdxPdxName && fileStem(localPdxFileName) !== fileStem(localMdxPdxName)) {
          throw new Error(`このMDXはPDX「${formatPdxFileName(localMdxPdxName)}」を必要とします。現在のPDX「${localPdxFileName || "未選択"}」を入れ替えてください。`);
        }
        const playbackMdrInfo = source.format === "mdr" ? inspectMdr(source.source) : null;
        if (!ensureMidiPlaybackDestination((playbackMdrInfo?.midiTracks ?? 0) > 0)) return;
        // Playlist transitions can start before React applies the new source's
        // diagnosis. Choose the actual buffer profile before creating its node.
        const sourceProfile = tuningPreset === "auto" && requiresStableMadrvProfileForHybridTracks(playbackMdrInfo?.hardwareTracks ?? 0, playbackMdrInfo?.midiTracks ?? 0, midiOutputMode === "soundfont") ? "mobile" : activePerformanceProfile;
        audio().setPerformanceProfile(sourceProfile, safariCompatibilityMode);
        setElapsed(0);
        audio().setMaster(volume);
        audio().setLevel("opm", opmLevel);
        audio().setLevel("pcm", pcmLevel);
        audio().setLevel("midi", midiLevel);
        const rendered = source.format === "mdx"
          ? await audio().playMdx(source.source, source.pdx, loopCount, setElapsed, () => {
            setIsPlaying(false);
            setNotice("MDXのOPM／PDX再生が終了しました。");
          })
          : await audio().playMdr(source.source, source.pdx, loopCount, setElapsed, () => {
            setIsPlaying(false);
            setNotice("MDRのOPM／PDX再生が終了しました。GS MIDIは選択したSoundFontまたは外部MIDI出力へ送出されます。");
          });
        setDuration(rendered.duration);
        if (source.format === "mdr") setMdrEstimatedDuration(rendered.duration);
        refreshAudioClock();
        setIsPlaying(true);
        setNotice(loopCount === 0 ? `${rendered.format}をWebAssemblyで無限ループ再生中です。停止ボタンで終了します。` : `${rendered.format}をWebAssemblyで再生中です。ループ上限: ${loopCount}回。`);
        return;
      }
      const score = compileMml(mml);
      if (!ensureMidiPlaybackDestination(score.engines.includes("midi"))) return;
      setMmlError(null);
      setDuration(score.duration);
      setElapsed(0);
      audio().setMaster(volume);
      audio().setLevel("opm", opmLevel);
      audio().setLevel("pcm", pcmLevel);
      audio().setLevel("midi", midiLevel);
      await audio().play(score, setElapsed, () => {
        setIsPlaying(false);
        setNotice("MMLスコアの再生が終了しました。");
      });
      refreshAudioClock();
      setIsPlaying(true);
      setNotice(`${score.events.length}ノートを${score.engines.map((engine) => engine.toUpperCase()).join(" / ")}経路へ送出しています。`);
    } catch (error) {
      setIsPlaying(false);
      if (error instanceof MmlSyntaxError) {
        const message = `${error.line}行 ${error.column}列: ${error.message}`;
        setMmlError(message);
        setNotice(`MML構文エラー — ${message}`);
      } else {
        const fallback = mode === "mml" ? "MMLを再生できませんでした。" : "MDR／MDXを再生できませんでした。";
        setNotice(error instanceof Error ? error.message : typeof error === "string" ? error : fallback);
      }
    } finally {
      setIsPreparingPlayback(false);
    }
  }

  async function exportMml() {
    if (mode !== "mml") {
      setNotice("MP4書き出しは、現在実再生に対応しているMMLスコアから利用できます。");
      return;
    }
    try {
      const baseScore = compileMml(mml);
      const exportLoops = loopCount === 0 ? 1 : loopCount;
      const boundedScore = limitScore(baseScore, exportLoops, exportLimit);
      setMmlError(null);
      setElapsed(0);
      setDuration(boundedScore.duration);
      setIsExporting(true);
      setIsPlaying(true);
      setNotice(loopCount === 0 ? `∞通常再生は書き出し時に1回・最大${exportLimit}秒へ安全に有限化します。` : `最大${exportLimit}秒・${loopCount}回指定で有限化し、MP4書き出しを開始します。`);
      audio().setMaster(volume);
      audio().setLevel("opm", opmLevel);
      audio().setLevel("pcm", pcmLevel);
      audio().setLevel("midi", midiLevel);
      const result = await audio().exportVideo(boundedScore, setElapsed);
      const link = document.createElement("a");
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      link.href = URL.createObjectURL(result.blob);
      link.download = `madrv-signal-deck-${timestamp}.${result.extension}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
      setNotice(result.extension === "mp4" ? "音声付きMP4を書き出しました。" : "このブラウザはMP4記録に対応していないため、音声付きWebMとして書き出しました。");
    } catch (error) {
      if (error instanceof MmlSyntaxError) {
        const message = `${error.line}行 ${error.column}列: ${error.message}`;
        setMmlError(message);
        setNotice(`MML構文エラー — ${message}`);
      } else {
        setNotice(error instanceof Error ? error.message : "MP4書き出しに失敗しました。");
      }
    } finally {
      setIsPlaying(false);
      setIsExporting(false);
    }
  }

  const activeLevels: Record<string, [number, (value: number) => void]> = {
    opm: [opmLevel, setOpmLevel],
    pcm: [pcmLevel, setPcmLevel],
    midi: [midiLevel, setMidiLevel],
  };
  const hasActivePdx = mode === "local" ? Boolean(localPdx) : mode === "remote" ? Boolean(remoteSource?.pdx) : false;
  const mmlEngineFlags = useMemo(() => {
    if (mode !== "mml") return { midi: false, hardware: false };
    try {
      const engines = compileMml(mml).engines;
      return { midi: engines.includes("midi"), hardware: engines.includes("opm") || engines.includes("pcm") };
    } catch {
      return { midi: false, hardware: false };
    }
  }, [mml, mode]);
  // MDX always uses the OPM/PCM renderer; MDR uses hardwareTracks from inspectMdr.
  const opmPcmHardwareTracks = (mode === "local" && localSourceFormat === "mdx") || (mode === "remote" && remoteSource?.format === "mdx")
    ? 1
    : mdrInfo?.hardwareTracks ?? 0;
  const isEngineActive = (engineId: string) => {
    if (!isPlaying) return false;
    if (engineId === "opm") return isOpmPcmEngineArmed(isPlaying, opmPcmHardwareTracks, mmlEngineFlags.hardware);
    if (engineId === "pcm") return isPcmPdxEngineArmed(isPlaying, hasActivePdx, pcmActivityMask);
    if (engineId === "midi") return isGsMidiEngineArmed(isPlaying, mdrInfo?.midiTracks ?? 0, mmlEngineFlags.midi);
    return false;
  };
  const transportElapsed = elapsed;
  const transportProgress = playbackProgressPercent(transportElapsed, duration);
  const mmlTempo = useMemo(() => extractMmlInitialTempo(mml), [mml]);
  const estimatedBpm = mode === "mml" ? mmlTempo : timerBToEstimatedBpm(timerB ?? -1);
  const tempoSource = mode === "mml"
    ? "MML T command"
    : timerB === null
      ? "Timer-B awaiting"
      : mdrInfo && mdrInfo.hardwareTracks === 0
        ? "MDR $FF tempo / 48 PPQN"
        : "OPM Timer-B / 48 PPQN";
  const timerBHint = mode === "mml"
    ? "not used by MML"
    : mdrInfo && mdrInfo.hardwareTracks === 0
      ? "from MDR tempo command"
      : "live hardware register";
  const mdrMidiClockDeltaMs = mdrMidiSync?.hardwareMilliseconds === null || !mdrMidiSync ? null : mdrMidiSync.hardwareMilliseconds - mdrMidiSync.scheduledSeconds * 1000;

  return (
    <div className="ui-dense compact-deck relative min-h-screen">
      <header className="relative z-10 border-b border-white/10 bg-[#11120f]/85 backdrop-blur-xl">
        <div className="mx-auto flex h-[48px] max-w-[1600px] items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <SignalMark />
            <div className="brand-engraving">
              <p className="wordmark m-0 text-lg text-[#f5f4ec]">MADRV PLAYER</p>
              <p className="mono m-0 mt-0.5 text-[9px] uppercase tracking-[0.21em] text-[#a9aca2]">Signal Deck / 01</p>
            </div>
          </div>
          <div className="flex items-center gap-4 sm:gap-6">
            <span className="mono hidden items-center gap-2 text-[10px] uppercase tracking-[0.16em] text-[#a9aca2] sm:inline-flex"><span className="h-1.5 w-1.5 rounded-full bg-primary" />Browser local</span>
            <button type="button" data-testid="format-guide-button" onClick={() => setFormatGuideOpen(true)} className="mono flex items-center gap-1.5 text-[10px] uppercase tracking-[0.16em] text-[#d7d9d1] transition-colors hover:text-primary"><Info size={13} />Format guide</button>
          </div>
        </div>
      </header>
      <main className="compact-main program-workspace">
        <div className="compact-column program-source">
          <CompactPanel id="source" title="音源 / Source" defaultOpen summary={mode === "local" ? fileName ?? "Local file" : mode === "remote" ? "Remote URL" : "MML"}>
              <div className="flex overflow-x-auto border-b border-white/10">
                    {([
                      ["local", "LOCAL FILE", FolderOpen],
                      ["remote", "REMOTE URL", CloudDownload],
                      ["mml", "MML SCORE", KeyboardMusic],
                    ] as const).map(([id, label, Icon]) => <button key={id} aria-label={label} onClick={() => setMode(id)} className={`mono flex shrink-0 items-center gap-2 border-b-2 px-3 py-3 text-[10px] font-medium tracking-[0.12em] transition-colors ${mode === id ? "border-primary text-primary" : "border-transparent text-[#a9aca2] hover:text-[#f5f4ec]"}`}><Icon size={14} />{id === "local" ? "FILE" : id === "remote" ? "URL" : "MML"}</button>)}
                  </div>
              {mode === "mml" && <div className="pt-5">
                    <div className="flex items-center justify-between"><SmallLabel help={<>T, O, L, V, A–G, R, &lt;, &gt;, +, -, #、@OPM / @PCM / @MIDI に対応します。</>}>MML editor / channel 01</SmallLabel><span className="mono text-[10px] text-[#a9aca2]">{mml.length} chars</span></div>
                    <textarea value={mml} onChange={(event) => setMml(event.target.value)} spellCheck={false} className="mono mt-3 min-h-[176px] w-full resize-y border border-white/15 bg-[#11120f] p-4 text-sm leading-7 text-[#dfe1d8] outline-none transition-colors placeholder:text-[#6c7167] focus:border-primary" aria-label="MMLを入力" />
                    <div className="mt-3 flex flex-wrap items-center justify-between gap-3"><button onClick={() => { setMml(defaultMml); setMmlError(null); }} className="mono inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.12em] text-[#d8ff3e] hover:underline"><RotateCcw size={12} />Restore sample</button></div>
                    {mmlError && <p className="mono mt-3 border-l-2 border-[#ff746c] bg-[#ff746c]/10 px-3 py-2 text-[10px] leading-5 text-[#ffd6d2]">{mmlError}</p>}
                  </div>}
              {mode === "local" && <div className="compact-source-form"><div onDragOver={(event) => { event.preventDefault(); setIsDragging(true); }} onDragLeave={() => setIsDragging(false)} onDrop={onDrop} onClick={() => sourceInputRef.current?.click()} role="button" tabIndex={0} aria-label="音源ファイルを選択" onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); sourceInputRef.current?.click(); } }} className={`compact-dropzone grid place-items-center border border-dashed p-5 text-center transition-colors ${isDragging ? "border-primary bg-primary/[0.07]" : "border-white/20 bg-[#11120f] hover:border-primary/60"}`}>
                      <div><div className="mx-auto grid h-12 w-12 place-items-center border border-primary/60 text-primary"><Upload size={20} /></div><p className="display mb-0 mt-5 text-xl font-semibold tracking-[-0.04em] text-[#f5f4ec]">{fileName ?? "MDR / MDX / PDXを置く"}</p></div>
                    </div>
<input ref={sourceInputRef} type="file" multiple accept=".mdr,.mdx,.pdx,application/octet-stream" className="hidden" onChange={selectSource} />
<input ref={folderInputRef} type="file" multiple {...({ webkitdirectory: "", directory: "" } as Record<string, string>)} className="hidden" onChange={selectFolder} />
<div className="mt-3 flex flex-wrap items-center gap-3"><HelpTooltip label="音源ファイルの選択">クリックしてファイルを選択、またはここへドラッグ。MDR／MDXとPDXは同時選択、または後から追加できます。</HelpTooltip><button onClick={() => folderInputRef.current?.click()} className="mono shrink-0 border border-primary/45 bg-primary/[0.045] px-3 py-2 text-[9px] uppercase tracking-[0.08em] text-primary transition-colors hover:bg-primary hover:text-primary-foreground">Folder / playlist</button></div></div>}
              {mode === "remote" && <div className="compact-source-form"><div><div className="flex items-center justify-between gap-3"><SmallLabel help={<>通常URLはCORS応答が必要です。Google Drive／Dropboxの<strong>公開共有リンク</strong>は、このサービスの許可済み取得経路で読み込むためブラウザ側CORSに依存しません。ログイン必須・閲覧制限・ダウンロード禁止のファイルは取得しません。</>}>Remote MDR / MDX URL</SmallLabel>{isCloudShareLink(remoteMdr) && <span className="mono text-[9px] uppercase tracking-[0.09em] text-primary">Share proxy ready</span>}</div><input value={remoteMdr} onChange={(event) => setRemoteMdr(event.target.value)} placeholder="https://storage.example/song.mdr または song.mdx／Drive・Dropbox共有リンク" className="mono mt-2 w-full border border-white/15 bg-[#11120f] px-3 py-3 text-xs text-[#f5f4ec] outline-none placeholder:text-[#62675d] focus:border-primary" /></div>
<div><div className="flex items-center justify-between gap-3"><SmallLabel>Companion PDX URL / optional</SmallLabel>{isCloudShareLink(remotePdx) && <span className="mono text-[9px] uppercase tracking-[0.09em] text-primary">Share proxy ready</span>}</div><input value={remotePdx} onChange={(event) => setRemotePdx(event.target.value)} placeholder="https://storage.example/song.pdx または Drive／Dropbox共有リンク" className="mono mt-2 w-full border border-white/15 bg-[#11120f] px-3 py-3 text-xs text-[#f5f4ec] outline-none placeholder:text-[#62675d] focus:border-primary" /></div>
<div className="flex items-center gap-2"><Button onClick={loadRemote} disabled={remoteLoading} className="h-9 rounded-none bg-primary px-3 text-[10px] font-semibold text-primary-foreground hover:bg-[#e5ff76]">{remoteLoading ? <LoaderCircle size={14} className="animate-spin" /> : <CloudDownload size={14} />}{remoteLoading ? "Loading" : "Load source"}</Button></div>
<CompactPanel id="catalog" title="リモートカタログ" summary={`${catalogEntries.length} 曲`}><div className="flex items-center justify-between"><SmallLabel help={<>配列または<code>entries</code> / <code>tracks</code> / <code>songs</code>配列を受け付けます。これをリモートフォルダ用マニフェストとして扱い、各項目は<code>mdrUrl</code>（MDXも可）と任意の<code>pdxUrl</code>を指定します。Google Drive／Dropboxは<strong>公開共有JSONファイル</strong>を指定してください。フォルダのHTML一覧は取得しません。</>}>Remote catalog / JSON</SmallLabel><span className={`mono text-[9px] ${catalogIsDriveLink ? "text-primary" : "text-[#a9aca2]"}`}>{catalogIsDriveLink ? "DRIVE DETECTED" : "CORS REQUIRED"}</span></div>
<div className="mt-3 grid gap-2 sm:grid-cols-[190px_1fr_auto]"><select value={catalogSourcePreset} onChange={(event) => { const preset = event.target.value as "cors" | "google-drive" | "dropbox" | "signal-deck-demo"; setCatalogSourcePreset(preset); if (preset === "signal-deck-demo") { setCatalogUrl(signalDeckDemoCatalogUrl); setNotice("Signal DeckのCORS検証済み診断カタログをセットしました。LOAD CATALOGで最小MDRを読み込めます。"); } else if (preset !== "cors") setNotice(`${preset === "google-drive" ? "Google Drive" : "Dropbox"}共有JSONを選択しました。公開共有ファイルのリンクを貼り付けてLOADを押してください。`); }} className="mono border border-white/15 bg-[#11120f] px-3 py-2.5 text-[10px] text-[#dfe1d8] outline-none focus:border-primary"><option value="cors">Custom CORS JSON</option><option value="signal-deck-demo">Signal Deck diagnostic catalog</option><option value="google-drive">Google Drive shared JSON</option><option value="dropbox">Dropbox shared JSON</option></select><input value={catalogUrl} onChange={(event) => setCatalogUrl(event.target.value)} placeholder={catalogSourcePreset === "signal-deck-demo" ? signalDeckDemoCatalogUrl : catalogSourcePreset === "google-drive" ? "https://drive.google.com/file/d/FILE_ID/view" : catalogSourcePreset === "dropbox" ? "https://www.dropbox.com/scl/fi/.../catalog.json" : "https://storage.example/madrv-catalog.json"} className="mono min-w-0 border border-white/15 bg-[#11120f] px-3 py-2.5 text-[10px] text-[#f5f4ec] outline-none placeholder:text-[#62675d] focus:border-primary" /><button onClick={loadCatalog} disabled={remoteLoading} className="mono border border-white/25 px-3 py-2 text-[9px] uppercase tracking-[0.08em] text-[#dfe1d8] transition-colors hover:border-primary hover:text-primary disabled:opacity-35">Load catalog</button></div>
{(catalogEntries.length > 0 || favoriteEntries.length > 0) && <div className="mt-3">
                        <input value={catalogQuery} onChange={(event) => setCatalogQuery(event.target.value)} placeholder="タイトル、作者、タグを検索" className="mono w-full border border-white/10 bg-[#11120f] px-3 py-2 text-[10px] text-[#f5f4ec] outline-none placeholder:text-[#62675d] focus:border-primary" />
                        <div className="mt-2 max-h-52 overflow-y-auto border border-white/10 bg-[#11120f]">
                          {filteredCatalogEntries.slice(0, 24).map((entry) => { const favorite = favoriteEntries.some((item) => item.id === entry.id); return <div key={entry.id} className="grid grid-cols-[1fr_auto] gap-2 border-b border-white/5 px-3 py-2 last:border-b-0"><button onClick={() => { setPlaylistIndex(playlistEntries.findIndex((candidate) => candidate.id === `remote:${entry.id}`)); playlistRunRef.current = false; void loadRemoteEntry(entry.mdrUrl, entry.pdxUrl, entry.title); }} className="min-w-0 text-left"><span className="mono block truncate text-[10px] text-[#f5f4ec] hover:text-primary">{entry.title}</span><span className="mono block truncate pt-1 text-[8px] text-[#a9aca2]">{[entry.artist, ...entry.tags].filter(Boolean).join(" · ") || entry.mdrUrl}</span></button><button onClick={() => toggleCatalogFavorite(entry)} className={`mono self-center border px-2 py-1 text-[9px] ${favorite ? "border-primary bg-primary text-primary-foreground" : "border-white/20 text-[#a9aca2] hover:border-primary hover:text-primary"}`}>{favorite ? "★" : "☆"}</button></div>; })}
                          {!filteredCatalogEntries.length && favoriteEntries.length > 0 && favoriteEntries.filter((entry) => [entry.title, entry.artist ?? "", ...entry.tags].join(" ").toLowerCase().includes(catalogQuery.trim().toLowerCase())).map((entry) => <div key={`favorite-${entry.id}`} className="grid grid-cols-[1fr_auto] gap-2 border-b border-white/5 px-3 py-2 last:border-b-0"><button onClick={() => { setPlaylistIndex(playlistEntries.findIndex((candidate) => candidate.id === `remote:${entry.id}`)); playlistRunRef.current = false; void loadRemoteEntry(entry.mdrUrl, entry.pdxUrl, entry.title); }} className="min-w-0 text-left"><span className="mono block truncate text-[10px] text-primary">★ {entry.title}</span><span className="mono block truncate pt-1 text-[8px] text-[#a9aca2]">{entry.artist ?? entry.mdrUrl}</span></button><button onClick={() => toggleCatalogFavorite(entry)} className="mono self-center border border-white/20 px-2 py-1 text-[9px] text-[#a9aca2] hover:border-primary hover:text-primary">☆</button></div>)}
                          {!filteredCatalogEntries.length && !favoriteEntries.length && <p className="mono m-0 px-3 py-3 text-[9px] text-[#72776d]">該当する曲なし</p>}
                        </div>
                      </div>}
</CompactPanel></div>}
            </CompactPanel>
          <CompactPanel id="playlist" defaultOpen title="プレイリスト" summary={`${playlistEntries.length} 曲`}><div className="compact-playlist" aria-label="プレイリスト" data-testid="saved-playlist">
                      <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-2"><ListMusic size={15} className="text-primary" /><div><SmallLabel help={<>曲別のループ回数で連続再生し、10秒以下の曲は開始から11秒になるまで無音を入れます。最後の曲で停止します。ローカル曲は同一セッション内のみ（再読込後はリモート曲だけ保存）。<br /><br />ローカルまたはリモートの音源を読み込んで、Add currentでプレイリストへ登録できます。リモートカタログやフォルダ選択で読み込んだ曲も追加されます。</>}>Saved playlist</SmallLabel></div></div><div className="flex flex-wrap gap-1.5"><button onClick={addCurrentSourceToPlaylist} disabled={mode === "mml"} className="mono border border-white/25 px-2.5 py-2 text-[8px] uppercase tracking-[0.07em] text-[#dfe1d8] transition-colors hover:border-primary hover:text-primary disabled:opacity-35">Add current</button><button onClick={() => playAdjacentPlaylistEntry(-1)} disabled={!playlistEntries.length || playlistIndex === null} className="mono border border-white/20 px-2.5 py-2 text-[8px] uppercase tracking-[0.07em] text-[#a9aca2] hover:border-primary hover:text-primary disabled:opacity-35">Prev</button><button onClick={() => playAdjacentPlaylistEntry(1)} disabled={!playlistEntries.length || playlistIndex === null} className="mono border border-white/20 px-2.5 py-2 text-[8px] uppercase tracking-[0.07em] text-[#a9aca2] hover:border-primary hover:text-primary disabled:opacity-35">Next</button><button onClick={clearPlaylist} disabled={!playlistEntries.length} className="mono border border-[#ff9b94]/35 px-2.5 py-2 text-[8px] uppercase tracking-[0.07em] text-[#ffb8b2] transition-colors hover:bg-[#ff9b94]/10 disabled:opacity-35">Clear</button><button onClick={() => { const selectedEntry = playlistIndex === null ? undefined : playlistEntries[playlistIndex]; if (selectedEntry) { playlistRunRef.current = true; void playPlaylistEntry(selectedEntry.id); } }} disabled={playlistIndex === null || isPlaying} className="mono border border-primary/55 px-3 py-2 text-[9px] uppercase tracking-[0.08em] text-primary transition-colors hover:bg-primary hover:text-primary-foreground disabled:opacity-35">Play selected</button></div></div>
                    {playlistEntries.length > 0 && <div className="mt-3 max-h-64 overflow-y-auto border border-white/10 bg-[#11120f]">
                      {playlistEntries.map((entry, index) => { const pdxMissing = entry.format === "mdx" && Boolean(entry.requiredPdxName) && !entry.pdx; const selected = index === playlistIndex; const entryLoops = normalizePlaylistLoopCount(entry.loopCount ?? DEFAULT_PLAYLIST_LOOP_COUNT); return <div key={entry.id} draggable onDragStart={(event) => { setPlaylistDragIndex(index); event.dataTransfer.effectAllowed = "move"; }} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); if (playlistDragIndex !== null) moveEntryInPlaylist(playlistDragIndex, index); setPlaylistDragIndex(null); }} onDragEnd={() => setPlaylistDragIndex(null)} className={`compact-playlist-entry grid grid-cols-[auto_1fr_auto] gap-2 border-b border-white/5 px-3 py-2 last:border-b-0 ${selected ? "bg-primary/[0.08]" : "hover:bg-white/[0.035]"}`}><span className={`mono cursor-grab pt-1 text-[9px] ${selected ? "text-primary" : "text-[#8b9085]"}`}>{String(index + 1).padStart(2, "0")}</span><button type="button" data-testid={`playlist-entry-${index}`} data-playlist-entry-id={entry.id} onClick={() => { playlistRunRef.current = true; void playPlaylistEntry(entry.id); }} className="min-w-0 text-left"><span data-testid={`playlist-entry-title-${index}`} className="mono block truncate text-[10px] text-[#f5f4ec]">{entry.title}</span><span data-testid={`playlist-entry-path-${index}`} className="mono block truncate pt-0.5 text-[8px] text-[#8b9085]">{entry.origin.toUpperCase()} · {entry.format.toUpperCase()} · {entry.path ?? "remote URL"}</span></button><div className="flex items-center gap-1"><label className="mono flex items-center gap-1 text-[8px] text-[#a9aca2]">×<input aria-label={`${entry.title}のループ回数`} type="number" min={1} max={99} value={entryLoops} onChange={(event) => updatePlaylistEntryLoops(entry.id, Number(event.target.value))} className="mono w-9 border border-white/15 bg-black/20 px-1 py-1 text-center text-[9px] text-[#f5f4ec] outline-none focus:border-primary" /></label><button type="button" aria-label={`${entry.title}を上へ移動`} disabled={index === 0} onClick={() => moveEntryInPlaylist(index, index - 1)} className="mono border border-white/15 px-1.5 py-1 text-[8px] text-[#a9aca2] hover:border-primary hover:text-primary disabled:opacity-25">↑</button><button type="button" aria-label={`${entry.title}を下へ移動`} disabled={index === playlistEntries.length - 1} onClick={() => moveEntryInPlaylist(index, index + 1)} className="mono border border-white/15 px-1.5 py-1 text-[8px] text-[#a9aca2] hover:border-primary hover:text-primary disabled:opacity-25">↓</button><button type="button" aria-label={`${entry.title}をプレイリストから削除`} onClick={() => removeEntryFromPlaylist(entry.id)} className="mono border border-[#ff9b94]/35 px-1.5 py-1 text-[8px] text-[#ffb8b2] hover:bg-[#ff9b94]/10">×</button><span className={`mono self-center text-[8px] uppercase tracking-[0.08em] ${pdxMissing ? "text-[#ff9b94]" : selected && isPlaying ? "text-primary" : "text-[#a9aca2]"}`}>{pdxMissing ? "PDX missing" : selected && isPlaying ? "playing" : "ready"}</span></div></div>; })}
                    </div>}

                  </div></CompactPanel>
          {recentSources.length > 0 && <CompactPanel id="recent" title="最近の音源" summary={`${recentSources.length} 件`}>{recentSources.length > 0 && <div aria-label="最近使用した音源" data-testid="recent-sources" className="mt-4 border border-white/10 bg-[#11120f] p-3">
                    <div className="flex items-center justify-between gap-3"><SmallLabel help={<>公開URLのみワンクリック再読込。ローカルファイルはブラウザ制約で履歴に残せません。</>}>Recent sources / remote URLs</SmallLabel><button type="button" onClick={clearSourceHistory} className="mono text-[8px] uppercase tracking-[0.08em] text-[#a9aca2] hover:text-primary">Clear</button></div>

                    <div className="mt-2 divide-y divide-white/10">{recentSources.map((source) => <div key={source.id} className="flex items-center gap-2 py-2 first:pt-0 last:pb-0"><button type="button" onClick={() => reopenRecentSource(source)} className="min-w-0 flex-1 text-left"><span className="mono block truncate text-[10px] text-[#f5f4ec] hover:text-primary">{source.label}</span><span className="mono block truncate pt-0.5 text-[8px] uppercase tracking-[0.08em] text-[#8b9085]">Remote · reload · {source.format?.toUpperCase() ?? "MADRV"}{source.pdxName ? ` · ${source.pdxName}` : ""}</span></button><button type="button" aria-label={`履歴から${source.label}を削除`} onClick={() => removeSourceHistory(source.id)} className="mono shrink-0 border border-white/15 px-2 py-1 text-[8px] text-[#a9aca2] hover:border-[#ff9b94] hover:text-[#ffb8b2]">×</button></div>)}</div>
                  </div>}</CompactPanel>}
          {(mdrInfo || localMdxInfo) && <CompactPanel id="source-info" title="音源情報 / PDX" summary={mdrInfo ? `${mdrInfo.activeTracks} tracks` : "MDX"}>
              {mode === "local" && <>{localSourceFormat === "mdx" && localMdxInfo && <div className="mt-4 border border-primary/30 bg-primary/[0.045] p-4">
                      <div className="flex items-center justify-between gap-3"><SmallLabel help={<>MDXとPDXを同時に選ぶか、必要なPDXを後から追加すると、同名ファイルを自動選択します。</>}>MDX link analysis</SmallLabel><span className={`mono text-[9px] uppercase tracking-[0.1em] ${localPdx ? "text-primary" : "text-[#ffb8b2]"}`}>{localPdx ? "PDX READY" : localMdxPdxName ? "PDX REQUIRED" : "PDX NOT REQUIRED"}</span></div>
                      <dl className="mt-3 grid gap-x-4 gap-y-3 sm:grid-cols-2">
                        <div><dt className="mono text-[9px] uppercase tracking-[0.12em] text-[#a9aca2]">MDX title</dt><dd className="mono mt-1 break-words text-xs text-[#f5f4ec]">{localMdxInfo.title}</dd></div>
                        <div><dt className="mono text-[9px] uppercase tracking-[0.12em] text-[#a9aca2]">Required PDX</dt><dd className="mono mt-1 break-words text-xs text-[#f5f4ec]">{localMdxPdxName ? formatPdxFileName(localMdxPdxName) : "Not required"}</dd></div>
                        <div><dt className="mono text-[9px] uppercase tracking-[0.12em] text-[#a9aca2]">Linked PDX</dt><dd className="mono mt-1 break-words text-xs text-[#f5f4ec]">{localPdxFileName || "Not selected"}</dd></div>
                        <div><dt className="mono text-[9px] uppercase tracking-[0.12em] text-[#a9aca2]">Link method</dt><dd className="mono mt-1 text-xs text-[#f5f4ec]">{localPdx ? (localPdxAutoMatched ? "Auto-matched" : "Selected") : "Awaiting PDX"}</dd></div>
                        <div><dt className="mono text-[9px] uppercase tracking-[0.12em] text-[#a9aca2]">PCM activity</dt><dd className={`mono mt-1 text-xs ${pcmActivityMask > 0 ? "text-primary" : "text-[#a9aca2]"}`}>{pcmActivityMask > 0 ? `Active · ch ${Array.from({ length: 8 }, (_, channel) => channel + 1).filter((channel) => (pcmActivityMask & (1 << (channel - 1))) !== 0).join(", ")}` : "Awaiting PCM activity"}</dd></div>
                        <div><dt className="mono text-[9px] uppercase tracking-[0.12em] text-[#a9aca2]">Engine output</dt><dd className={`mono mt-1 text-xs ${mixOutputPeak > 0 ? "text-primary" : "text-[#a9aca2]"}`}>{mixOutputPeak > 0 ? `Non-zero · peak ${mixOutputPeak}` : "Awaiting playback"}</dd></div>
                      </dl>
                      <p className="mono mt-3 border-t border-white/10 pt-3 text-[9px] leading-5 text-[#a9aca2]">PDX候補: {localPdxCandidates.length ? localPdxCandidates.map((candidate) => candidate.name).join(" · ") : "なし"}</p>
                    </div>}
{localSourceFormat === "mdr" && mdrInfo && <MdrMetadataPanel info={mdrInfo} linkedPdxName={localPdxFileName} sourceLabel="Local MDR" estimatedDuration={mdrEstimatedDuration} />}</>}
              {mode === "remote" && mdrInfo && <MdrMetadataPanel info={mdrInfo} linkedPdxName={remotePdx} sourceLabel="Remote MDR" estimatedDuration={mdrEstimatedDuration} />}
            </CompactPanel>}
          <CompactPanel id="share" defaultOpen title="セッション共有" summary="Short link"><div className="compact-share-actions flex items-center gap-1"><HelpTooltip label="セッション共有">公開MDR／PDX／SoundFont URL、MML、ループ上限を短い共有IDで復元します。音声・ローカルファイル・外部MIDI機器・診断ログは共有しません。既存の長い共有URLも引き続き開けます。</HelpTooltip><Button onClick={copySessionLink} disabled={sharedSessionCreate.isPending} variant="outline" className="h-10 shrink-0 rounded-none border-primary/50 px-3 text-[10px] font-medium uppercase tracking-[0.08em] text-primary hover:bg-primary/10"><Share2 size={14} />{sharedSessionCreate.isPending ? "Creating" : "Copy short link"}</Button></div>
{sessionLink && <input value={sessionLink} readOnly onFocus={(event) => event.currentTarget.select()} aria-label="共有セッションリンク" className="mono mt-3 w-full border border-white/15 bg-[#11120f] px-3 py-2 text-[9px] text-[#dfe1d8] outline-none focus:border-primary" />}</CompactPanel>
          <CompactPanel id="export" defaultOpen title="動画書き出し" summary="MP4 / WebM"><div className="compact-export"><label className="block"><SmallLabel>最大秒数</SmallLabel><input type="number" min="10" max="600" value={exportLimit} onChange={(event) => setExportLimit(Math.max(10, Math.min(600, Number(event.target.value) || 60)))} className="mono mt-2 w-full border border-white/15 bg-[#11120f] px-3 py-2 text-xs text-[#f5f4ec] outline-none focus:border-primary" /></label>
<div className="flex items-center gap-1 self-end"><HelpTooltip label="動画書き出し">∞設定でも書き出しは1回・最大秒数に制限されます。</HelpTooltip><Button onClick={exportMml} disabled={isExporting} className="self-end rounded-none bg-[#e4e6dc] px-4 py-5 text-[10px] font-bold uppercase tracking-[0.1em] text-[#11120f] hover:bg-primary">{isExporting ? <LoaderCircle size={15} className="animate-spin" /> : <FileAudio size={15} />}{isExporting ? "Rendering" : "Export MP4"}</Button></div></div></CompactPanel>
        </div>
        <section className="program-deck primary-deck" aria-label="Program Deck" data-testid="program-deck">
        <section className="compact-transport" aria-label="再生コントロール">
          <span className="mono program-deck-label">Program Deck</span><div className="compact-title-row"><h1 data-testid="source-title" title={sourceTitle}>{sourceTitle}</h1><span className="mono compact-clock">{formatTime(elapsed)} / {duration ? formatTime(duration) : "--:--.---"}</span><span className="mono compact-tempo">{estimatedBpm ? `${estimatedBpm.toFixed(1)} BPM` : "— BPM"}</span></div>
          <div data-testid="primary-transport-controls" className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-2 border-b border-white/10 pb-3 sm:gap-3 sm:pb-4">
                  <div className="flex items-center gap-2">
                    <Button onClick={togglePlayback} size="icon" className="h-11 w-11 rounded-none bg-primary text-primary-foreground shadow-[3px_3px_0_0_rgba(216,255,62,0.16)] transition-transform active:scale-95 hover:bg-[#e5ff76] sm:h-12 sm:w-12" aria-label={isPlaying || isPreparingPlayback ? "停止" : "再生"}>{isPlaying ? <CircleStop size={20} /> : isPreparingPlayback ? <LoaderCircle size={20} className="animate-spin" /> : <Play size={20} fill="currentColor" />}</Button>
                    <Button onClick={() => { playlistStartRequestRef.current += 1; playlistRunRef.current = false; audio().stop(); setIsPlaying(false); setElapsed(0); setNotice("再生を停止しました。"); }} variant="outline" className="h-11 rounded-none border-white/20 px-3 text-[#f5f4ec] hover:border-primary hover:bg-primary/5 hover:text-primary sm:h-12 sm:px-4"><CircleStop size={16} />停止</Button>
                    <Button onClick={() => setMml(defaultMml)} variant="ghost" className="h-11 rounded-none px-2 text-[#a9aca2] hover:text-primary sm:h-12 sm:px-3" aria-label="MMLを初期状態に戻す"><RotateCcw size={16} /></Button>
                  </div>
                  <div className="flex min-w-0 items-center gap-1 sm:ml-auto sm:w-full sm:max-w-[420px] sm:gap-3"><Volume2 size={15} className="shrink-0 text-primary sm:h-[17px] sm:w-[17px]" /><input type="range" min="0" max="100" value={volume} onChange={(event) => { const value = Number(event.target.value); setVolume(value); audio().setMaster(value); }} className="range-control min-w-0" aria-label="マスター音量" /><span className="mono w-6 shrink-0 text-right text-[10px] text-[#dfe1d8] sm:w-8 sm:text-[11px]">{volume}</span></div><div className="compact-loop mono"><label htmlFor="playback-loop-count">Loop</label><input id="playback-loop-count" type="number" min="1" max="99" disabled={loopCount === 0} value={loopCount === 0 ? "" : loopCount} placeholder="∞" onChange={(event) => setLoopCount(Math.max(1, Math.min(99, Number(event.target.value) || 1)))} aria-label="ループ回数" /><button type="button" aria-label="無限ループを切り替える" aria-pressed={loopCount === 0} onClick={() => setLoopCount(current => current === 0 ? 1 : 0)}>∞</button></div></div>
          <div className="signal-window calibrated-rules relative h-[52px] overflow-hidden border-y border-white/10 bg-[#11120f]" role="progressbar" aria-label="再生位置" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(transportProgress)}>
                  <div className="absolute inset-0 opacity-50" style={{ backgroundImage: "repeating-linear-gradient(90deg, rgba(245,244,236,.14) 0 1px, transparent 1px 40px)" }} />
                  <div className="absolute inset-x-3 bottom-3 h-[2px] bg-white/15"><div className="h-full bg-primary/60" style={{ width: `${transportProgress}%`, transition: isMobile ? "width 200ms linear" : undefined }} /></div>
                  <div className="absolute inset-x-3 top-2 flex items-center justify-between"><span className="mono text-[9px] uppercase tracking-[0.16em] text-[#a9aca2]">Playback position</span><span data-testid="playback-position" className="mono text-[10px] text-primary">{transportProgress.toFixed(1)}%</span></div>
                  <div className="absolute inset-x-3 inset-y-0 will-change-transform" data-testid="playback-marker" style={{ transform: `translate3d(${transportProgress}%, 0, 0)`, transition: isMobile ? "transform 200ms linear" : undefined }}><div className="absolute -left-[4px] bottom-[7px] h-2.5 w-2.5 rotate-45 border border-primary bg-[#11120f] shadow-[0_0_12px_2px_rgba(216,255,62,.16)]" /></div>
                </div>
          <p data-testid="playback-notice" role="status" className="mono m-0 border-l-2 border-primary/60 bg-primary/[0.045] px-3 py-2 text-[10px] leading-5 text-[#dfe1d8]">{notice}</p>
        </section>
          <CompactPanel id="matrix" defaultOpen title="鍵盤 / Track matrix" summary={`${activeMixerTracks.length} tracks · ${mutedTracks.length} muted`}><div className="compact-matrix"><span className="sr-only">トラックごとにミュートとソロを切り替えられます。</span><div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 pb-2">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1"><SmallLabel help={<>C0–B7 · OPM / MIDI · PCM mute</>}>Track matrix / MDR & MDX mixer</SmallLabel></div>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex border border-white/20" role="group" aria-label="鍵盤マトリックス表示モード">
                    <button type="button" aria-pressed={keyboardMatrixMode === "tracks"} onClick={() => setKeyboardMatrixMode("tracks")} className={`mono px-2.5 py-1 text-[8px] uppercase tracking-[0.08em] ${keyboardMatrixMode === "tracks" ? "bg-primary text-primary-foreground" : "text-[#a9aca2] hover:text-primary"}`}>All tracks</button>
                    <button type="button" aria-pressed={keyboardMatrixMode === "engines"} onClick={() => setKeyboardMatrixMode("engines")} className={`mono border-l border-white/20 px-2.5 py-1 text-[8px] uppercase tracking-[0.08em] ${keyboardMatrixMode === "engines" ? "bg-primary text-primary-foreground" : "text-[#a9aca2] hover:text-primary"}`}>OPM / MIDI</button>
                  </div>
                  <span className="mono text-[9px] text-[#a9aca2]">{activeMixerTracks.length} ACTIVE · {mutedTracks.length} MUTED</span>
                </div>
              </div>
{activeMixerTracks.length === 0 ? <p className="mono matrix-empty text-xs text-muted-foreground">音源未選択</p> : keyboardMatrixMode === "engines" ? (
                <div className="mt-2 flex flex-col gap-1" data-testid="keyboard-matrix-engines">
                  {ENGINE_BUS_ORDER.map((engine) => {
                    const busTracks = mixerTracksByEngine[engine];
                    if (!busTracks.length) return null;
                    const notes = mergeEngineBusNotes(busTracks, trackKeyState, mutedTracks, engine);
                    const meta = ENGINE_BUS_META[engine];
                    const lit = notes.map((note) => formatMidiNoteName(note)).join(" ");
                    const mutedBusCount = busTracks.filter((track) => mutedTracks.includes(track.index)).length;
                    return <div key={engine} className="flex items-center gap-2 bg-[#11120f] px-2 py-1.5">
                      <div className="w-[4.5rem] shrink-0">
                        <p className={`mono m-0 text-[11px] font-medium ${meta.tone}`}>{meta.label}</p>
                        <p className="mono m-0 mt-0.5 text-[7px] uppercase tracking-[0.08em] text-[#8b9085]">{busTracks.length} ch{mutedBusCount ? ` · ${mutedBusCount}m` : ""}</p>
                      </div>
                      <span className={`mono w-16 shrink-0 truncate text-center text-[11px] font-semibold leading-none tracking-tight ${lit ? "text-primary" : "text-[#6f746a]"}`} title={lit || "Awaiting"}>{lit || "·"}</span>
                      <TrackFullKeyboard label={meta.label} midiNotes={notes} muted={false} dense={false} />
                    </div>;
                  })}
                </div>
              ) : (
                <div className="mt-2 flex flex-col gap-px bg-white/10" data-testid="keyboard-matrix-tracks">
                  {activeMixerTracks.map((track) => {
                    const muted = mutedTracks.includes(track.index);
                    const solo = soloTrack === track.index;
                    const isPad = track.engine === "pcm";
                    const tone = track.engine === "opm" ? "text-primary" : isPad ? "text-[#b9c9b1]" : "text-[#a8c5ec]";
                    const keys = trackKeyState[track.index] ?? emptyMidiNotes;
                    const lit = isPad ? "" : (!muted && keys.length > 0 ? keys.map((note) => formatMidiNoteName(note)).join(" ") : "");
                    return <div key={track.index} className={`flex items-center gap-1.5 bg-[#11120f] px-1.5 py-1 ${muted ? "opacity-55" : ""}`}>
                      <p className={`mono m-0 w-[3.6rem] shrink-0 truncate text-[9px] font-medium ${tone}`} title={track.label}>{track.label}</p>
                      <span className={`mono w-12 shrink-0 truncate text-center text-[11px] font-semibold leading-none tracking-tight ${muted ? "text-[#ff9b94]" : lit ? "text-primary" : "text-[#6f746a]"}`} title={lit || (muted ? "Muted" : isPad ? "Pad · live keyboard" : "Awaiting")}>{muted ? "MUTE" : isPad ? "PAD" : lit || "·"}</span>
                      {isPad
                        ? <div className="min-w-0 flex-1" aria-hidden="true" />
                        : <TrackFullKeyboard label={track.label} midiNotes={keys} muted={muted} />}
                      <div className="flex shrink-0 gap-0.5">
                        <button type="button" aria-label={`${track.label}のミュートを${muted ? "オフ" : "オン"}にする`} aria-pressed={muted} onClick={() => toggleTrackMute(track)} className={`mono border px-1 py-0.5 text-[7px] tracking-[0.06em] ${muted ? "border-[#ff746c] bg-[#52241f]/30 text-[#ffb0a8]" : "border-white/20 text-[#dfe1d8] hover:border-primary hover:text-primary"}`} title={muted ? "Mute on" : "Mute off"}>{muted ? "M*" : "M"}</button>
                        <button type="button" aria-label={`${track.label}を${solo ? "ソロ解除" : "ソロ"}にする`} aria-pressed={solo} onClick={() => toggleTrackSolo(track)} className={`mono border px-1 py-0.5 text-[7px] tracking-[0.06em] ${solo ? "border-primary bg-primary text-primary-foreground" : "border-white/20 text-[#dfe1d8] hover:border-primary hover:text-primary"}`}>S</button>
                      </div>
                    </div>;
                  })}
                </div>
              )}</div></CompactPanel>
          {activeMixerTracks.length > 0 && <CompactPanel id="activity" title="トラック発音状況" summary={`${activeMixerTracks.length} tracks`}><div data-testid="track-key-overview"><ChannelNoteState tracks={activeMixerTracks} trackKeyState={trackKeyState} mutedTracks={mutedTracks} pcmActivityMask={pcmActivityMask} /></div></CompactPanel>}
        </section>
        <div className="compact-column program-output">
          <CompactPanel ref={soundFontPanelRef} id="soundfont" title="SoundFont / MIDI" defaultOpen summary={soundfontName}>
              <div className="flex items-center gap-1"><HelpTooltip label="SoundFont・MIDI出力">GS向けSF2/DLSをローカルから選べます。MMLの@MIDIおよびMDRのMIDIトラックに使用します。<br /><br />外部出力では@MIDIのノートとAll Notes Offを選択機器へ送出します。OPM・PCMはブラウザ内で鳴ります。</HelpTooltip><button ref={soundFontBankButtonRef} data-testid="soundfont-bank-button" onClick={() => sf2InputRef.current?.click()} className="mt-2 flex w-full items-center justify-between border border-white/15 bg-[#11120f] p-3 text-left outline-none transition-colors hover:border-primary/70 focus:border-primary focus:ring-1 focus:ring-primary/50"><span className="mono max-w-[190px] truncate text-[10px] text-[#e4e6dc]">{soundfontName}</span><ChevronDown size={15} className="text-primary" /></button></div>
<input ref={sf2InputRef} type="file" accept=".sf2,.sf3,.dls" className="hidden" onChange={selectSoundFont} />

              <div className="compact-midi-destination mt-3 grid grid-cols-2 gap-1 border border-white/15 bg-[#11120f] p-1">
                      <button onClick={useSoundFont} className={`mono px-2 py-2 text-[9px] uppercase tracking-[0.08em] transition-colors ${midiOutputMode === "soundfont" ? "bg-primary text-primary-foreground" : "text-[#a9aca2] hover:text-[#f5f4ec]"}`}>SoundFont</button>
                      <button onClick={enableExternalMidi} className={`mono px-2 py-2 text-[9px] uppercase tracking-[0.08em] transition-colors ${midiOutputMode === "hardware" ? "bg-primary text-primary-foreground" : "text-[#a9aca2] hover:text-[#f5f4ec]"}`}>External MIDI</button>
                    </div>
              {midiOutputMode === "hardware" && <select value={selectedMidiDevice} onChange={(event) => changeMidiDevice(event.target.value)} className="mono mt-3 w-full border border-white/15 bg-[#11120f] px-3 py-3 text-[10px] text-[#f5f4ec] outline-none focus:border-primary"><option value="" disabled>出力機器を選択</option>{midiDevices.map((device) => <option key={device.id} value={device.id}>{device.name}</option>)}</select>}
              <CompactPanel id="remote-soundfont" title="SoundFontをURLから読み込む" summary={remoteSoundfontLoading ? "Loading…" : undefined}><div className="flex items-center justify-between"><SmallLabel help={<>Default SoundFontはこのボタンだけで自動ロードします。CORS対応URLはブラウザから直接読み込みます。Google Drive／Dropbox共有リンクは、直接読込が許可されない場合だけ8 MB単位の補助取得へ切り替え、最大320 MBまで読み込みます。共有設定は「リンクを知っている全員・閲覧者」、ダウンロード制限は解除してください。</>}>Remote SoundFont / CORS</SmallLabel></div>
<div className="mt-2 flex gap-1.5"><input value={remoteSoundfontUrl} onChange={(event) => setRemoteSoundfontUrl(event.target.value)} placeholder="https://example.org/gs.sf2 またはDrive／Dropbox共有リンク" className="mono min-w-0 flex-1 border border-white/15 bg-[#11120f] px-2.5 py-2 text-[9px] text-[#f5f4ec] outline-none placeholder:text-[#62675d] focus:border-primary" /><button onClick={() => void loadRemoteSoundFont()} disabled={remoteSoundfontLoading} className="mono border border-white/25 px-2 text-[8px] uppercase tracking-[0.07em] text-[#dfe1d8] transition-colors hover:border-primary hover:text-primary disabled:opacity-35">{remoteSoundfontLoading ? <LoaderCircle size={12} className="animate-spin" /> : "Load"}</button></div>
<button onClick={() => void loadDefaultSoundFont()} disabled={remoteSoundfontLoading} className="mono mt-2 w-full border border-primary/35 bg-primary/[0.04] px-2 py-2 text-left text-[8px] uppercase tracking-[0.06em] text-[#dfe1d8] transition-colors hover:border-primary hover:text-primary disabled:opacity-35">{remoteSoundfontLoading ? "Loading default SoundFont…" : "Load default SoundFont · GeneralUser GS v1.471"}</button>
{remoteSoundfontProgress && <div data-testid="remote-soundfont-progress" className={`mt-3 border p-2.5 ${remoteSoundfontProgress.stage === "failed" ? "border-[#ff9b94]/50 bg-[#ff9b94]/[0.04]" : "border-primary/30 bg-primary/[0.035]"}`}><div className="flex items-center justify-between gap-3"><span className={`mono text-[8px] uppercase tracking-[0.08em] ${remoteSoundfontProgress.stage === "failed" ? "text-[#ff9b94]" : "text-primary"}`}>{remoteSoundfontProgress.stage === "downloading" ? "SoundFont downloading" : remoteSoundfontProgress.stage === "initializing" ? "Download complete · initializing" : remoteSoundfontProgress.stage === "ready" ? "SoundFont ready" : "SoundFont load failed"}</span><span data-testid="remote-soundfont-progress-percent" className="mono text-[9px] text-[#dfe1d8]">{remoteSoundfontProgress.totalBytes && remoteSoundfontProgress.totalBytes > 0 ? `${Math.min(100, Math.round(remoteSoundfontProgress.loadedBytes / remoteSoundfontProgress.totalBytes * 100))}%` : "SIZE UNKNOWN"}</span></div><div role="progressbar" aria-label="SoundFont download progress" aria-valuemin={0} aria-valuemax={remoteSoundfontProgress.totalBytes ?? undefined} aria-valuenow={remoteSoundfontProgress.totalBytes ? Math.min(remoteSoundfontProgress.loadedBytes, remoteSoundfontProgress.totalBytes) : undefined} aria-valuetext={remoteSoundfontProgress.totalBytes ? `${formatByteSize(remoteSoundfontProgress.loadedBytes)} / ${formatByteSize(remoteSoundfontProgress.totalBytes)}` : `${formatByteSize(remoteSoundfontProgress.loadedBytes)} received`} className="mt-2 h-px overflow-hidden bg-white/15"><div className={`h-full transition-[width] duration-150 ${remoteSoundfontProgress.stage === "failed" ? "bg-[#ff9b94]" : "bg-primary"} ${remoteSoundfontProgress.totalBytes ? "" : "animate-pulse"}`} style={{ width: `${remoteSoundfontProgress.totalBytes && remoteSoundfontProgress.totalBytes > 0 ? Math.max(0, Math.min(100, remoteSoundfontProgress.loadedBytes / remoteSoundfontProgress.totalBytes * 100)) : 16}%` }} /></div><p data-testid="remote-soundfont-progress-bytes" className="mono mb-0 mt-2 text-[8px] leading-4 text-[#a9aca2]">{formatByteSize(remoteSoundfontProgress.loadedBytes)}{remoteSoundfontProgress.totalBytes ? ` / ${formatByteSize(remoteSoundfontProgress.totalBytes)}` : " received · total size not provided"}{remoteSoundfontProgress.stage === "initializing" ? " · SoundFontを初期化中" : remoteSoundfontProgress.stage === "ready" ? " · ready" : ""}</p></div>}</CompactPanel>
            </CompactPanel>
          <CompactPanel id="levels" title="出力レベル" defaultOpen summary={`OPM / PCM ${opmLevel}% · MIDI ${midiLevel}%`}>
              <div className="compact-levels">{engineRows.map(engine => { const [level, setLevel] = activeLevels[engine.id]; return <label key={engine.id} className="compact-level"><span className="mono">{engine.label}</span><EngineStatus active={isEngineActive(engine.id)} /><input type="range" min="0" max="100" value={level} onChange={event => { const value = Number(event.target.value); if (engine.id === "opm") { setOpmLevel(value); setPcmLevel(value); audio().setLevel("opm", value); audio().setLevel("pcm", value); } else { setLevel(value); audio().setLevel("midi", value); } }} className="range-control" aria-label={`${engine.label}の出力レベル`} /><span className="mono">{level}%</span></label>; })}</div>
            </CompactPanel>
          <CompactPanel id="timing" title="MIDIのタイミング補正" summary={midiOutputMode === "soundfont" ? `SF ${activeSoundFontMdrDelayMs} ms` : `MIDI ${externalMidiAdvanceMs} ms`}>
              {midiOutputMode === "soundfont" && <div aria-label="SoundFont MDR遅延補正" data-testid="soundfont-timing-profile" className="mt-3 border border-[#8fa7cc]/40 bg-[#8fa7cc]/[0.05] p-3">
                      <div className="flex items-center justify-between gap-3"><SmallLabel help={<>-350〜+350 ms。推奨は端末の音声バッファ・出力遅延・再生プロファイルから算出します。実測は OPM/PCM と GS MIDI の MXDRV クロック差分です。OPM／PCMが遅れて聞こえるときは + を増やして GS MIDI を後ろへずらします。読込済みSoundFontでは音源ごとに自動保存・復元します。<br /><br />A/B試聴は保存値を変更しません。再生中でも切り替えられ、先行スケジュール済みのMIDIを除く次のイベントから反映されます。</>}>SoundFont MDR timing correction</SmallLabel><button type="button" onClick={resetSoundFontMdrDelay} className="mono text-[8px] uppercase tracking-[0.08em] text-primary hover:text-[#f5f4ec]">Reset</button></div>
                      <p className="mono mb-0 mt-2 truncate text-[8px] uppercase tracking-[0.08em] text-[#c2d6f4]">{soundFontProfileKey ? `Bank profile · ${soundfontName}` : "Common profile · no SoundFont selected"}</p>
                      <dl className="mt-3 grid gap-2 border-y border-white/10 py-3 text-[9px] sm:grid-cols-2">
                        <div><dt className="mono flex items-center gap-1 text-[#8b9085]">推奨<HelpTooltip label="SoundFont補正の推奨値">{soundFontMdrDelayRecommendation.reason}</HelpTooltip></dt><dd data-testid="soundfont-timing-recommended" className="mono m-0 mt-1 text-[#f5f4ec]">{soundFontMdrDelayRecommendation.totalMs >= 0 ? "+" : ""}{soundFontMdrDelayRecommendation.totalMs} ms</dd></div>
                        <div><dt className="mono flex items-center gap-1 text-[#8b9085]">実測<HelpTooltip label="SoundFont補正の実測値">{soundFontMdrDelayMeasurement ? `残差 ${soundFontMdrDelayMeasurement.residualMs >= 0 ? "+" : ""}${Math.round(soundFontMdrDelayMeasurement.residualMs)} ms · ${soundFontMdrDelayMeasurement.sampleCount} samples` : "MDR再生中に MXDRV クロックで推定"}</HelpTooltip></dt><dd data-testid="soundfont-timing-measured" className="mono m-0 mt-1 text-[#f5f4ec]">{soundFontMdrDelayMeasurement ? `${soundFontMdrDelayMeasurement.suggestedTotalMs >= 0 ? "+" : ""}${Math.round(soundFontMdrDelayMeasurement.suggestedTotalMs)} ms` : isPlaying && mdrInfo?.hardwareTracks ? "計測中…" : "—"}</dd></div>
                      </dl>
                      <div className="mt-2 flex flex-wrap gap-2"><button type="button" data-testid="soundfont-timing-apply-recommended" onClick={() => changeSoundFontMdrDelay(soundFontMdrDelayRecommendation.totalMs)} className="mono border border-white/20 px-2.5 py-2 text-[8px] uppercase tracking-[0.08em] text-[#dfe1d8] transition-colors hover:border-primary hover:text-primary">推奨を適用</button>{soundFontMdrDelayMeasurement && <button type="button" data-testid="soundfont-timing-apply-measured" onClick={() => changeSoundFontMdrDelay(Math.round(soundFontMdrDelayMeasurement.suggestedTotalMs))} className="mono border border-[#8fa7cc]/45 px-2.5 py-2 text-[8px] uppercase tracking-[0.08em] text-[#c2d6f4] transition-colors hover:border-primary hover:text-primary">実測を適用</button>}</div>
                      <label className="mt-2 block"><span className="mono text-[9px] text-[#dfe1d8]">発音補正</span><div className="mt-1 flex items-stretch gap-2"><input aria-label="SoundFont MDR発音補正 ms" type="text" inputMode="text" autoComplete="off" value={soundFontMdrDelayDraft} onChange={(event) => updateSoundFontMdrDelayDraft(event.target.value)} onBlur={commitSoundFontMdrDelayDraft} className="mono min-w-0 flex-1 border border-white/15 bg-[#11120f] px-2.5 py-2 text-[10px] text-[#f5f4ec] outline-none focus:border-primary" /><span className="mono self-center text-[9px] text-[#c2d6f4]">ms</span><span className="grid shrink-0 overflow-hidden border border-white/15 bg-[#11120f]"><button type="button" aria-label="SoundFont MDR発音補正を1 ms増やす" data-testid="soundfont-timing-step-up" onClick={() => stepSoundFontMdrDelay(1)} className="mono grid h-4 w-6 place-items-center border-b border-white/15 text-[9px] leading-none text-[#dfe1d8] transition-colors hover:bg-primary hover:text-primary-foreground active:scale-[0.97]">▲</button><button type="button" aria-label="SoundFont MDR発音補正を1 ms減らす" data-testid="soundfont-timing-step-down" onClick={() => stepSoundFontMdrDelay(-1)} className="mono grid h-4 w-6 place-items-center text-[9px] leading-none text-[#dfe1d8] transition-colors hover:bg-primary hover:text-primary-foreground active:scale-[0.97]">▼</button></span></div></label>
                      <div aria-label="SoundFont補正A/B試聴" data-testid="soundfont-ab-preview" data-active-delay-ms={String(activeSoundFontMdrDelayMs)} className="mt-3 grid grid-cols-2 gap-1.5"><button type="button" aria-pressed={soundFontTimingComparisonMode === "corrected"} onClick={() => setSoundFontTimingComparisonMode("corrected")} className={`mono border px-2 py-2 text-[8px] uppercase tracking-[0.06em] transition-colors ${soundFontTimingComparisonMode === "corrected" ? "border-primary bg-primary text-primary-foreground" : "border-white/20 text-[#dfe1d8] hover:border-primary hover:text-primary"}`}>A · 補正あり {soundFontMdrDelayMs >= 0 ? "+" : ""}{soundFontMdrDelayMs} ms</button><button type="button" aria-pressed={soundFontTimingComparisonMode === "uncompensated"} onClick={() => setSoundFontTimingComparisonMode("uncompensated")} className={`mono border px-2 py-2 text-[8px] uppercase tracking-[0.06em] transition-colors ${soundFontTimingComparisonMode === "uncompensated" ? "border-[#c2d6f4] bg-[#8fa7cc]/20 text-[#dbe9ff]" : "border-white/20 text-[#dfe1d8] hover:border-[#c2d6f4] hover:text-[#dbe9ff]"}`}>B · 補正なし 0 ms</button></div>


                    </div>}{midiOutputMode === "hardware" && <div aria-label="外部MIDI遅延補正" className="mt-3 border border-primary/30 bg-primary/[0.04] p-3"><div className="flex items-center justify-between gap-3"><SmallLabel help={<>+ は送出を前倒しします。-250〜+250 ms。負数は「-」からそのまま入力でき、矢印キーではカレットだけを移動します。外部MIDIだけに適用し、このブラウザに保存します。SoundFont／OPM／PCMには影響しません。</>}>External MIDI timing correction</SmallLabel><button type="button" onClick={() => changeExternalMidiAdvance(0)} className="mono text-[8px] uppercase tracking-[0.08em] text-primary hover:text-[#f5f4ec]">Reset</button></div><label className="mt-2 block"><span className="mono text-[9px] text-[#dfe1d8]">送出補正</span><div className="mt-1 flex items-center gap-2"><input aria-label="外部MIDI送出補正 ms" type="text" inputMode="text" autoComplete="off" value={externalMidiAdvanceDraft} onChange={(event) => updateExternalMidiAdvanceDraft(event.target.value)} onBlur={commitExternalMidiAdvanceDraft} className="mono min-w-0 flex-1 border border-white/15 bg-[#11120f] px-2.5 py-2 text-[10px] text-[#f5f4ec] outline-none focus:border-primary" /><span className="mono text-[9px] text-primary">ms</span></div></label></div>}
            </CompactPanel>
          {(localMdr || remoteSource || loadDiagnosis.measuring) && <CompactPanel id="advisor" title="再生設定 / Playback advisor" summary={activePerformanceProfile === "mobile" ? "安定優先" : "標準 / 低遅延"}>
              <PlaybackAdvisorPanel diagnosis={loadDiagnosis} activeProfile={activePerformanceProfile} tuningPreset={tuningPreset} safariCompatibilityMode={safariCompatibilityMode} onSelect={setTuningPreset} />
            </CompactPanel>}
          <CompactPanel id="sysex" title="GSパート設定 / SysEx" summary={`Part ${gsPart}`}><div className="flex items-center justify-between"><SmallLabel help={<>GS Reset、Part Rx On/OffはRoland DT1形式で送出します。テストはC4を約0.4秒鳴らし、必ずAll Notes Offで終了します。</>}>GS SysEx / Function call</SmallLabel><span className="mono text-[9px] text-[#a9aca2]">DT1</span></div>
<div className="mt-3 grid grid-cols-[1fr_auto] gap-2"><label><SmallLabel>Part</SmallLabel><select value={gsPart} onChange={(event) => setGsPart(Number(event.target.value))} className="mono mt-2 w-full border border-white/15 bg-[#11120f] px-3 py-2.5 text-[10px] text-[#f5f4ec] outline-none focus:border-primary">{Array.from({ length: 16 }).map((_, index) => <option key={index} value={index + 1}>Part {index + 1}</option>)}</select></label><button onClick={sendGsReset} className="mono self-end border border-white/30 px-3 py-2.5 text-[9px] uppercase tracking-[0.1em] text-[#dfe1d8] transition-colors hover:border-primary hover:text-primary">GS Reset</button></div>
<div className="mt-2 grid grid-cols-2 gap-2"><label><SmallLabel>Patch</SmallLabel><input type="number" min="0" max="127" value={gsPatch} onChange={(event) => setGsPatch(Math.max(0, Math.min(127, Number(event.target.value) || 0)))} className="mono mt-2 w-full border border-white/15 bg-[#11120f] px-2 py-2 text-[10px] text-[#f5f4ec] outline-none focus:border-primary" /></label><label><SmallLabel>Level</SmallLabel><input type="number" min="0" max="127" value={gsPartLevel} onChange={(event) => setGsPartLevel(Math.max(0, Math.min(127, Number(event.target.value) || 0)))} className="mono mt-2 w-full border border-white/15 bg-[#11120f] px-2 py-2 text-[10px] text-[#f5f4ec] outline-none focus:border-primary" /></label></div>
<div className="mt-2 grid grid-cols-2 gap-1"><button onClick={applyGsPartPatch} className="mono border border-white/15 bg-[#11120f] px-2 py-2 text-[9px] uppercase tracking-[0.08em] text-[#dfe1d8] transition-colors hover:border-primary hover:text-primary">Apply patch</button><button onClick={applyGsPartLevel} className="mono border border-white/15 bg-[#11120f] px-2 py-2 text-[9px] uppercase tracking-[0.08em] text-[#dfe1d8] transition-colors hover:border-primary hover:text-primary">Apply level</button></div>
<div className="mt-2 grid grid-cols-2 gap-1"><button onClick={() => sendGsPartReceive(true)} disabled={midiOutputMode !== "hardware"} className="mono border border-white/15 bg-[#11120f] px-2 py-2 text-[9px] uppercase tracking-[0.08em] text-[#dfe1d8] transition-colors hover:border-primary disabled:cursor-not-allowed disabled:opacity-35">Part Rx On</button><button onClick={() => sendGsPartReceive(false)} disabled={midiOutputMode !== "hardware"} className="mono border border-white/15 bg-[#11120f] px-2 py-2 text-[9px] uppercase tracking-[0.08em] text-[#dfe1d8] transition-colors hover:border-primary disabled:cursor-not-allowed disabled:opacity-35">Part Rx Off</button></div>
<button onClick={testExternalGs} disabled={midiOutputMode !== "hardware"} className="mono mt-2 w-full border border-white/20 bg-white/[0.025] px-3 py-2.5 text-[9px] font-medium uppercase tracking-[0.1em] text-[#dfe1d8] transition-colors hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-35">Send GS test tone / All Notes Off</button>
</CompactPanel>
          <CompactPanel id="midi-log" title="MIDI診断ログ" summary={`${midiDiagnostics.length} 件`}><div className="flex items-center justify-between"><SmallLabel help={<>外部MIDI機器を選択すると、送出バイト列を記録します。</>}>Hardware diagnostic</SmallLabel><span className={`mono text-[9px] ${midiOutputMode === "hardware" ? "text-primary" : "text-[#a9aca2]"}`}>{midiOutputMode === "hardware" ? "OUTPUT ARMED" : "SOUNDFONT MODE"}</span></div>
<p className="mono mt-2 text-[9px] leading-4 text-[#a9aca2]">{selectedMidiDevice ? `選択中: ${midiDevices.find((device) => device.id === selectedMidiDevice)?.name ?? "MIDI Output"}` : "機器未選択"}</p>
<div className="mt-3 max-h-36 space-y-px overflow-y-auto border border-white/10 bg-[#11120f]">
                      {midiDiagnostics.length ? midiDiagnostics.slice(0, 6).map((entry) => <div key={entry.id} className="grid grid-cols-[auto_1fr] gap-x-2 border-b border-white/5 px-2 py-2 last:border-b-0"><span className={`mono text-[8px] ${entry.status === "error" ? "text-[#ff746c]" : entry.status === "sent" ? "text-primary" : "text-[#a9aca2]"}`}>{entry.time}</span><span className="mono truncate text-[8px] text-[#dfe1d8]">{entry.label}{entry.bytes.length ? ` · ${entry.bytes.map((byte) => byte.toString(16).padStart(2, "0")).join(" ")}` : ""}</span></div>) : <p className="mono m-0 px-2 py-3 text-[9px] text-[#72776d]">診断ログはまだありません。</p>}
                    </div>
<button onClick={exportMidiDiagnostics} disabled={!midiDiagnostics.length} className="mono mt-2 w-full border border-white/15 bg-[#11120f] px-2 py-2 text-[8px] uppercase tracking-[0.08em] text-[#dfe1d8] transition-colors hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-35">Export diagnostic JSON</button></CompactPanel>
          <CompactPanel id="about" title="このプレーヤーについて" summary="MADRV / Signal Deck">
              <div className="flex flex-col justify-between gap-5 md:flex-row md:items-end">
          <div className="flex items-center gap-3"><SignalMark /><p className="mono m-0 text-[10px] leading-5 tracking-[0.04em] text-[#a9aca2]">Based on MADRV MUSIC CONVERTER Version 1.10 (c)1991,92 Konoa<br />OPM / PDX core: MXDRVg, X68Sound, portable_mdx (attribution preserved)<br />Web adaptation by Awed (c)2026</p></div>
          <HelpTooltip label="対応URL・データの扱い">音源はブラウザで扱います。CORS対応URLと、公開共有されたGoogle Drive／Dropboxに対応します。</HelpTooltip>
        </div>

            </CompactPanel>
        </div>
      </main>
      <section className="compact-debug" aria-label="デバッグ情報">
          <CompactPanel id="diagnostics" title="再生情報（デバッグ）" summary={`${(audioSampleRate / 1000).toFixed(1)} kHz`}><div data-testid="playback-diagnostics" className="program-diagnostics grid gap-px border border-white/10 bg-white/10 sm:grid-cols-3">
                  <div className="bg-[#11120f] px-3 py-2"><SmallLabel help={<>{tempoSource}</>}>Tempo / estimated</SmallLabel><p aria-label="推定BPM" className="mono m-0 mt-0.5 text-xl leading-tight text-primary">{estimatedBpm ? `${estimatedBpm.toFixed(1)} BPM` : "— BPM"}</p></div>
                  <div className="bg-[#11120f] px-3 py-2"><SmallLabel help={<>{timerBHint}</>}>Timer-B / OPM reg 12</SmallLabel><p aria-label="Timer-B値" className="mono m-0 mt-0.5 text-xl leading-tight text-[#f5f4ec]">{timerB === null ? "—" : `0x${timerB.toString(16).padStart(2, "0").toUpperCase()}`}</p></div>
                  <div className="bg-[#11120f] px-3 py-2"><SmallLabel help={<>WASM renderer matched</>}>Audio clock / synced</SmallLabel><p aria-label="再生クロック" className="mono m-0 mt-0.5 text-xl leading-tight text-[#f5f4ec]">{(audioSampleRate / 1000).toFixed(1)} kHz</p></div>
                  <div className="bg-[#11120f] px-3 py-2"><SmallLabel help={<>live OPM / PCM clock</>}>MXDRV playhead</SmallLabel><p aria-label="MXDRV再生位置" className="mono m-0 mt-0.5 text-xl leading-tight text-[#f5f4ec]">{hardwarePlaybackPositionMs === null ? "—" : formatTime(hardwarePlaybackPositionMs / 1000)}</p></div>
                  <div className="bg-[#11120f] px-3 py-2"><SmallLabel help={<>event scheduled against same clock</>}>GS MIDI / MXDRV delta</SmallLabel><p aria-label="GS MIDI同期差" className="mono m-0 mt-0.5 text-xl leading-tight text-[#f5f4ec]">{mdrMidiClockDeltaMs === null ? "—" : `${mdrMidiClockDeltaMs >= 0 ? "+" : ""}${mdrMidiClockDeltaMs.toFixed(0)} ms`}</p></div>
                </div></CompactPanel>
      </section>
      {formatGuideOpen && <Suspense fallback={<span role="status" className="mono text-xs">ガイドを読み込み中…</span>}><FormatGuideDialog open={formatGuideOpen} onOpenChange={setFormatGuideOpen} /></Suspense>}
    </div>

  );
}
