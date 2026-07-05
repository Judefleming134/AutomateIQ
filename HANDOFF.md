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
