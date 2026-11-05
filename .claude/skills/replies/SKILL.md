---
name: replies
description: Turn email replies to open applications into stage proposals, which the candidate confirms in the app. Run it after each collect, in a run of its own. Run it from the repo root.
---

# Replies in Gmail

First check that the Gmail tools are available (see Rules), then run `bin/agent start --kind replies` (it prints the run id), and `bin/agent finish --run <id>` at the end. A run started without Gmail would stay open.

## Rules
- **Gmail is read-only.** Never send, draft, reply, label or delete anything, and never contact anyone. Sending is denied in settings anyway.
- **Only `bin/agent` commands touch the database.** Never run SQL or edit code.
- **Check Gmail first.** If the Gmail tools (`mcp__claude_ai_Gmail__search_threads` and the rest) aren't available, stop and print `REPLIES FAILED: no Gmail tools`.

## Steps
```
bin/agent applications --out work/run-<id>/applications.json
bin/agent schema outcomes --out work/run-<id>/schema-outcomes.json
```

**Search Gmail** for messages received since the `since` date that reply to these applications. Look for:
- senders or subjects that mention the company;
- ATS senders (greenhouse, ashbyhq, lever, workable, teamtailor, personio, recruitee, startupjobs, myworkday, bamboohr) with words like application, interview, next steps, unfortunately, offer.

**Read each candidate message.** Propose a stage only when the message clearly shows it:
- `rejected`: a decision not to proceed
- `screening` / `interviewing`: an invitation to talk
- `offer`: an offer

**Skip these:**
- Auto-confirmations ("we received your application") are not outcomes.
- The file lists only *open* applications. A reply from a company that isn't in it almost always belongs to an application that's already closed. Skip it silently, and don't suggest logging it.

**Submit:** write `work/run-<id>/outcomes.json`, even with no proposals (`{"proposals": []}`): the submission records how far the mailbox was searched. `date` is the email's ISO date-time ("2026-11-03T09:14:00Z"). Then run:
```
bin/agent propose-outcomes --run <id> work/run-<id>/outcomes.json
```
The candidate confirms every proposal in the app; nothing changes until then.

## Last line
Once Gmail has been searched, end with exactly:
```
REPLIES OK
```
Otherwise end with `REPLIES FAILED: <why>`. A scheduler can read this line to tell whether the step worked.
