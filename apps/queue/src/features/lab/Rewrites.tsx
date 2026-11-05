/** How much of the drafts you rewrite before sending (docs/metrics.md, 6): edit distance ÷ the longer text. */
import { LIGHT_EDIT } from "@llm-job-search/core/lab/rewrite-share.ts";
import { percent } from "@/lib/format";
import { type Lab, SMALL } from "./api.ts";
import { Card, sampleText } from "./parts.tsx";

function Figure({ label, summary }: { label: string; summary: Lab["rewrites"]["answers"] }) {
  const small = summary.n < SMALL;
  return (
    <div className={`flex flex-col gap-1.5 ${small ? "opacity-60" : ""}`}>
      <span className="font-mono text-[40px] leading-none tracking-[-0.03em]">{percent(summary.median)}</span>
      <span className="text-xs text-muted-foreground">
        changed in {label} · {sampleText(summary.n, SMALL)}
      </span>
      {summary.lightlyEdited !== null && (
        <span className="text-xs text-muted-foreground">
          {percent(summary.lightlyEdited)} sent with under {percent(LIGHT_EDIT)} changed
        </span>
      )}
    </div>
  );
}

export function Rewrites({ rewrites, className }: { rewrites: Lab["rewrites"]; className?: string }) {
  return (
    <Card title="How much of the draft you rewrite · median" className={className}>
      <div className="grid grid-cols-2 gap-4">
        <Figure label="answers" summary={rewrites.answers} />
        <Figure label="cover letters" summary={rewrites.letters} />
      </div>
      <div className="h-px bg-border" />
      <p className="text-[13px] text-foreground-2">
        Heavy editing isn't failure: a draft rewritten in your own words still saved the thinking. This shows how usable the drafts are, not whether
        they helped.
      </p>
    </Card>
  );
}
