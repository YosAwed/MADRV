import { useEffect, useRef, useState, type PointerEvent } from "react";
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
  const requested = useRef<number | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const pointer = useRef<number | null>(null);
  const usable = enabled && duration > 0;
  const clear = () => { draft.current = null; setPreview(null); };
  useEffect(() => {
    if (!usable || !busy) {
      requested.current = null;
      if (!usable || draft.current === null) setPreview(null);
      if (!usable) { draft.current = null; pointer.current = null; }
    }
  }, [usable, busy, elapsed]);
  const commit = (target = draft.current) => {
    draft.current = null;
    if (usable && target !== null) {
      requested.current = target;
      setPreview(target);
      onSeek(target);
    }
  };
  const pointerTarget = (event: PointerEvent<HTMLSpanElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return duration * Math.min(1, Math.max(0, (event.clientX - bounds.left) / Math.max(1, bounds.width)));
  };
  const previewPointer = (event: PointerEvent<HTMLSpanElement>) => {
    const target = pointerTarget(event);
    draft.current = target;
    setPreview(target);
  };
  const shown = preview ?? elapsed;
  const progress = playbackProgressPercent(shown, duration);
  const valueText = `${time(shown)} / ${duration ? time(duration) : "--:--"}`;
  const title = busy ? "移動中も次の位置を指定できます。停止で中止できます。" : usable
    ? "クリック、ドラッグ、矢印キーで現在の周回内を移動します。MIDIは移動先以降のノートから再開します。"
    : unavailableReason;
  return <span className="deck-inline-position" data-testid="playback-time-position">
    <span className="compact-clock" data-testid="playback-elapsed" aria-label="経過時間">{valueText}</span>
    <span className={`deck-position-track${usable ? " is-seekable" : ""}`} title={title}
      onPointerDown={event => {
        if (!usable || !event.isPrimary || event.button !== 0) return;
        event.preventDefault();
        input.current?.focus({ preventScroll: true });
        pointer.current = event.pointerId;
        event.currentTarget.setPointerCapture(event.pointerId);
        previewPointer(event);
      }}
      onPointerMove={event => {
        if (pointer.current === event.pointerId) previewPointer(event);
      }}
      onPointerUp={event => {
        if (pointer.current !== event.pointerId) return;
        pointer.current = null;
        event.currentTarget.releasePointerCapture(event.pointerId);
        // Native range inputs may publish their value after pointerup on touch
        // browsers. Commit this release's coordinates, never a previous input.
        commit(pointerTarget(event));
      }}
      onPointerCancel={() => { pointer.current = null; clear(); }}
      onLostPointerCapture={() => { if (pointer.current !== null) { pointer.current = null; clear(); } }}
      role={usable ? undefined : "progressbar"} aria-label={usable ? undefined : "再生位置"}
      aria-valuemin={usable ? undefined : 0} aria-valuemax={usable ? undefined : 100}
      aria-valuenow={usable ? undefined : Math.round(progress)} aria-valuetext={usable ? undefined : `${valueText}（${title}）`}>
      <span className="deck-position-fill" style={{ width: `${progress}%` }} />
      <span className="deck-position-marker" data-testid="playback-marker" style={{ left: `${progress}%` }} />
      <input ref={input} type="range" className="deck-position-input" data-testid="playback-seek" aria-label="再生位置を移動"
        aria-valuetext={valueText} min={0} max={duration || 1} step="any" value={shown} disabled={!usable}
        onChange={event => { const value = Number(event.currentTarget.value); draft.current = value; setPreview(value); }}
        onKeyDown={event => {
          const delta = ["ArrowRight", "ArrowUp"].includes(event.key) ? 5 : ["ArrowLeft", "ArrowDown"].includes(event.key) ? -5 : undefined;
          if (delta !== undefined) {
            event.preventDefault();
            const value = Math.min(duration, Math.max(0, (draft.current ?? requested.current ?? elapsed) + delta));
            draft.current = value;
            setPreview(value);
          } else if (event.key === "Escape") { event.preventDefault(); clear(); }
        }}
        onKeyUp={event => { if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"].includes(event.key)) commit(); }}
        onBlur={() => { pointer.current = null; clear(); }} />
    </span>
    <span className="deck-position-percent">(<span data-testid="playback-position">{Math.round(progress)}%</span>)</span>
  </span>;
}
