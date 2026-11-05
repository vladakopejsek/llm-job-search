/** Where an application was sent: the company's form, email, LinkedIn… */
import { CHANNEL_LABELS, CHANNELS, type Channel } from "@llm-job-search/core/applications/constants.ts";

export function ChannelSelect({ id, value, onChange }: { id: string; value: Channel; onChange: (channel: Channel) => void }) {
  return (
    <select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value as Channel)}
      className="h-9 rounded-md border border-input bg-transparent px-2.5 text-sm text-foreground"
    >
      {CHANNELS.map((c) => (
        <option key={c} value={c}>
          {CHANNEL_LABELS[c]}
        </option>
      ))}
    </select>
  );
}
