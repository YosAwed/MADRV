import { memo, useEffect, useState } from "react";
import { isPcmVoiceActive, type MdrMixerTrack } from "@/lib/madrvEngine";

export const PcmPadBank = memo(function PcmPadBank({ tracks, mask, samples, pans, running, source, mutedTracks, soloTrack, onMute, onSolo }: {
  tracks: readonly MdrMixerTrack[];
  mask: number;
  samples: readonly (number | null)[];
  pans: readonly (number | null)[];
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
        return <div key={voice} className={`pcm-pad${active ? " is-active" : ""}${muted ? " is-muted" : ""}${!running ? " is-stopped" : ""}`}
          data-testid={`pcm-pad-${voice + 1}`} data-active={active} data-sample-number={number ?? undefined} data-pan={pan ?? undefined}>
          <span className="mono pcm-pad-channel" aria-hidden="true">{voice + 1}</span>
          <PcmPadReadout label={label} active={active} number={number} pan={pan} enabled={running && !muted} muted={muted} source={source} />
          <div className="pcm-pad-controls">
            <button type="button" disabled={!voiceTracks.length} aria-label={`${label}のミュートを${muted ? "オフ" : "オン"}にする`} aria-pressed={muted} onClick={() => onMute(voiceTracks)}>M</button>
            <button type="button" disabled={!voiceTracks.length} aria-label={`${label}を${solo ? "ソロ解除" : "ソロ"}にする`} aria-pressed={solo} onClick={() => onSolo(voiceTracks)}>S</button>
          </div>
        </div>;
      })}
    </div>
  </div>;
});

/** Retain only the last displayed hit; CSS handles the fade without JS timers. */
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
  return <div className="pcm-pad-readout" role="img" aria-label={`${label}、${muted ? "ミュート中" : shownNumber !== null ? `${active ? "" : "前回の"}サンプル${shownNumber}、${panLabel}` : "待機中"}`}
    title="サンプル番号は0始まり。左 >番号 ／中央 >番号< ／右 番号<。消灯中は前回の発音。">
    <span className="pcm-pad-pan" style={{ visibility: shownPan === 1 || shownPan === 3 ? "visible" : "hidden" }} aria-hidden="true">&gt;</span>
    <span className="pcm-pad-number" aria-hidden="true">{shownNumber === null ? "—" : String(shownNumber)}</span>
    <span className="pcm-pad-pan" style={{ visibility: shownPan === 2 || shownPan === 3 ? "visible" : "hidden" }} aria-hidden="true">&lt;</span>
  </div>;
});
