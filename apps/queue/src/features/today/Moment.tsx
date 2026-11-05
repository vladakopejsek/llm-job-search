import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** One of Today's cards, shown only when it has something for you. */
export function Moment({ title, aside, className, children }: { title: string; aside?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <section className={cn("flex flex-col gap-4 rounded-xl border bg-card p-4 md:px-7 md:py-6", className)}>
      <header className="flex items-center justify-between gap-4">
        <h2 className="eyebrow">{title}</h2>
        {aside}
      </header>
      {children}
    </section>
  );
}
