import { memo, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { isPcmVoiceActive, type MdrMixerTrack } from "@/lib/madrvEngine";

export const PcmPadBank = memo(function PcmPadBank({ tracks, mask, samples, pans, triggers, running, source, mutedTracks, soloTrack, onMute, onSolo }: {
  tracks: readonly MdrMixerTrack[];
  mask: number;
  samples: readonly (number | null)[];
  pans: readonly (number | null)[];
  triggers: readonly number[];
  running: boolean;
  source?: ArrayBuffer | null;
  mutedTracks: readonly number[];
  soloTrack: number | null;
  onMute(tracks: readonly MdrMixerTrack[]): void;
  onSolo(tracks: readonly MdrMixerTrack[]): void;
}) {
  const count = tracks.length === 1 && (tracks[0].pcmVoice ?? 1) === 1 ? 1 : 8;
  return <div className="pcm-pad-bank" data-testid="pcm-pad-bank" data-voices={count}>
    <p className="mono pcm-pad-bank-label">{count === 1 ? "PCM" : "PCM8"}</p>
    <div className="pcm-pad-grid">
      {Array.from({ length: count }, (_, voice) => {
        const voiceTracks = tracks.filter(track => (track.pcmVoice ?? 1) === voice + 1);
        const muted = voiceTracks.length > 0 && voiceTracks.every(track => mutedTracks.includes(track.index));
        const solo = voiceTracks.some(track => soloTrack === track.index);
        const active = running && !muted && isPcmVoiceActive(mask, voice + 1);
        const number = active ? samples[voice] ?? null : null;
        const pan = active ? pans[voice] ?? null : null;
        const label = `PCM ${voice + 1}`;
        return <PcmPadSurface key={voice} active={active} enabled={running && !muted} trigger={triggers[voice] ?? 0} source={source} className={`pcm-pad${active ? " is-active" : ""}${muted ? " is-muted" : ""}${!running ? " is-stopped" : ""}`}
          data-testid={`pcm-pad-${voice + 1}`} data-active={active} data-trigger={triggers[voice] ?? 0} data-sample-number={number ?? undefined} data-pan={pan ?? undefined}>
          <span className="mono pcm-pad-channel" aria-hidden="true">{voice + 1}</span>
          <PcmPadReadout label={label} active={active} number={number} pan={pan} enabled={running && !muted} muted={muted} source={source} />
          <div className="pcm-pad-controls">
            <button type="button" disabled={!voiceTracks.length} aria-label={`${label}のミュートを${muted ? "オフ" : "オン"}にする`} aria-pressed={muted} onClick={() => onMute(voiceTracks)}>M</button>
            <button type="button" disabled={!voiceTracks.length} aria-label={`${label}を${solo ? "ソロ解除" : "ソロ"}にする`} aria-pressed={solo} onClick={() => onSolo(voiceTracks)}>S</button>
          </div>
        </PcmPadSurface>;
      })}
    </div>
  </div>;
});

/** Browser animations avoid per-frame React updates and restart even for repeated samples. */
const PcmPadSurface = memo(function PcmPadSurface({ active, enabled, trigger, source, ...props }: React.ComponentProps<"div"> & {
  active: boolean; enabled: boolean; trigger: number; source?: ArrayBuffer | null;
}) {
  const element = useRef<HTMLDivElement>(null);
  const animation = useRef<Animation | null>(null);
  useLayoutEffect(() => {
    const pad = element.current;
    if (!pad) return;
    const style = getComputedStyle(pad);
    const previous = { backgroundColor: style.backgroundColor, color: style.color, borderColor: style.borderColor };
    const hadAnimation = animation.current !== null;
    animation.current?.cancel();
    animation.current = null;
    if (!enabled) return;
    if (active) {
      animation.current = pad.animate([
        { backgroundColor: "#d8ff3e", color: "#11120f", borderColor: "#d8ff3e" },
        { backgroundColor: "#667634", color: "#f5f4ec", borderColor: "#879b43" },
      ], { duration: 1800, easing: "ease-out", fill: "forwards" });
    } else if (hadAnimation) {
      animation.current = pad.animate([previous,
        { backgroundColor: "#181c15", color: "#7f8873", borderColor: "#ffffff30" },
      ], { duration: 300, easing: "ease-out", fill: "forwards" });
    }
  }, [active, enabled, trigger, source]);
  useEffect(() => () => animation.current?.cancel(), []);
  return <div {...props} ref={element} />;
});

/** Retain only the last displayed hit; the browser handles the fade without JS timers. */
const PcmPadReadout = memo(function PcmPadReadout({ label, active, number, pan, enabled, muted, source }: {
  label: string; active: boolean; number: number | null; pan: number | null;
  enabled: boolean; muted: boolean; source?: ArrayBuffer | null;
}) {
  const [lastHit, setLastHit] = useState<{ number: number | null; pan: number | null; source?: ArrayBuffer | null } | null>(null);
  useEffect(() => {
    if (!enabled) setLastHit(null);
    else if (active) setLastHit(previous => previous?.number === number && previous?.pan === pan && previous?.source === source ? previous : { number, pan, source });
  }, [enabled, active, number, pan, source]);
  const previous = enabled && lastHit?.source === source ? lastHit : null;
  const shownNumber = active ? number : previous?.number ?? null;
  const shownPan = active ? pan : previous?.pan ?? null;
  const panLabel = shownPan === 1 ? "左" : shownPan === 2 ? "右" : shownPan === 3 ? "中央" : shownPan === 0 ? "出力なし" : "PAN不明";
  const hasPan = shownPan !== null && shownPan !== 0;
  const numberWidth = `${shownNumber === null ? 1 : String(shownNumber).length}ch`;
  return <div className="pcm-pad-readout" style={{ "--pcm-number-width": numberWidth } as CSSProperties} role="img" aria-label={`${label}、${muted ? "ミュート中" : shownNumber !== null ? `${active ? "" : "前回の"}サンプル${shownNumber}、${panLabel}` : "待機中"}`}
    title="サンプル番号は0始まり。左 ))>番号< ／中央 ))>番号<(( ／右 >番号<((。消灯中は前回の発音。">
    <PcmPanMark side="left" visible={hasPan} emphasized={shownPan === 1 || shownPan === 3} />
    <span className="pcm-pad-number" aria-hidden="true">{shownNumber === null ? "—" : String(shownNumber)}</span>
    <PcmPanMark side="right" visible={hasPan} emphasized={shownPan === 2 || shownPan === 3} />
  </div>;
});

/** Fixed-height vector marks fit the available side space without moving the digits. */
function PcmPanMark({ side, visible, emphasized }: { side: "left" | "right"; visible: boolean; emphasized: boolean }) {
  return <svg className={`pcm-pad-pan pcm-pad-pan-${side}`} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
    style={{ visibility: visible ? "visible" : "hidden" }} data-emphasized={emphasized} aria-hidden="true">
    <g transform={side === "right" ? "translate(20 20) rotate(180)" : undefined}>
      <path d="M2 2 Q10 10 2 18 M7 5 Q12 10 7 15" style={{ visibility: visible && emphasized ? "visible" : "hidden" }} />
      <path d="M13 6 L18 10 L13 14" />
    </g>
  </svg>;
}
