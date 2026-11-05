/** The timing experiment's switch, with how far it has got (docs/metrics.md). */
import { useQuery } from "@tanstack/react-query";
import { Switch } from "@/components/ui/switch";
import { api, call } from "@/lib/api";
import { startExperiment, stopExperiment, useExperiment } from "./experiment.ts";

/** Applications per arm before the comparison is worth reading. */
const TARGET_PER_ARM = 10;

export function ExperimentSwitch() {
  const experiment = useExperiment();
  const { data } = useQuery({
    queryKey: ["timing", experiment?.startedAt],
    queryFn: () => call(api.timing.$get({ query: { since: experiment!.startedAt } })),
    enabled: !!experiment,
  });
  const part = (label: string, key: string) => {
    const a = data?.byArm[key]?.apply;
    return `${label} ${a?.applied ?? 0}/${TARGET_PER_ARM}${a?.medianMinutes != null ? ` (median ${a.medianMinutes} min)` : ""}`;
  };
  return (
    <label className="flex flex-wrap items-center gap-2.5 text-sm text-muted-foreground">
      <Switch checked={!!experiment} onCheckedChange={(on) => (on ? startExperiment() : stopExperiment())} />
      Timing experiment
      {experiment && (
        <span className="font-mono text-xs">
          · applied {part("with pack", "pack")} · {part("without", "no_pack")}
        </span>
      )}
    </label>
  );
}
