import { Info } from "lucide-react";
import { useState, type ReactNode } from "react";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type HelpTooltipProps = {
  /** The field or section name; the button is announced as `${label}の説明`. */
  label: string;
  /** Plain explanatory content. Keep links and other controls outside the tooltip. */
  children: ReactNode;
  className?: string;
};

/** Place beside a label or control, never inside another button. */
export function HelpTooltip({ label, children, className }: HelpTooltipProps) {
  const [open, setOpen] = useState(false);

  return (
    <Tooltip open={open} onOpenChange={setOpen}>
      <TooltipTrigger
        type="button"
        aria-label={`${label}の説明`}
        className={cn(
          "inline-flex size-6 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
          className
        )}
        onPointerDown={event => event.stopPropagation()}
        onClick={event => {
          // Radix closes tooltips on click and ignores touch hover. Keep a tap
          // open so the same explanation is available without a mouse.
          event.preventDefault();
          event.stopPropagation();
          setOpen(true);
        }}
        onKeyDown={event => {
          if (event.key === "Enter" || event.key === " ") {
            event.stopPropagation();
          }
        }}
      >
        <Info aria-hidden="true" className="size-3.5" />
      </TooltipTrigger>
      <TooltipContent
        side="top"
        sideOffset={6}
        collisionPadding={12}
        className="max-w-[min(26rem,calc(100vw-24px))] text-left text-xs leading-relaxed text-wrap break-words"
      >
        {children}
      </TooltipContent>
    </Tooltip>
  );
}
