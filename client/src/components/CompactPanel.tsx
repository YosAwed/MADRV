import { ChevronDown } from "lucide-react";
import {
  useId,
  useImperativeHandle,
  useState,
  type ReactNode,
  type Ref,
} from "react";
import { cn } from "@/lib/utils";

type CompactPanelProps = {
  id: string;
  title: string;
  summary?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  className?: string;
  ref?: Ref<CompactPanelHandle>;
};

export type CompactPanelHandle = { reveal(): void };

const STORAGE_PREFIX = "madrv-player.panel-open-v1:";

function readOpen(id: string, defaultOpen: boolean): boolean {
  try {
    const stored = window.localStorage.getItem(`${STORAGE_PREFIX}${id}`);
    if (stored === "true") return true;
    if (stored === "false") return false;
  } catch {
    // Storage can be unavailable in private or embedded browsing contexts.
  }
  return defaultOpen;
}

export function CompactPanel({
  id,
  title,
  summary,
  children,
  defaultOpen = false,
  className,
  ref,
}: CompactPanelProps) {
  const [open, setOpen] = useState(() => readOpen(id, defaultOpen));
  const instanceId = useId();
  const titleId = `${instanceId}-title`;
  const contentId = `${instanceId}-content`;

  function changeOpen(nextOpen: boolean) {
    setOpen(nextOpen);
    try {
      window.localStorage.setItem(`${STORAGE_PREFIX}${id}`, String(nextOpen));
    } catch {
      // Folding remains usable when preferences cannot be saved.
    }
  }

  useImperativeHandle(ref, () => ({ reveal: () => changeOpen(true) }), [id]);

  return (
    <section
      className={cn("compact-panel", className)}
      data-panel={id}
      data-open={open}
      aria-labelledby={titleId}
    >
      <button
        type="button"
        className="compact-panel-header flex w-full min-w-0 items-center gap-2 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        aria-expanded={open}
        aria-controls={contentId}
        data-testid={`panel-toggle-${id}`}
        onClick={() => changeOpen(!open)}
      >
        <ChevronDown
          aria-hidden="true"
          className={cn("size-3.5 shrink-0", !open && "-rotate-90")}
        />
        <span id={titleId} className="shrink-0 text-xs font-semibold">
          {title}
        </span>
        {summary != null && (
          <span className="min-w-0 flex-1 truncate text-[11px] font-normal text-muted-foreground">
            {summary}
          </span>
        )}
      </button>
      <div
        id={contentId}
        className="compact-panel-body"
        data-testid={`panel-content-${id}`}
        hidden={!open}
      >
        {open ? children : null}
      </div>
    </section>
  );
}
