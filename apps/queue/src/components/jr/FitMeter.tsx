import { cn } from "@/lib/utils";

/** Fit this high is worth acting on, so it's the one fit drawn in lime. */
const GOOD_FIT = 8;

/** Fit as 10 segments instead of "8/10". */
export function FitMeter({ score, size = "md" }: { score: number; size?: "sm" | "md" }) {
  const on = score >= GOOD_FIT ? "bg-primary" : "bg-foreground-2";
  return (
    <span role="img" aria-label={`Fit ${score} of 10`} className={cn("inline-flex shrink-0 items-center", size === "sm" ? "gap-0.5" : "gap-[3px]")}>
      {Array.from({ length: 10 }, (_, i) => (
        <i key={i} className={cn(size === "sm" ? "h-3 w-[3px] rounded-[1px]" : "h-[18px] w-1.5 rounded-[2px]", i < score ? on : "bg-muted-2")} />
      ))}
    </span>
  );
}
