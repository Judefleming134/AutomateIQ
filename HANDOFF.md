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

### In progress — the very next steps (was mid-flight when session ended)
The first admin account bootstrap. The first invite attempt failed because
the Supabase project's Site URL defaulted to localhost; the fix is deployed
(`/auth/set-password` page + explicit redirectTo). Remaining:

1. Supabase dashboard → Authentication → URL Configuration:
   - Site URL = `https://automateiq.ie`
   - Redirect URLs: add `https://automateiq.ie/auth/set-password`
2. Supabase dashboard → Authentication → Users: **delete** the
   half-created user from the failed first invite.
3. Go to `https://automateiq.ie/setup`, enter the owner's email + the
   `SETUP_SECRET` value (the short ~12-char one in Vercel env vars — NOT a
   Supabase key), submit. Click the link in the invite email → set
   password → you land in `/admin`.

The `/setup` page and its API permanently refuse to run once one admin
exists, so it's safe to leave deployed.

### Still to do after that (in order)
1. **Add missing Vercel env vars** (Settings → Environment Variables,
   Production + Preview, then redeploy):
   - `NEXT_PUBLIC_SITE_URL` = `https://automateiq.ie` (click-tracking links
     in emails; code currently falls back to this value anyway)
   - `RESEND_FROM_EMAIL` = e.g. `AutomateIQ <hello@automateiq.ie>` (without
     it, emails send from Resend's sandbox address)
   - `CRON_SECRET` = any long random string (without it the daily reminder
     cron at `/api/cron/dispatch` rejects everything — reminders won't send)
2. **End-to-end test** (checklist in README.md, "Post-deployment"): create a
   test customer in `/admin`, assign Review Agent, log in as them, set a
   Google Review Link in settings, send a review request to yourself,
   confirm the email + click tracking work, suspend the customer and
   confirm lockout.
3. **Optional cleanup**: rotate `SETUP_SECRET`; configure custom SMTP in
   Supabase Auth settings if you want invite/reset emails from your own
   domain (they currently come from Supabase's).

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
