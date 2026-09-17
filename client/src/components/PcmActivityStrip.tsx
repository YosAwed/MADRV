import { memo, useEffect, useRef, useState } from "react";
import { PcmActivityHistory } from "@/lib/pcmActivityHistory";

export const PcmActivityStrip = memo(function PcmActivityStrip({
  label,
  active,
  muted,
  running,
  source,
}: {
  label: string;
  active: boolean;
  muted: boolean;
  running: boolean;
  source: ArrayBuffer | null | undefined;
}) {
  const [history] = useState(() => new PcmActivityHistory());
  const [ranges, setRanges] = useState<{ start: number; end: number }[]>([]);
  const activeRef = useRef(false);
  const enabled = running && !muted;
  const lit = enabled && active;

  useEffect(() => {
    history.clear();
    setRanges([]);
    if (!enabled) return;
    let lastPaint = performance.now();
    const clear = () => {
      history.clear();
      setRanges([]);
      lastPaint = performance.now();
    };
    const timer = window.setInterval(() => {
      if (document.hidden) return;
      const now = performance.now();
      // Do not invent a continuous hit across a suspended tab or a long stall.
      if (now - lastPaint > 500) history.clear();
      history.record(now, activeRef.current);
      setRanges(history.ranges(now));
      lastPaint = now;
    }, 100);
    document.addEventListener("visibilitychange", clear);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", clear);
    };
  }, [history, enabled, source, running, muted]);

  useEffect(() => {
    activeRef.current = lit;
    if (!enabled || document.hidden) return;
    const now = performance.now();
    // Record transitions between paints, so short reported pulses survive.
    history.record(now, lit);
    setRanges(history.ranges(now));
  }, [history, enabled, lit, source, running, muted]);

  const state = muted ? "ミュート中" : lit ? "発音中" : "待機中";
  return (
    <div
      className={`pcm-activity-strip${lit ? " is-active" : ""}${muted ? " is-muted" : ""}`}
      data-testid="pcm-activity-strip"
      data-active={lit}
      role="img"
      aria-label={`${label}、${state}。直近4秒の発音履歴、右端が現在。`}
      title="直近4秒の発音履歴（右端が現在）。音量や波形を示す表示ではありません。"
    >
      <span className="pcm-activity-lamp" aria-hidden="true" />
      <span className="mono pcm-activity-status" aria-hidden="true">
        {muted ? "MUTE" : lit ? "ON" : "—"}
      </span>
      <svg
        className="pcm-activity-history"
        viewBox="0 0 100 30"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        {[0, 25, 50, 75, 100].map(x => (
          <line
            key={x}
            x1={x}
            x2={x}
            y1="3"
            y2="27"
            className="pcm-activity-grid"
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {ranges.map((range, index) => (
          <rect
            key={index}
            data-pcm-hit=""
            x={range.start}
            y="8"
            width={range.end - range.start}
            height="14"
          />
        ))}
      </svg>
      <span className="mono pcm-activity-window" aria-hidden="true">
        4s
      </span>
    </div>
  );
});
