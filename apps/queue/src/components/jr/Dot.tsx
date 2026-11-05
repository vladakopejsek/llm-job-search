import { cn } from "@/lib/utils";

const TONES = {
  /** Something fresh or happening now, like a run that finished today: lime with a halo. */
  live: "bg-primary shadow-[0_0_0_3px_var(--primary-soft)]",
  warning: "bg-warning",
  destructive: "bg-destructive",
  muted: "bg-muted-foreground",
};

/** A 6px status dot. */
export function Dot({ tone = "muted", className }: { tone?: keyof typeof TONES; className?: string }) {
  return <span aria-hidden className={cn("inline-block size-1.5 shrink-0 rounded-full", TONES[tone], className)} />;
}
