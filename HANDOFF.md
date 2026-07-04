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
