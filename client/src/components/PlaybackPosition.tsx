import { useEffect, useRef, useState } from "react";
import { playbackProgressPercent } from "@/lib/madrvEngine";

function time(seconds: number) {
  const value = Math.max(0, Math.floor(seconds));
  return `${Math.floor(value / 60)}:${(value % 60).toString().padStart(2, "0")}`;
}

/** Keep dragging local; only release/keyboard commit asks the engine to seek. */
export function PlaybackPosition({ elapsed, duration, enabled, busy, unavailableReason, onSeek }: {
  elapsed: number;
  duration: number;
  enabled: boolean;
  busy: boolean;
  unavailableReason: string;
  onSeek: (seconds: number) => void;
}) {
  const [preview, setPreview] = useState<number | null>(null);
  const draft = useRef<number | null>(null);
  const usable = enabled && !busy && duration > 0;
  const clear = () => { draft.current = null; setPreview(null); };
  useEffect(() => { if (!usable) clear(); }, [usable]);
  const commit = () => {
    const target = draft.current;
    clear();
    if (usable && target !== null) onSeek(target);
  };
  const shown = preview ?? elapsed;
  const progress = playbackProgressPercent(shown, duration);
  const valueText = `${time(shown)} / ${duration ? time(duration) : "--:--"}`;
  const title = busy ? "再生位置を移動しています。停止で中止できます。" : usable
    ? "クリック、ドラッグ、矢印キーで現在の周回内を移動します。離した位置から再生します。"
    : unavailableReason;
  return <span className="deck-inline-position" data-testid="playback-time-position">
    <span className="compact-clock" data-testid="playback-elapsed" aria-label="経過時間">{valueText}</span>
    <span className={`deck-position-track${usable ? " is-seekable" : ""}`} title={title}
      role={usable ? undefined : "progressbar"} aria-label={usable ? undefined : "再生位置"}
      aria-valuemin={usable ? undefined : 0} aria-valuemax={usable ? undefined : 100}
      aria-valuenow={usable ? undefined : Math.round(progress)} aria-valuetext={usable ? undefined : `${valueText}（${title}）`}>
      <span className="deck-position-fill" style={{ width: `${progress}%` }} />
      <span className="deck-position-marker" data-testid="playback-marker" style={{ left: `${progress}%` }} />
      <input type="range" className="deck-position-input" data-testid="playback-seek" aria-label="再生位置を移動"
        aria-valuetext={valueText} min={0} max={duration || 1} step="any" value={shown} disabled={!usable}
        onChange={event => { const value = Number(event.currentTarget.value); draft.current = value; setPreview(value); }}
        onPointerUp={commit} onPointerCancel={clear}
        onKeyDown={event => {
          const delta = ["ArrowRight", "ArrowUp"].includes(event.key) ? 5 : ["ArrowLeft", "ArrowDown"].includes(event.key) ? -5 : undefined;
          if (delta !== undefined) {
            event.preventDefault();
            const value = Math.min(duration, Math.max(0, (draft.current ?? elapsed) + delta));
            draft.current = value;
            setPreview(value);
          } else if (event.key === "Escape") { event.preventDefault(); clear(); }
        }}
        onKeyUp={event => { if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"].includes(event.key)) commit(); }}
        onBlur={clear} />
    </span>
    <span className="deck-position-percent">(<span data-testid="playback-position">{Math.round(progress)}%</span>)</span>
  </span>;
}
