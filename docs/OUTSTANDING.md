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

Last reviewed: 2026-08-01 overnight (F1 SHIPPED — free-tool results now create warm inbound prospects, ungated. Earlier: tool ENGINE pass: AutoSEO's 1,000-line scorer had no tests and two real bugs — a single-bundle SPA passed the check meant to catch it, and the report led with the meta description on a site with no HTTPS. Missed-calls workings contradicted their own headline. Earlier: second free-tools pass: F5 shipped — tool pages rebuilt, autoseo's duplicate topbar removed, quote-builder's 3,429px mobile overflow fixed, dead tools dropped from the sitemap. Earlier: free-tools pass: the quote builder was crashing in every browser — see below; J1 no longer presents as a broken tool. Earlier: J7 cleared — migrations 0031-0034 applied to production by Jude). Earlier: 2026-07-30 nightly (K1 + K3 shipped and removed; K2 removed earlier — verified already shipped: the 5-minute Svix timestamp window is live in app/api/webhooks/resend/route.ts)

---

## Needs Jude — blocked, no code will fix these

| # | Item | Why it's blocking | Effort |
|---|---|---|---|
| J1 | **`GOOGLE_PLACES_API_KEY` not set** | The Google Business Profile checker at `/freetools/google-profile` is built and tested but shows its "not switched on yet" state. Needs a Google Cloud project with billing attached — the standing monthly free credit covers this volume, but the card has to be on file. **No longer a dead end**: the hub reads availability from `lib/tools/catalog.ts` per request, so the card renders unclickable with the reason on it and the headline count drops. Adding the key switches it back on within one request, no deploy. | 15 min |
| J2 | **Verify Resend sending domain, then send yourself a response-time test** | `/freetools/response-time` writes to strangers' inboxes. If it lands in spam it teaches people the wrong thing, and a damaged sending reputation would hurt the 07:00 outreach that actually earns money. Confirm `RESEND_FROM_EMAIL` is on a verified domain and run one test end-to-end before promoting the tool anywhere. | 20 min |
| J3 | **Booking `minLeadHours: 24` blocks the slot the call script offers** | The phone script says "would tomorrow morning suit?" — the booking page won't offer it. One of the two has to change. Raised 2026-07-27, no decision yet. | decision |
| J5 | **PDPL scope** | `/policies.html` covers GDPR and the Irish DPA 2018 fully, and scopes PDPL as "contact us before onboarding from outside the EEA" rather than asserting compliance. If a specific Gulf PDPL was meant, that section needs rewriting against it. | decision |
| J6 | **Workforce tools and the EU AI Act's high-risk tier** | If any customer uses the workforce-management tooling to evaluate, monitor or rank *employees*, that likely lands in the high-risk tier — a materially different compliance burden. Needs a yes/no on whether any customer does this. | decision |

---

## Known and not shipped — deliberately

Each of these was found, understood, and left alone with a reason. They are
not forgotten and they are not free to ignore forever.

| # | Item | Why it wasn't shipped | Risk of leaving it |
|---|---|---|---|
| K4 | **`ra_customers` has no dedupe by email** | Same customer can be added twice and get two review requests. | Annoyance, looks sloppy |
| K6 | **`npm run lint` is broken and ESLint isn't installed** | The script runs `next lint`, which Next 16 removed — it now reads "lint" as a directory and fails with *"Invalid project directory provided: /home/user/AutomateIQ/lint"*. There is no `eslint` dependency, no `eslint-config-next` and no config file anywhere in the repo, so this has been dead since the Next 16 upgrade. Left out of the CI gate rather than adding a step that always fails. Fixing it means installing ESLint + a config and then triaging whatever it reports across 56k lines — worth doing, but its own piece of work, not a side effect of adding tests. The script itself is left in place (nothing removed). | half a day |
| K5 | **Booking has no IP-based rate limit** | Needs a nullable column, so it needs a migration and scratch-Postgres validation before it can go near production. | Abuse vector |
| K7 | **`logNoAnswer` still sets the chase to tomorrow unconditionally** | Same shape as the `addActivity` bug fixed 2026-07-31: a no-answer on a lead with a deliberate future date (a 90-day nurture, a booked review) collapses it to tomorrow. Left alone because "back on the list TOMORROW" is an explicit, user-visible promise printed on the call-list card, and quietly changing it would surprise Jude mid-dial. The blast radius is much smaller than the call path (a no-answer on a long-nurture lead is rare). Fix is one call to `resolveChaseDate` plus a copy change on the card. | Rare mis-scheduling |

---

## Free tools — built, live, unfinished edges

The six tools at `/freetools` all work. These are the loose ends.

| # | Item | Notes |
|---|---|---|
| F2 | **Snippets are templates, not written copy** | AutoSEO emits `[square brackets]` for the business to fill in. An AI pass could write the actual title, meta description and alt text per site. Costs money per run, so it changes "free forever" into something rate-limited on purpose. |
| F3 | **Rate limits are per-instance, not global** | `lib/tools/rate-limit.ts` documents this honestly. Fine until a tool gets popular; the fix is a shared store, and the file names the function to move. |
| F4 | **Review writer costs money per use** | 6/day/IP. If it takes off, that cap is the dial to turn — or gate it behind an email. |
| F7 | **The GBP checker's scoring has never run** | `lib/tools/gbp.ts` builds a score and findings from the Places API response, and the key has never been set — so that logic has never executed against a real payload, in production or in a test. AutoSEO's engine had two real bugs found the moment it was tested; assume this one does too. Needs J1 first, then a fixture-driven test suite like `lib/seo/audit.test.ts`. | half a day |
| F6 | **Result states are still plain** | The six tool pages were brought up to the hub's standard (accent per tool, what-you-get strip before the tool, cross-links and a CTA after it). What each tool renders *after* it runs — the AutoSEO report, the review replies, the GBP findings — is still the original markup. It is clear and readable; it is not yet designed. |

---

## Decided against

| Item | Decision | Date |
|---|---|---|
| **J4 — the session length contradicted itself across five surfaces** | Asked to pick, Jude said "I don't know", so decided as CTO: **the customer hears 15 minutes everywhere.** Two things this register had recorded wrongly, found while fixing it: (1) **nothing ever held 45 minutes** — `durationLabel` is a display string only; slot spacing is `slotMinutes: 30`, so leads were told 45 while slots sat 30 apart; (2) the **AI system prompts that generate the outreach** said 30 while the ask instructions in the same file said 15, so `ai.ts` contradicted itself. Changed to 15: lead confirmation email, three AI system prompts, `durationLabel`. No booking logic touched. | 2026-07-31 |


---

## How this file gets used

- **Daytime cleanup pass** — if nothing obvious presents itself in the rotation,
  take the top unblocked item from *Known and not shipped*.
- **Nightly run** — same, and add anything new found during the audit.
- **Any pass** — if an item here is shipped, move it out in the same commit that
  ships it. An item that's still listed after it's done is worse than no list.
