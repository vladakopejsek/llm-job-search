import type { ReactNode } from "react";

/** Words quoted from a posting or an email: mono, with a hanging quotation mark. */
export function Quote({ children }: { children: ReactNode }) {
  return (
    <p className="relative pl-4 font-mono text-[12.5px] leading-relaxed text-foreground-2 before:absolute before:-top-1 before:left-0 before:text-xl before:text-muted-foreground before:content-['\201C']">
      {children}
    </p>
  );
}
