# AutomateIQ Platform — Handoff / Current Status

Written 2026-07-03, at the end of the initial build sessions. Read this
alongside `README.md` (full architecture, env vars, deployment guide).

## What this is

One repo, one Vercel project (`automate-iq`, domain automateiq.ie) containing:

- The **marketing site** (static, in `public/`, served at `/`) — live and unchanged.
- The **platform**: `/portal` (customer app), `/admin` (owner console),
  Review Agent product (send review request emails + one automatic reminder
  after 3 days + click tracking). Built on Next.js 16 + Supabase (Postgres,
  Auth, RLS) + Resend, deployed on Vercel.

Everything is merged to `main` (PR #3) and **live in production**.

## Exactly where things stand right now

### Phase 4 (2026-07-06): AutomateIQ Growth Engine (`/growth`)

A **standalone internal sales & marketing workspace** for turning outbound
prospects into booked AI Strategy Sessions. It is deliberately NOT part of
the customer platform: no links to or from `/portal` or `/admin`, its own
login screen, its own team list, its own `ge_*` tables. It shares only
infrastructure — Supabase Auth, Resend, the design system CSS.

**One setup step: run `supabase/manual_update_0011.sql` in the Supabase SQL
Editor** (after 0010; idempotent — verified to run twice cleanly). Then open
`automateiq.ie/growth` and sign in with the platform admin account — platform
admins are auto-provisioned as Growth Engine owners on first visit, so there
is no bootstrap step to forget. Add further team members (who never gain
customer-platform access — they get profiles.role='growth') in Settings →
Team.

What's in it:

- **Dashboard** (`/growth`) — 30-day KPIs (leads added, outreach sent, reply
  rate, positive-response rate, meetings booked, conversion, qualified,
  pipeline €), follow-ups due, open tasks, top campaigns, recent prospects.
- **Prospect database** (`/growth/prospects`) — search + status/industry/
  campaign filters, manual add, CSV bulk import (deduped by email), and a
  full prospect page: profile editing, pipeline status, notes/calls/meetings
  timeline, tasks with due dates, and per-prospect messaging.
- **AI message generator** — drafts personalised outreach per channel/
  objective (initial, follow-up, re-engagement, booking confirmation, reply)
  /tone using the platform's existing LLM config (`lib/ai`), grounded ONLY
  in the prospect's stored data (instructed never to invent specifics).
  **Nothing sends without a human reviewing the editable draft.** Templates
  (5 seeded, editable in Settings) support `{{placeholders}}`.
- **Channel model** — Email sends directly through Resend (queue, schedule,
  one-click send). LinkedIn / Instagram / SMS are assisted: no approved
  cold-DM APIs exist, so the engine drafts → you copy-send in the app →
  mark sent; tracking stays complete. This posture is explained in
  Settings → Integrations.
- **Conversation inbox** (`/growth/inbox`) — every thread across channels,
  replies-awaiting-you first; log inbound replies with sentiment (feeds the
  positive-response metric); AI-drafted replies; plus the outreach queue
  view (send/mark-sent/delete).
- **Campaigns** (`/growth/campaigns`) — organised by industry/service/
  location/audience with per-campaign funnel: drafts → queued → sent →
  replies → qualified → meetings.
- **Lead qualification** — six 0–3 criteria (company size, industry fit,
  budget, decision-maker, pain points, timeline) → 0–100 score → status via
  thresholds editable in Settings (changing thresholds re-derives every
  prospect's status; manual disqualification always sticks).
- **Meetings & booking** (`/growth/meetings`) — records meetings, and
  **integrates with the existing public /book system read-only**: "Sync
  bookings" matches `strategy_bookings` rows to prospects by email and
  creates `ge_meetings` (idempotent via unique index on
  strategy_booking_id). Admins are notified of Growth-Engine-recorded
  meetings via the same recipient logic as public booking alerts
  (`ownerNotifyRecipients`, now exported).
- **Analytics** (`/growth/analytics`) — 7/30/90-day/all-time windows;
  channel mix, top industries, top campaigns. All numbers come from ONE
  shared calculator (`lib/growth/metrics.ts`) so no screen can disagree.
- **Reports** (`/growth/reports`) — period summary + CSV exports (summary,
  full prospect DB, messages, meetings) via a guarded route handler.
- **Settings** (`/growth/settings`) — booking URL, qualification thresholds,
  template CRUD, team management (invite by email; suspend/remove),
  integration status.

Security: every `ge_*` table is RLS-enabled with **no policies** (deny-all
to anon/authenticated); ALL access goes through service-role server actions
gated by `requireGrowth()` (lib/growth/auth.ts) — the same trust boundary as
/admin. The proxy matcher now includes `/growth/:path*` (UX redirect only);
`requireAdmin` learned to bounce role='growth' accounts to /growth instead
of looping them through /portal. Owner-only: settings, team, deletes.

Verified: `next build` green (all 12 /growth routes compile);
`manual_update_0011.sql` applied twice to a scratch Postgres 16 cleanly;
scoring/CSV/template logic unit-checked; production server smoke-tested —
`/growth/login` 200, unauthenticated `/growth`, `/growth/prospects` and the
CSV export route all 307 → `/growth/login`, and the marketing site, `/login`,
`/book`, `/portal` redirects and robots.txt (now disallowing /growth) are
unchanged. No new env vars — it reuses RESEND_*, ANTHROPIC_API_KEY /
GEMINI_API_KEY and BOOKING_NOTIFY_EMAIL if present.

### Done and verified
- All code deployed; `automateiq.ie/login`, `/setup` etc. resolve correctly.
  (This required `"framework": "nextjs"` in `vercel.json` — the Vercel
  project predated Next.js in this repo and was serving only static files
  until that was added. Do not remove it.)
- Database schema, RLS policies, triggers, seed data all applied to the
  production Supabase project via `supabase/manual_setup.sql` (run in the
  SQL Editor; idempotent, safe to re-run).
- Resend domain automateiq.ie verified.
- Vercel env vars set: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
  `SUPABASE_ANON_KEY` (legacy name, unused), `NEXT_PUBLIC_SUPABASE_URL`,
  `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SETUP_SECRET`, `RESEND_API_KEY`.

### Completed since first writing this doc (2026-07-04 overnight update)
- First admin account bootstrapped and working (`/setup` → invite →
  `/auth/set-password` → `/admin`). The endpoint now permanently refuses
  to create a second admin.
- Supabase Site URL set to `https://automateiq.ie`; Redirect URLs include
  `https://automateiq.ie/auth/set-password`. All invite/reset links go to
  the set-password page (bootstrap, customer invites, password resets).
- Supabase custom SMTP configured through Resend (username is literally
  `resend`, password is the Resend API key) — removed the 2-4/hour
  built-in email rate limit and auth emails now come from
  hello@automateiq.ie.
- All Vercel env vars now set including `NEXT_PUBLIC_SITE_URL`,
  `RESEND_FROM_EMAIL`, `CRON_SECRET`.
- End-to-end verified with a real test customer: invite → login → set
  Google Review Link → send review request → email delivered.
- Resend send failures are no longer silent (SDK returns errors rather
  than throwing; now surfaced as status='failed' + visible message).
- Desktop dashboard upgrade shipped (hero band, richer stats incl. click
  rate, 14-day activity chart, admin activity/customer feeds, two-column
  desktop layouts). Mobile layout unchanged.

### Still to do
1. **Verify the reminder cron end-to-end**: needs a request that's been in
   status 'sent' for 3+ days (or backdate `sent_at` in SQL Editor), then
   confirm exactly one reminder sends at the next 08:00 UTC cron run.
2. **Click-tracking check**: click a review email's button, confirm History
   shows status "Clicked".
3. **Suspension check**: suspend the test customer, confirm immediate
   portal lockout.
4. **Optional cleanup**: rotate `SETUP_SECRET`; delete the test customer.

### Phase 3 (2026-07-05): AI Strategy Session booking + SEO

A premium public conversion page and end-to-end booking system. **Setup:
run `supabase/manual_update_0010.sql` in the Supabase SQL Editor** (after
0009; idempotent). Creates `strategy_bookings` with a partial unique index
that DB-enforces no double-booking of an active slot.

- **Public page** (`/book`, linked from the marketing site's nav, hero and
  footer — all additive, nothing removed) — a full value-first landing page:
  hero, "not a sales call" explainer, What We'll Cover (9), Who It's For,
  Why AutomateIQ, six FAQs, and only then the booking calendar. Built in the
  platform's dark/blue system so it reads as part of the site.
- **Booking calendar** — pick a day + time (Mon–Fri, 09:00–17:00 Irish time,
  30-min slots, ~3 weeks ahead, ≥24h lead), enter name / company / email /
  phone (optional) / business type / message. Taken slots are hidden and the
  DB rejects a race for the same slot.
- **On submit** — saved to Supabase, an instant branded confirmation emails
  the visitor, and an owner notification with full details fires immediately.
- **Admin** (`/admin/bookings`) — upcoming + past lists; approve (sends the
  confirmed email), reschedule (re-notifies; clash-protected), cancel (frees
  the slot), mark completed.
- **SEO** (all additive) — Open Graph + Twitter + canonical + Organization/
  WebSite JSON-LD added to the marketing `<head>`; the `/book` page ships its
  own metadata + Service JSON-LD; `app/robots.ts` → `/robots.txt` and
  `app/sitemap.ts` → `/sitemap.xml` (home, /book, agents, legal pages;
  app/api/portal/admin disallowed) — ready for Search Console.

**New env var:** set **`BOOKING_NOTIFY_EMAIL`** in Vercel to the inbox that
should receive an alert the moment a session is booked. If unset it falls back
to the `RESEND_FROM_EMAIL` address so alerts still land somewhere. No other new
variables. Verified: `next build` green; DB tests confirm double-booking is
rejected, a cancelled slot frees and can be rebooked, the `updated_at` trigger
fires, and `strategy_bookings` is deny-all to the authenticated role (public
create + admin manage go through the service-role client). Nothing on the
existing marketing site was removed — all sections, the lead form and the chat
widget are unchanged; the booking links are additive.

### Phase 2 (2026-07-05): Enterprise Documentation Management System

A full, data-driven documentation platform with database-enforced access.
**One setup step: run `supabase/manual_update_0009.sql` in the Supabase SQL
Editor** (after 0008; idempotent). It creates `doc_documents`, `doc_versions`,
`doc_groups`, `doc_group_members`, `doc_assignments`, `doc_group_assignments`,
plus the `doc_visible_to_member()` visibility function and the customer-read
RLS policy.

What it does:

- **Customer Documentation Centre** (`/portal/documentation`) — a branded,
  searchable library grouped by category, with a premium document viewer
  (branded cover page, reading-progress bar, scrollspy table of contents,
  callouts, tables, checklists, code — all rendered from Markdown with no
  `dangerouslySetInnerHTML`). Customers see **only** the documents assigned to
  them.
- **Admin console** (`/admin/documentation`) — create/edit/delete documents,
  publish / unpublish / archive, per-publish version history with restore,
  assign to individual customers or to groups, a global "visible to all"
  toggle, customer-group management (`/admin/documentation/groups`), and a
  live customer preview (`/admin/documentation/[id]/preview`).
- **Starter library** — a "Load starter library" button seeds 16 professional
  documents (welcome pack, onboarding guide, SOW, technical checklist,
  timeline, change-request form, handover, training manual, user guide, FAQ,
  support guide, maintenance SLA, incident-response, security/GDPR, AI-usage
  policy) from `lib/documentation/library.ts`. Data-driven: admins edit every
  one before publishing; re-running refreshes content without touching
  status/assignments.

Security: access is enforced by RLS, never the frontend. Verified with a
tenant-isolation test (`/tmp/pgv5/dms_isolation_test.sql`): customer A sees
only its assigned + global docs and never customer B's; drafts are invisible;
suspended businesses see nothing; and the assignment/group join tables are
deny-all to the authenticated role (admin reaches them only via the
service-role client). Nothing is published or assigned until the admin does
so — loading the library leaves every doc a private draft.

### V8 (2026-07-05): agents deepened into complete business apps

Per the "every agent must be a substantial, end-to-end product" directive,
the thin agents are being rebuilt into full workflows. **Run
`supabase/manual_update_0008.sql`** (after 0007; idempotent) for these.

- **Instant Quote Agent → quote-to-close lifecycle (shipped).** A quote is
  now a live deal: create → **send a branded quote by email** → the customer
  opens a public page (`/q/<token>`), which marks it *viewed* → they
  **Accept or Decline online** → the business is notified and the pipeline
  shows won/open value + acceptance rate. `0008` adds the lifecycle columns
  to `qa_quotes` (status, customer_email, view_token, sent/viewed/decided
  timestamps). Public routes `/q/[token]` + `/api/q/[token]` need no auth
  (token-scoped, service-role), like the review click route.
- **CRM Agent → real CRM (shipped).** No longer a search list: `0008`
  adds `crm_contacts` (pipeline stage new→won, source), `crm_activities`
  (per-contact timeline), and `crm_tasks` (follow-ups with due dates).
  "Import from agents" pulls review customers + website leads + quote
  recipients into the CRM (deduped by email, each with a logged source
  activity). Contact detail (`/portal/crm-agent/[id]`) shows the full
  timeline, note logging, stage changes, and tasks.
- Content and Speed-to-Lead depth follow in the same series.

### V7 (2026-07-05): architecture hardening + commercial review

- **Read `docs/COMMERCIAL_REVIEW.md`** — full per-agent viability scores,
  pricing model, and go-to-market sell order. **Read `docs/AGENTS.md`** for
  the architecture + "how to add an agent" checklist.
- LLM config centralised in `lib/ai/config.ts` (one place to upgrade the
  model). Product auth guard standardised (`guardProduct`). Dead-code sweep
  found nothing to remove.
- **`manual_update_0007.sql` was extended** with an `stl_settings` table so
  Speed-to-Lead's reply email is now customer-editable (subject + message
  with `{{name}}`/`{{business}}` placeholders + on/off toggle). If you
  already ran 0007 before this change, just run it again — it's idempotent
  and will add the new table.

### Third overnight update (2026-07-04, V5): four new live agents

Content Agent, Instant Quote Agent, CRM Agent and Speed-to-Lead Agent are
now real, working products. **One setup step:**

1. **Run `supabase/manual_update_0007.sql` in the Supabase SQL Editor**
   (one paste, idempotent). Creates ca_content, qa_settings, qa_quotes and
   stl_replies (+ RLS), and adds the four product rows so they can be
   assigned to customers in the admin console. Until it runs: CRM Agent
   works fully (it needs no new tables); the other three degrade
   gracefully (content/quotes still generate but warn they can't save;
   Speed-to-Lead sends but can't log).
2. Assign the new products to a business in **Admin → customer → Products**
   to switch them on.

What they do:

- **Content Agent** (`/portal/content-agent`) — writes blogs, social
  posts, emails and ad copy in the business's brand voice (uses the AI
  Assistant's knowledge + tone), saves everything to a library. Also
  callable by the AI Assistant ("write 3 social posts about…").
- **Instant Quote Agent** (`/portal/instant-quote-agent`) — the business
  saves a price guide; a job description then becomes an itemised quote
  priced ONLY from that guide (uncovered work is flagged "needs
  confirmation", never priced). Quote history kept. AI Assistant tool:
  create_quote.
- **CRM Agent** (`/portal/crm-agent`) — unified, searchable contact list
  merging review customers + website leads. No new tables. AI Assistant
  tool: search_contacts.
- **Speed-to-Lead Agent** — when a website lead with an email address
  arrives, an instant personal acknowledgment goes out via Resend within
  seconds (idempotency-keyed, best-effort, never blocks lead capture);
  the reply log lives at `/portal/speed-to-lead-agent`.

### Second overnight update (2026-07-04, later): all products now real

Website Agent, AI Assistant and Custom Solutions are now functional
end-to-end products, not placeholders. **Two setup steps required before
they work in production:**

1. **Run `supabase/manual_update_0005.sql` in the Supabase SQL Editor**
   (one paste, idempotent — same procedure as manual_setup.sql). Creates
   the wa_/aa_ tables + RLS, and flips website-agent/ai-assistant to
   'active' in the product catalog. Until this runs, those two products'
   pages show a clear "database update required" error instead of working.
2. **Add `ANTHROPIC_API_KEY` to Vercel env vars** (get one at
   console.anthropic.com → API Keys) and redeploy. Only the AI Assistant
   needs this; everything else works without it. Until it's set, the chat
   shows a clear "needs an API key" message.

What each product now does:

- **Website Agent** — customer edits a hosted mini-site (headline, about,
  services, phone, publish toggle) at `/portal/website-agent`; it's served
  publicly at `automateiq.ie/b/<slug>` with a lead-capture form; enquiries
  land in the Leads tab (RLS-scoped) and trigger a best-effort email
  notification to the business's contact email via Resend.
- **AI Assistant** — customer fills in a Knowledge panel (services,
  prices, hours, policies); the chat is backed by Claude
  (model `claude-sonnet-5`), grounded in that knowledge, with conversation
  history persisted per business (aa_conversations/aa_messages).
- **Custom Solutions** — admin creates modules at `/admin/modules`
  (name, description, content, optional embed URL, assigned to a business
  — the Custom Solutions product is auto-enabled for that business);
  each module renders at `/portal/custom-solutions/<slug>` with the
  content and an embedded iframe if an embed URL was set.

## Key knowledge that isn't obvious from the code

- **Sandbox never had real secrets.** All local testing used placeholders;
  real values live only in Vercel. Keep it that way.
- **`proxy.ts` must not be renamed back to `middleware.ts`** — Next.js 16
  convention; runs on Node runtime, avoids an Edge Runtime incompatibility
  with the Supabase SDK.
- **Security model** (details in README): RLS is the real boundary; every
  admin/product server action re-checks authorization itself; admin uses
  the service-role client. `admin_audit_log` records every admin mutation.
- **Reminder correctness**: `claim_due_reminders()` in Postgres claims rows
  atomically BEFORE sending, so a duplicate reminder can't happen even if
  the cron fires twice. Don't "optimize" that order.
- **Adding a future product** = one row in `products` (seed/migration), one
  route folder under `app/portal/<key>/`, one entry in
  `lib/products/registry.ts`. The shell (sidebar/tiles/entitlements) needs
  no changes.

## Where things live

| Thing | Location |
|---|---|
| Full docs | `README.md` |
| DB schema (canonical migrations) | `supabase/migrations/0001–0004` |
| DB schema (one-shot SQL Editor script, already applied) | `supabase/manual_setup.sql` |
| Tenant isolation test | `supabase/tests/tenant_isolation_test.sql` |
| Design system CSS | `app/globals.css` |
| Email template | `lib/email/templates/review-request.tsx` |
| Cron job | `vercel.json` → `/api/cron/dispatch` → `lib/cron/send-review-reminders.ts` |

## Accounts involved

Supabase project, Vercel project (`automate-iq` under the `automate2`
team/account), Resend (domain verified), GitHub repo
`Judefleming134/AutomateIQ`. Whoever picks this up needs access to all four.
