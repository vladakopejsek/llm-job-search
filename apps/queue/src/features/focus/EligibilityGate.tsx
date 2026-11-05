/**
 * The eligibility gate: shortlisting a lead whose posting doesn't settle whether
 * you can apply from where you live asks first. Yes records how you know on the
 * posting (it survives rescoring), then shortlists.
 */
import { useState } from "react";
import { AdaptiveSheet } from "@/components/jr/AdaptiveSheet";
import { Chip } from "@/components/jr/Chip";
import { Quote } from "@/components/jr/Quote";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { Lead } from "./api.ts";

interface Props {
  lead: Lead;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEligible: (note: string) => void;
  onNotEligible: () => void;
  onLater: () => void;
}

export function EligibilityGate({ lead, open, onOpenChange, onEligible, onNotEligible, onLater }: Props) {
  const [note, setNote] = useState("");
  const said = lead.facts.eligibility.quote ?? lead.facts.remote.quote ?? lead.location;
  return (
    <AdaptiveSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Can you apply from where you live?"
      description={said ? "Here's what the posting says about location:" : "The posting doesn't say where it hires."}
    >
      <Chip tone="warning" className="self-start">
        Eligibility unclear
      </Chip>
      {said && <Quote>{said}</Quote>}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="gate-note" className="text-xs text-muted-foreground">
          How do you know? <span className="opacity-70">(optional)</span>
        </label>
        <Textarea
          id="gate-note"
          rows={3}
          maxLength={500}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. asked the recruiter on LinkedIn; they hire via an employer of record in my country"
          className="text-sm"
        />
      </div>
      <div className="flex flex-col gap-2">
        <Button size="lg" onClick={() => onEligible(note.trim())}>
          Yes, eligible · shortlist
        </Button>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" size="lg" onClick={onNotEligible}>
            Not eligible
          </Button>
          <Button variant="outline" size="lg" onClick={onLater}>
            Check later
          </Button>
        </div>
      </div>
    </AdaptiveSheet>
  );
}
