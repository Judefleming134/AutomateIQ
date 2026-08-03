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

Last reviewed: 2026-08-03 daytime (added **K13** — the 07:00 run sends at most
30 emails a day, so the default target of 50 was never reachable and the brief
reported "at your target of 50/day" anyway. The reporting half is shipped; the
ceiling itself is logged, not moved. Also shipped today: the DM "Copy & open"
button stopped claiming it had opened a tab the popup blocker stopped.)

Previously reviewed: 2026-08-02 evening (**THE NEEDS-JUDE LIST IS EMPTY.** Jude
applied migrations 0035-0042 to production — "Success. No rows returned" — so
QuoteIQ invoicing and overdue chasing, ContentIQ's real send, SiteIQ hours and
view counts, ReputationIQ's automatic review ask (opt-in, still default OFF for
every business), the Jarvis harvest ordering fix, the booking IP guard and the
prospects-page speed fix are all live. J1 was removed earlier the same day by
building the free Google self-check instead of buying the API key; J3 was
decided and shipped (booking lead time 24h->12h); J2, J5 and J6 were confirmed
closed by Jude. Everything remaining in this file is engineering work, not
blocked on him: K10 (four production tables no migration creates), K6 (lint
dead since Next 16), K9 (DNS rebinding), the free-tool edges F2/F3/F4/F6, and
the still-unbacked "online card payment on the link" claim on /products/tradeiq.
Also shipped today: "Log call" stopped reporting a follow-up it never
scheduled, the Message Studio stopped opening on channels a prospect cannot be
reached on, the GBP scorer got its first 40 tests, and the whole schema became
one paste-able file guarded against going stale.)

---

## Needs Jude — blocked, no code will fix these

**Nothing. The list is empty for the first time.**

Migrations 0035–0042 were applied to production by Jude on 2026-08-02
("Success. No rows returned"). J1 was removed by building the free Google
self-check rather than buying the key; J3 was decided and shipped; J2, J5 and
J6 were confirmed by Jude the same day.

Everything still outstanding below is mine to do, not his.

**Turned on by that run, and worth a look when he next has five minutes:**

| What | Where | Note |
|---|---|---|
| QuoteIQ invoicing + overdue chasing | `/tradeiq` | Accepted quote → invoice in one step. Card payment on the link is still NOT built — see the unbacked claim below. |
| ContentIQ "Send to customers" | `/portal/content-agent` | Now actually emails the piece to the ClientIQ list. Shows the recipient count and every exclusion before anything goes. |
| SiteIQ hours, areas, view counts | `/portal/site-agent` | Hours parser refuses "Mon-Fri 9-5" by name rather than guessing — 9–5 could be 17:00 or 05:00. |
| ReputationIQ automatic review ask | business settings | **Opt-in, default OFF for every business.** It does nothing until somebody ticks it, and turning it on cannot reach back over invoices older than 14 days. |
| Jarvis nightly harvest ordering | overnight | Stops re-reading the same eight dead domains and never reaching the ninth. |
| Booking IP guard | `/book` | Optionally set `BOOKING_IP_SALT` to make the stored hash irreversible. Works without it. |
| Prospects page speed | `/growth/prospects` | Should now read 347 rows in 3 requests instead of 42,011 in 55. Worth loading once to confirm it feels quicker. |

---

## Known and not shipped — deliberately

Each of these was found, understood, and left alone with a reason. They are
not forgotten and they are not free to ignore forever.

| # | Item | Why it wasn't shipped | Risk of leaving it |
|---|---|---|---|
| K9 | **DNS rebinding can still get past `isPublicWebHost`** | The redirect hole is closed (see the 2026-08-03 nightly entry): `safeFetch` re-validates every hop, so a 302 to `169.254.169.254` is refused and never contacted. What remains is a hostname that PASSES the guard and then RESOLVES to a private address — the guard checks the name, and the connection is made afterwards by the OS resolver, which nothing supervises. Closing it means resolving the host ourselves, checking the resulting IP, and pinning that IP for the connection via a custom `undici` agent — a real change to how the whole app makes outbound connections, with its own failure modes (IPv6, connection reuse, proxies). Not a thing to ship overnight on a Sunday. Materially harder to exploit than the redirect hole: it needs the attacker to control authoritative DNS for a domain and win a TOCTOU race, rather than just return a 302. | half a day |
| K10 | **Four production tables are created by no migration in this repo** | `strategy_bookings`, `ca_content`, `crm_contacts` and `qa_quotes` are all read, altered or referenced by migrations in `supabase/migrations/` — but nothing in the folder ever creates them. They were made directly in the Supabase dashboard and the repo has never known their real shape. Found while validating the 0035–0042 bundle on scratch Postgres: the baseline could not be rebuilt without hand-writing stand-ins for all four, and the stand-ins were guesses. Nothing is broken today — production has the tables — but it means the migration folder can no longer rebuild the database from nothing, so a restore, a staging copy or a second environment would all come up short, and any future migration touching those four is being written blind. The fix is one additive migration that `CREATE TABLE IF NOT EXISTS`es each with its true production shape (dump it from Supabase first, don't guess). Left for a pass with the real schema in hand rather than shipped from four stubs. | 2 hours |
| K12 | **The cross-company contamination check only exists inside a BATCH** | `runQueuedEmailAutopilot` holds an email whose body names another company from the same 30-email batch while not naming its own prospect — CLAUDE.md calls this gate inviolable, and it is the one that "costs a customer permanently". But it is batch-relative by construction: it compares each draft against the other companies in that morning's run. A mis-merged draft whose foreign company is NOT in the same batch sails through, and the manual **Send** button in the inbox (`sendQueuedEmail`) has no equivalent check at all — it runs `sanitizeOutreachBody` + `draftLooksBroken`, which catch placeholders and invented names but not "this email is about a different business". Found reading the inbox reply flow. NOT shipped: making it work for a single message means either scanning every prospect's company name per send (20k rows, per click) or extracting company-like tokens from the body and querying back — a real design decision with false-positive risk on legitimate drafts that mention a competitor or a customer of theirs, and blocking a genuine send is its own damage. Wants doing properly with Jude's input on how aggressive to be. | half a day |
| K11 | **`/products/tradeiq` still sells "online card payment on the link"** | Invoicing itself is now live (0037/0038 applied 2026-08-02), so most of that sentence became true. The card-payment half did not: an invoice's public page shows the amount and the bank details, and there is no way to pay it there. This is the only claim left on the site that the product does not back. Fixing it is either a Stripe payment link per invoice (real work, and it costs per transaction) or — cheaper and honest today — cutting six words from the page. Not cut unilaterally because it is marketing copy Jude wrote, and changing what the product promises is his call, not mine. | 10 min to cut, ~1 day to build |
| K13 | **The morning send physically tops out at 30/day, and raising the target can't change that** | `runQueuedEmailAutopilot` sends `MAX_SENDS_PER_RUN` (30) because the 07:00 dispatch has a 60-second budget it shares with the booking sync, both queue steps, the invoice-chaser settle and the brief's AI call — and the brief is the thing that must never be left broken. The LIE about it is fixed (2026-08-03): one shared constant, the queue no longer strands mail that was never going out, and the ramp line says the ceiling out loud instead of settling on "at your target of 50/day" while thirty went. What is NOT fixed is the ceiling itself. Real throughput past 30 needs the send window widening, and every option is a change to the money path: a second dispatch later in the morning (a new cron entry, and the 2.5–5h GitHub delay on this repo makes timing awkward), a queue-draining worker on its own schedule like `research-worker.yml`, or cutting the 350ms pacing sleep — which is 10.5s of the budget, and is currently 2.86 req/s against a provider limit documented in the same comment as 2 req/s, so it should probably get SLOWER, not faster. Wants doing deliberately with Jude knowing his volume is about to change. | 30 emails/day of headroom |
| K6 | **`npm run lint` is broken and ESLint isn't installed** | The script runs `next lint`, which Next 16 removed — it now reads "lint" as a directory and fails with *"Invalid project directory provided: /home/user/AutomateIQ/lint"*. There is no `eslint` dependency, no `eslint-config-next` and no config file anywhere in the repo, so this has been dead since the Next 16 upgrade. Left out of the CI gate rather than adding a step that always fails. Fixing it means installing ESLint + a config and then triaging whatever it reports across 56k lines — worth doing, but its own piece of work, not a side effect of adding tests. The script itself is left in place (nothing removed). | half a day |

---

## Free tools — built, live, unfinished edges

The six tools at `/freetools` all work. These are the loose ends.

| # | Item | Notes |
|---|---|---|
| F2 | **Snippets are templates, not written copy** | AutoSEO emits `[square brackets]` for the business to fill in. An AI pass could write the actual title, meta description and alt text per site. Costs money per run, so it changes "free forever" into something rate-limited on purpose. |
| F3 | **Rate limits are per-instance, not global** | `lib/tools/rate-limit.ts` documents this honestly. Fine until a tool gets popular; the fix is a shared store, and the file names the function to move. |
| F4 | **Review writer costs money per use** | 6/day/IP. If it takes off, that cap is the dial to turn — or gate it behind an email. |
| F6 | **Result states are still plain** | The six tool pages were brought up to the hub's standard (accent per tool, what-you-get strip before the tool, cross-links and a CTA after it). What each tool renders *after* it runs — the AutoSEO report, the review replies, the GBP findings — is still the original markup. It is clear and readable; it is not yet designed. |

---

## Decided against

| Item | Decision | Date |
|---|---|---|
| **J2 — Resend sending domain** | Confirmed by Jude: the domain is verified and the response-time tool sends properly. Closed. | 2026-08-02 |
| **J5 — PDPL scope** | Jude: "rest is okay for now". `/policies.html` stands as written — GDPR and the Irish DPA 2018 covered fully, PDPL scoped as "contact us before onboarding from outside the EEA" rather than asserted. Reopen if a specific Gulf PDPL is ever in scope. | 2026-08-02 |
| **J6 — EU AI Act high-risk tier** | Jude: "rest is okay for now" — no customer is using the workforce tooling to evaluate, monitor or rank employees, so the high-risk tier isn't engaged. Worth revisiting the day one does. | 2026-08-02 |
| **J3 — booking lead time vs the call script** | The script offers "would tomorrow morning suit?" and `minLeadHours: 24` refused it: an 11am call made everything before 11am next day unbookable, a 2pm call took the whole morning and the early afternoon. Open as an undecided "one of the two has to change" since 2026-07-27. Decided as CTO: **the script is the half that's right** — a lead who says yes to tomorrow morning is the warmest thing the engine produces, and telling them to wait two days is how that goes cold. Lead time is now **12 hours**, the value that makes tomorrow 09:00 bookable from any call placed up to 21:00 today while still making a same-day booking impossible (a 9am call reaches 9pm; the last slot starts 16:30). Purely additive — it only ever adds slots. `lib/booking/lead-time.test.ts` pins both halves. | 2026-08-02 |
| **J4 — the session length contradicted itself across five surfaces** | Asked to pick, Jude said "I don't know", so decided as CTO: **the customer hears 15 minutes everywhere.** Two things this register had recorded wrongly, found while fixing it: (1) **nothing ever held 45 minutes** — `durationLabel` is a display string only; slot spacing is `slotMinutes: 30`, so leads were told 45 while slots sat 30 apart; (2) the **AI system prompts that generate the outreach** said 30 while the ask instructions in the same file said 15, so `ai.ts` contradicted itself. Changed to 15: lead confirmation email, three AI system prompts, `durationLabel`. No booking logic touched. | 2026-07-31 |


---

## How this file gets used

- **Daytime cleanup pass** — if nothing obvious presents itself in the rotation,
  take the top unblocked item from *Known and not shipped*.
- **Nightly run** — same, and add anything new found during the audit.
- **Any pass** — if an item here is shipped, move it out in the same commit that
  ships it. An item that's still listed after it's done is worse than no list.
