/** Pieces the Lab's sections share: a card, a labelled bar, and how a small sample is marked. */
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Card({ title, aside, className, children }: { title: string; aside?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <section className={cn("flex flex-col gap-4 rounded-xl border bg-card px-5 py-5 md:px-6 md:py-[22px]", className)}>
      <header className="flex flex-wrap items-center gap-3">
        <h2 className="eyebrow grow">{title}</h2>
        {aside}
      </header>
      {children}
    </section>
  );
}

/**
 * One measure as a bar: neutral by default, lime only for the highlighted
 * measure, dim for what doesn't count, faint when the sample is small.
 */
export function Bar({ share, tone = "on" }: { share: number; tone?: "on" | "go" | "dim" | "faint" }) {
  return (
    <div
      className={cn(
        "h-2.5 min-w-0.5 rounded-r-[4px]",
        tone === "on" && "bg-foreground-2",
        tone === "go" && "bg-primary",
        tone === "dim" && "bg-muted-2",
        tone === "faint" && "bg-muted-2 opacity-60",
      )}
      style={{ width: `${Math.max(0, Math.min(1, share)) * 100}%` }}
    />
  );
}

/** "n12", or "n3 · small" for a sample too small to read much into. */
export const sampleText = (n: number, small: number) => (n < small ? `n${n} · small` : `n${n}`);
