# AutomateIQ — working notes for Claude

## Read this first

**`docs/OUTSTANDING.md` is the running register of known-but-not-done work.**
Check it at the start of any autonomous pass. If nothing obvious presents
itself in the rotation, take the top unblocked item from it. When you ship
something that's on it, remove it in the same commit — a stale register is
worse than no register.

## What actually makes money here

The Growth Engine (`/growth`) is the customer-acquisition machine. Everything
else is either a product being sold or a front door feeding it. In priority
order, these must never break:

1. **The 07:00 UTC cron** — `morning-brief.yml` fires the queued-outreach send
   and the morning brief. The workflow schedules early and sleeps, because
   GitHub delays this repo's crons by 2.5–5 hours. Dispatch is 06:50 UTC.
2. **The send-review gates** in `lib/growth/email.ts` — `reviewOutreachEmail`
   and `sanitizeOutreachBody` run before anything leaves. Also
   `draftLooksBroken`, the cross-company contamination check, and the
   `Jarvis nightly:` held-send logging. These are inviolable: an outreach email
   with the wrong company's details in it costs a customer permanently.
3. **The inbound webhook**, Jarvis, and the nightly/health routines.

## Rules that don't bend

- **Never push to `main` directly.** Branch → PR → squash-merge.
- **No migration without validating it on scratch Postgres first.**
- **Additive over destructive.** Jude is anxious about breakage: never remove
  or rename a feature he uses. A fix that adds a path is better than one that
  changes an existing one.
- **The build must be green before anything ships.**
- **Report honestly.** If a thing wasn't verified, say it wasn't verified.
  Never describe a check as passing that wasn't run.

## Conventions worth knowing

- **Dublin, not UTC.** `dublinDate()` for follow-up dates and "due today"
  comparisons. Booking slots are the exception: they store Irish wall-clock
  *as* UTC, so they render in UTC. `lib/growth/dates.ts` has the details.
- **PostgREST caps at 1,000 rows**, and `.in("col", ids)` serialises every id
  into the request URL (~40 chars per UUID), so ~200 ids blows the ~8KB limit.
  Use `selectAllRows` and `selectAllRowsByIds` from `lib/growth/db.ts`.
- **Two Supabase clients**: `createClient` (RLS, user-scoped) and
  `createAdminClient` (service role). Public endpoints use the admin client
  because visitors have no session — so the query itself must do the scoping.
- **Fetching a URL from user input** goes through `isPublicWebHost`
  (`lib/growth/research.ts`). It blocks localhost, RFC1918, link-local and
  cloud metadata. Every public tool already uses it; so must any new one.

## Recurring bug classes found in this codebase

Worth checking for by name when auditing — each has been found more than once:

- **A score-ordered cap applied *before* the "still to work" filter**, so the
  most urgent items never enter the list at all.
- **Reporting success for work that didn't happen** — a swallowed failure
  counted as a completed check, a message recorded as sent before delivery
  confirmed.
- **Missing `try/finally`** leaving a UI stuck mid-run with a wake lock held.
- **Destructive overwrite with no undo.**
- **A count that doesn't match what its click-through shows.**

## Verification habit

Ship fixes with a `node` simulation in the scratchpad that demonstrates the old
behaviour and the new one — a fixture, a table of before/after, or a replay of
the exact failure. It has repeatedly caught the fix being wrong, and the output
belongs in the PR body.
