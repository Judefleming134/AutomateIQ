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

Last reviewed: 2026-08-02 daytime (**THE GOOGLE CHECKER NO LONGER NEEDS A PAID
KEY — J1 CLOSED**. It sat dark since it was built, waiting on a Google Cloud
billing account, and money is tight. The Places API was only ever doing data
entry: it read seven facts off a public profile that the owner can see on their
phone in a minute. The part with the value — what each one costs you, what to
do, in what order — was ours the whole time and needed no key at all. The
scoring moved out of the fetch into `lib/tools/gbp-report.ts`, and
`gbp-self.ts` now asks the seven questions and feeds the identical engine, in
the browser, with no API call and nothing to rate-limit. The tool is live on the
hub, back in the sitemap and no longer `noindex`. Three things it does BETTER
than the paid path: it scores a business with NO profile (Places returns "not
found" for those, so the tool had nothing to say to the person with most to
gain), answering the questions is itself the audit, and a bucketed answer is
reported as the bucket — "8–24 reviews", never a made-up "15". Setting the key
later still upgrades it to a real lookup; it just doesn't gate it any more.
**F7 closed with it**: the scorer had never executed once, in production or in a
test, and now has 40 fixture tests — thresholds at 25/8 and 4.5/4.0, a 0.0
rating treated as a failure rather than a missing one, a closed profile jumping
the queue, and the free and paid paths proven to return identical findings.
**J3 decided and shipped**: booking lead time 24h → 12h, so the call script's
"would tomorrow morning suit?" is an offer the booking page can actually honour
— it was refusing the whole of the next morning after any late-morning call.
Same-day booking is still impossible. **The eight pending migrations are now
one paste** at `supabase/bundles/pending_0035_to_0042.sql`, validated end to end
on scratch Postgres 16 with every guard break-tested. **New: K10** — four
production tables are created by no migration in this repo, found because the
scratch baseline couldn't be rebuilt without hand-writing stubs for them.)
Earlier: 2026-08-03 nightly (SSRF CLOSED + PROSPECTS PAGE 99% LIGHTER — see git
history; `safeFetch` re-validates every redirect hop, and two views cut the
prospects page from 42,011 rows in 55 requests to 347 in 3.)

---

## Needs Jude — blocked, no code will fix these

| # | Item | Why it's blocking | Effort |
|---|---|---|---|
| J2 | **Verify Resend sending domain, then send yourself a response-time test** | `/freetools/response-time` writes to strangers' inboxes. If it lands in spam it teaches people the wrong thing, and a damaged sending reputation would hurt the 07:00 outreach that actually earns money. Confirm `RESEND_FROM_EMAIL` is on a verified domain and run one test end-to-end before promoting the tool anywhere. | 20 min |
| J5 | **PDPL scope** | `/policies.html` covers GDPR and the Irish DPA 2018 fully, and scopes PDPL as "contact us before onboarding from outside the EEA" rather than asserting compliance. If a specific Gulf PDPL was meant, that section needs rewriting against it. | decision |
| **JX** | **Run ONE file: `supabase/bundles/pending_0035_to_0042.sql`** | All eight pending migrations (0035–0042) in one paste, in dependency order, wrapped in a single transaction so a failure rolls the lot back. Supabase dashboard → SQL Editor → New query → paste → Run. **This is the only database work outstanding.** Nothing in it drops, renames or rewrites anything; every statement is `IF NOT EXISTS` / `CREATE OR REPLACE`. Validated 2026-08-02 on scratch Postgres 16 against a seeded database (50 businesses, 2,000 prospects, 400 quotes, 300 bookings, 120 content rows, 900 contacts): applies clean, applies clean AGAIN unchanged, every seeded row survives untouched, every new column reads as never-set, `security_invoker=true` on both new views, and every guard proven by trying to break it — negative invoice amount, bad status, a second invoice for one quote, a duplicate invoice number in one business (the same number in a different business allowed), negative page views, bad send status, a case-variant duplicate send, a null opt-in. Until it runs, all eight features report themselves idle and the site is unaffected. **What turns on:** QuoteIQ invoicing + automatic overdue chasing, ContentIQ actually emailing what it writes, SiteIQ hours/areas/view counts, ReputationIQ's automatic review ask (opt-in, default OFF), Jarvis reaching past the same eight dead domains, the booking IP guard, and /growth/prospects going from 42,011 rows in 55 requests to 347 in 3. | **3 min, once** |
| J6 | **Workforce tools and the EU AI Act's high-risk tier** | If any customer uses the workforce-management tooling to evaluate, monitor or rank *employees*, that likely lands in the high-risk tier — a materially different compliance burden. Needs a yes/no on whether any customer does this. | decision |

---

## Known and not shipped — deliberately

Each of these was found, understood, and left alone with a reason. They are
not forgotten and they are not free to ignore forever.

| # | Item | Why it wasn't shipped | Risk of leaving it |
|---|---|---|---|
| K9 | **DNS rebinding can still get past `isPublicWebHost`** | The redirect hole is closed (see the 2026-08-03 nightly entry): `safeFetch` re-validates every hop, so a 302 to `169.254.169.254` is refused and never contacted. What remains is a hostname that PASSES the guard and then RESOLVES to a private address — the guard checks the name, and the connection is made afterwards by the OS resolver, which nothing supervises. Closing it means resolving the host ourselves, checking the resulting IP, and pinning that IP for the connection via a custom `undici` agent — a real change to how the whole app makes outbound connections, with its own failure modes (IPv6, connection reuse, proxies). Not a thing to ship overnight on a Sunday. Materially harder to exploit than the redirect hole: it needs the attacker to control authoritative DNS for a domain and win a TOCTOU race, rather than just return a 302. | half a day |
| K10 | **Four production tables are created by no migration in this repo** | `strategy_bookings`, `ca_content`, `crm_contacts` and `qa_quotes` are all read, altered or referenced by migrations in `supabase/migrations/` — but nothing in the folder ever creates them. They were made directly in the Supabase dashboard and the repo has never known their real shape. Found while validating the 0035–0042 bundle on scratch Postgres: the baseline could not be rebuilt without hand-writing stand-ins for all four, and the stand-ins were guesses. Nothing is broken today — production has the tables — but it means the migration folder can no longer rebuild the database from nothing, so a restore, a staging copy or a second environment would all come up short, and any future migration touching those four is being written blind. The fix is one additive migration that `CREATE TABLE IF NOT EXISTS`es each with its true production shape (dump it from Supabase first, don't guess). Left for a pass with the real schema in hand rather than shipped from four stubs. | 2 hours |
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
| **J3 — booking lead time vs the call script** | The script offers "would tomorrow morning suit?" and `minLeadHours: 24` refused it: an 11am call made everything before 11am next day unbookable, a 2pm call took the whole morning and the early afternoon. Open as an undecided "one of the two has to change" since 2026-07-27. Decided as CTO: **the script is the half that's right** — a lead who says yes to tomorrow morning is the warmest thing the engine produces, and telling them to wait two days is how that goes cold. Lead time is now **12 hours**, the value that makes tomorrow 09:00 bookable from any call placed up to 21:00 today while still making a same-day booking impossible (a 9am call reaches 9pm; the last slot starts 16:30). Purely additive — it only ever adds slots. `lib/booking/lead-time.test.ts` pins both halves. | 2026-08-02 |
| **J4 — the session length contradicted itself across five surfaces** | Asked to pick, Jude said "I don't know", so decided as CTO: **the customer hears 15 minutes everywhere.** Two things this register had recorded wrongly, found while fixing it: (1) **nothing ever held 45 minutes** — `durationLabel` is a display string only; slot spacing is `slotMinutes: 30`, so leads were told 45 while slots sat 30 apart; (2) the **AI system prompts that generate the outreach** said 30 while the ask instructions in the same file said 15, so `ai.ts` contradicted itself. Changed to 15: lead confirmation email, three AI system prompts, `durationLabel`. No booking logic touched. | 2026-07-31 |


---

## How this file gets used

- **Daytime cleanup pass** — if nothing obvious presents itself in the rotation,
  take the top unblocked item from *Known and not shipped*.
- **Nightly run** — same, and add anything new found during the audit.
- **Any pass** — if an item here is shipped, move it out in the same commit that
  ships it. An item that's still listed after it's done is worse than no list.
