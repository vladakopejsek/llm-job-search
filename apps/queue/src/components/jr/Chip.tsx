import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

const TONES = {
  outline: "border-border text-foreground-2",
  solid: "border-transparent bg-muted text-foreground-2",
  go: "border-transparent bg-primary-soft text-primary-ink",
  warning: "border-transparent bg-warning-soft text-warning",
  destructive: "border-transparent bg-destructive-soft text-destructive",
};

/** A small rounded label: a fact about a posting or a stage. */
export function Chip({ tone = "outline", className, children }: { tone?: keyof typeof TONES; className?: string; children: ReactNode }) {
  return (
    <span className={cn("inline-flex h-6 items-center gap-1.5 rounded-full border px-[9px] text-xs whitespace-nowrap", TONES[tone], className)}>
      {children}
    </span>
  );
}
