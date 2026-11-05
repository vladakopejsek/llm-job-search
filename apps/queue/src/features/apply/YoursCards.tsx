/** Questions only the candidate answers: the salary named (with the target to ask for) and the form's personal questions. Never drafted. */
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Overview } from "@/lib/queries";
import type { AnswerRow, SubmissionDraft } from "@/lib/submission";

function Card({ id, number, label, children }: { id: string; number: string; label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 rounded-xl border bg-card px-4 py-3.5">
      <label htmlFor={id} className="flex items-center gap-2">
        <span className="font-mono text-xs text-muted-foreground">{number}</span>
        <span className="font-medium">{label}</span>
      </label>
      {children}
    </div>
  );
}

interface Props {
  form: SubmissionDraft;
  personal: { row: AnswerRow; number: number }[];
  payTarget: Overview["shortlist"][number]["payTarget"];
  onSalary: (salaryStated: string) => void;
  onAnswer: (key: number, answer: string) => void;
}

export function YoursCards({ form, personal, payTarget, onSalary, onAnswer }: Props) {
  return (
    <div className="grid grid-cols-3 gap-3">
      <Card id="salary-stated" number="$" label="Salary expectation">
        <Input
          id="salary-stated"
          value={form.salaryStated}
          placeholder="e.g. EUR 85k B2B"
          onChange={(e) => onSalary(e.target.value)}
          className="font-mono"
        />
        {payTarget && (
          <div className="flex items-start gap-1.5 text-xs" title={payTarget.notes.join("\n")}>
            <span className="text-muted-foreground">Target</span>
            <span className="font-mono">{payTarget.text}</span>
            <Button variant="ghost" size="sm" className="-my-1 ml-auto" onClick={() => onSalary(payTarget.text)}>
              Use
            </Button>
          </div>
        )}
        {payTarget?.warning && <span className="text-xs text-warning">{payTarget.warning}</span>}
      </Card>
      {personal.map(({ row, number }) => (
        <Card key={row.key} id={`yours-${row.key}`} number={String(number).padStart(2, "0")} label={row.question}>
          <Input id={`yours-${row.key}`} value={row.answer} placeholder="Yours to answer" onChange={(e) => onAnswer(row.key, e.target.value)} />
          <span className="text-xs text-muted-foreground">Personal: never drafted</span>
        </Card>
      ))}
    </div>
  );
}
