/** How far an application has got, as five dots joined by a line: applied · replied · screening · interview · offer. */
import { cn } from "@/lib/utils";

const STEPS = ["applied", "replied", "screening", "interview", "offer"] as const;

interface Props {
  /** Furthest step reached: 0 applied … 4 offer (PROGRESS, with "replied" in between). */
  reached: number;
  /** It ended there: the last dot is drawn as the stop (rejected, no response). */
  ended?: boolean;
  /** Label each dot (the application sheet); the list shows bare dots. */
  labelled?: boolean;
}

/** PROGRESS index (applied 0, screening 1, interviewing 2, offer 3) and a reply, as a step on the track. */
export const trackStep = (reached: number, responded: boolean) => (reached > 0 ? reached + 1 : responded ? 1 : 0);

export function StageTrack({ reached, ended = false, labelled = false }: Props) {
  return (
    <ol aria-label={`Reached ${STEPS[reached]}${ended ? ", then ended" : ""}`} className={cn("flex items-start", labelled && "w-full")}>
      {STEPS.map((step, i) => {
        const dot = i < reached ? "on" : i === reached ? (ended ? "x" : "now") : "off";
        return (
          <li key={step} className={cn("flex items-center", labelled && "grow flex-col items-start gap-1.5 last:grow-0")}>
            <span className="flex w-full items-center">
              <span
                className={cn(
                  "size-[9px] shrink-0 rounded-full border-[1.5px]",
                  dot === "on" && "border-foreground-2 bg-foreground-2",
                  dot === "now" && "border-primary bg-primary shadow-[0_0_0_3px_var(--primary-soft)]",
                  dot === "x" && "border-destructive bg-destructive",
                  dot === "off" && "border-border-strong bg-background",
                )}
              />
              {i < STEPS.length - 1 && (
                <span className={cn("h-[1.5px]", labelled ? "grow" : "w-4", i < reached ? "bg-foreground-2" : "bg-border-strong")} />
              )}
            </span>
            {labelled && <span className={cn("font-mono text-[11px]", i > reached && "text-muted-foreground")}>{step}</span>}
          </li>
        );
      })}
    </ol>
  );
}
