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

Last reviewed: 2026-07-30 (K2 removed — verified already shipped: the 5-minute Svix timestamp window is live in app/api/webhooks/resend/route.ts)

---

## Needs Jude — blocked, no code will fix these

| # | Item | Why it's blocking | Effort |
|---|---|---|---|
| J1 | **`GOOGLE_PLACES_API_KEY` not set** | The Google Business Profile checker at `/freetools/google-profile` is built and tested but shows its "not switched on yet" state. Needs a Google Cloud project with billing attached — the standing monthly free credit covers this volume, but the card has to be on file. | 15 min |
| J2 | **Verify Resend sending domain, then send yourself a response-time test** | `/freetools/response-time` writes to strangers' inboxes. If it lands in spam it teaches people the wrong thing, and a damaged sending reputation would hurt the 07:00 outreach that actually earns money. Confirm `RESEND_FROM_EMAIL` is on a verified domain and run one test end-to-end before promoting the tool anywhere. | 20 min |
| J3 | **Booking `minLeadHours: 24` blocks the slot the call script offers** | The phone script says "would tomorrow morning suit?" — the booking page won't offer it. One of the two has to change. Raised 2026-07-27, no decision yet. | decision |
| J4 | **`/book` says 45 minutes, the script and LinkedIn caption say a 15-minute demo** | Someone books expecting 15 and gets a 45-minute hold on their calendar. Raised 2026-07-27, no decision yet. | decision |
| J5 | **PDPL scope** | `/policies.html` covers GDPR and the Irish DPA 2018 fully, and scopes PDPL as "contact us before onboarding from outside the EEA" rather than asserting compliance. If a specific Gulf PDPL was meant, that section needs rewriting against it. | decision |
| J6 | **Workforce tools and the EU AI Act's high-risk tier** | If any customer uses the workforce-management tooling to evaluate, monitor or rank *employees*, that likely lands in the high-risk tier — a materially different compliance burden. Needs a yes/no on whether any customer does this. | decision |

---

## Known and not shipped — deliberately

Each of these was found, understood, and left alone with a reason. They are
not forgotten and they are not free to ignore forever.

| # | Item | Why it wasn't shipped | Risk of leaving it |
|---|---|---|---|
| K1 | **Metrics loader scans every message ever for a windowed call** | The biggest remaining performance win. The correctness trap around it was checked and it is safe — this is purely a volume problem that grows with the message table. | Gets slower every week |
| K3 | **`/r/[token]` redirects to any tenant-saved `google_review_link`** | No host allow-list, so a tenant could point it anywhere — an open redirect on our domain. Needs an allow-list of Google/Trustpilot-style hosts. | Reputational |
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
