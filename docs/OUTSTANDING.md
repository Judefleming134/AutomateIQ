# Outstanding — the running register

Things that are **known, decided-on, and not done**. This file exists so that
open items survive a session ending, a container being recycled, or a week of
working on something else. It is the first place the nightly and daytime
passes should look when asking "what should I pick up?".

**Rules for this file**

- An item goes in when it's identified, not when it's convenient.
- An item comes out **only** when it's actually shipped — or when Jude
  explicitly decides not to do it, in which case move it to *Decided against*
  with the reason. Nothing is deleted silently.
- Anything blocked on Jude (a key, a decision, a card) goes in **Needs Jude**,
  because no amount of engineering clears it.

Last reviewed: 2026-07-30 nightly (K1 + K3 shipped and removed; K2 removed earlier — verified already shipped: the 5-minute Svix timestamp window is live in app/api/webhooks/resend/route.ts)

---

## Needs Jude — blocked, no code will fix these

| # | Item | Why it's blocking | Effort |
|---|---|---|---|
| J1 | **`GOOGLE_PLACES_API_KEY` not set** | The Google Business Profile checker at `/freetools/google-profile` is built and tested but shows its "not switched on yet" state. Needs a Google Cloud project with billing attached — the standing monthly free credit covers this volume, but the card has to be on file. | 15 min |
| J2 | **Verify Resend sending domain, then send yourself a response-time test** | `/freetools/response-time` writes to strangers' inboxes. If it lands in spam it teaches people the wrong thing, and a damaged sending reputation would hurt the 07:00 outreach that actually earns money. Confirm `RESEND_FROM_EMAIL` is on a verified domain and run one test end-to-end before promoting the tool anywhere. | 20 min |
| J3 | **Booking `minLeadHours: 24` blocks the slot the call script offers** | The phone script says "would tomorrow morning suit?" — the booking page won't offer it. One of the two has to change. Raised 2026-07-27, no decision yet. | decision |
| J4 | **The session is THREE different lengths depending where you read it** | `lib/booking/slots.ts` books **45 minutes** (the actual calendar hold). The confirmation email every website lead gets (`app/api/lead/route.ts`) promises **30 minutes**. The outreach drafts, phone script and LinkedIn caption (`lib/growth/ai.ts`, `research.ts`, the prospect call sheet) all promise **15 minutes**. So a lead can be told 15, confirmed at 30, and booked for 45. Pick one number and I'll make every surface say it — this is a business decision about your own call length, not a bug I should guess at. Raised 2026-07-27; the 30-minute third variant found on the nightly run 2026-07-30. | decision |
| J5 | **PDPL scope** | `/policies.html` covers GDPR and the Irish DPA 2018 fully, and scopes PDPL as "contact us before onboarding from outside the EEA" rather than asserting compliance. If a specific Gulf PDPL was meant, that section needs rewriting against it. | decision |
| J7 | **Paste `supabase/migrations/0031_send_target_50.sql` into the Supabase SQL editor** | Nothing in this repo applies migrations — no CI step, no Supabase CLI in any workflow — so a migration file is just a file until Jude pastes it. 0031 sets the daily send target to the 50 he asked for on 2026-07-31 and is safe to run whether or not 0030 ever went in (validated on scratch PG16, both states, idempotent). Until it runs: the code default of 50 covers the send target, but **saving anything at `/growth/settings` will fail** if 0030 is also unapplied, because that write names `daily_send_target`. One paste fixes both. | 2 min |
| J6 | **Workforce tools and the EU AI Act's high-risk tier** | If any customer uses the workforce-management tooling to evaluate, monitor or rank *employees*, that likely lands in the high-risk tier — a materially different compliance burden. Needs a yes/no on whether any customer does this. | decision |

---

## Known and not shipped — deliberately

Each of these was found, understood, and left alone with a reason. They are
not forgotten and they are not free to ignore forever.

| # | Item | Why it wasn't shipped | Risk of leaving it |
|---|---|---|---|
| K4 | **`ra_customers` has no dedupe by email** | Same customer can be added twice and get two review requests. | Annoyance, looks sloppy |
| K5 | **Booking has no IP-based rate limit** | Needs a nullable column, so it needs a migration and scratch-Postgres validation before it can go near production. | Abuse vector |

---

## Free tools — built, live, unfinished edges

The six tools at `/freetools` all work. These are the loose ends.

| # | Item | Notes |
|---|---|---|
| F1 | **No lead capture into the Growth Engine** | This is the big one. Someone runs a tool, gets real value, and leaves no trace — `ge_prospects` never hears about them. The agreed design (2026-07-30): full report free and ungated, email asked for **only** when they want to export it or have us do the work. That creates a prospect with `source: 'freetools'` and the tool + score in the notes. No migration needed — `ge_prospects.source` already exists. |
| F2 | **Snippets are templates, not written copy** | AutoSEO emits `[square brackets]` for the business to fill in. An AI pass could write the actual title, meta description and alt text per site. Costs money per run, so it changes "free forever" into something rate-limited on purpose. |
| F3 | **Rate limits are per-instance, not global** | `lib/tools/rate-limit.ts` documents this honestly. Fine until a tool gets popular; the fix is a shared store, and the file names the function to move. |
| F4 | **Review writer costs money per use** | 6/day/IP. If it takes off, that cap is the dial to turn — or gate it behind an email. |

---

## Decided against

*(nothing yet — when Jude says no to something above, it moves here with the reason so it doesn't get re-raised in six weeks)*

---

## How this file gets used

- **Daytime cleanup pass** — if nothing obvious presents itself in the rotation,
  take the top unblocked item from *Known and not shipped*.
- **Nightly run** — same, and add anything new found during the audit.
- **Any pass** — if an item here is shipped, move it out in the same commit that
  ships it. An item that's still listed after it's done is worse than no list.
