# AutomateIQ

The AutomateIQ marketing site (automateiq.ie) plus the AutomateIQ Platform —
a customer portal (`/portal`) and admin console (`/admin`) built on Next.js
and Supabase, living in the same repo and the same Vercel deployment as the
marketing site.

## What's in this repo

- **Marketing site** — `public/index.html`, `public/agents.html`, and all
  image/script assets. Static, framework-free, unchanged since before the
  platform was added. Served at `/` and `/agents.html` via
  `app/route.ts` (a Route Handler that returns the file's raw bytes — Next.js
  doesn't auto-serve `public/index.html` at the bare root, so this exists
  specifically to make that work without any React/hydration wrapping).
- **`/portal`** — customer-facing app. Supabase Auth, no public sign-up
  (accounts are admin-created only). Each customer sees only their own
  business's data, enforced by Postgres Row Level Security (RLS), not just
  the UI.
- **`/admin`** — the business owner's console: create/suspend/delete
  customers, reset passwords, assign products, view platform stats. Meant to
  fully replace manually managing customers inside the Supabase dashboard.
- **Review Agent** — the first product: send a review-request email, get one
  automatic reminder exactly 3 days later (never a second), track clicks.
  Three more product slots (Website Agent, AI Assistant, Custom Solutions)
  exist as placeholders/framework, ready to become real products later
  without changing the shell around them.
- **`/growth` — the AutomateIQ Growth Engine** — a standalone INTERNAL sales
  & marketing workspace (not part of the customer platform, no links either
  way): prospect database, multi-channel outreach (LinkedIn / Instagram /
  Email / SMS), AI message generator, conversation inbox, lead qualification
  scoring, campaign manager, meetings + booking-page sync, analytics,
  reporting and settings. Own login (`/growth/login`), own team list
  (`ge_team_members`), own deny-all-RLS `ge_*` tables — it shares only
  infrastructure (Supabase Auth, Resend, the design system). Setup: run
  `supabase/manual_update_0013.sql`. Full details in `HANDOFF.md`.

## Tech stack

Next.js 16 (App Router, TypeScript, Turbopack) · Supabase (Postgres, Auth,
RLS) · Resend + React Email · Vercel (hosting + Cron) · plain CSS design
system (no Tailwind/component library — see `app/globals.css`).

## Repo layout

```
public/                          marketing site — untouched by the platform
app/route.ts                     serves public/index.html at "/"
app/layout.tsx                   root layout (fonts, favicon) — does NOT
                                  apply to "/", only to /portal /admin /login
app/login/                       single login page for both account types
app/portal/                      customer app
  layout.tsx                     session guard + sidebar/topbar shell
  page.tsx                       dashboard — product tiles
  review-agent/                  the one live product (send/customers/
                                  history/settings + overview)
  website-agent/, ai-assistant/  "coming soon" placeholders
  custom-solutions/               framework explainer + assigned modules
app/admin/                       admin console (admin-role guard)
  customers/                     list, detail, create/suspend/delete,
                                  password reset, product assignment
app/api/
  lead/route.ts                  marketing site's "Request access" form
  cron/dispatch/route.ts         single Vercel Cron entry, dispatches to
                                  every module's scheduled task (currently
                                  just the review reminder job)
  r/[token]/route.ts             review-link click tracking + redirect
  setup/bootstrap-admin/route.ts one-time first-admin creation
proxy.ts                         session refresh (Next.js 16's replacement
                                  for middleware.ts — runs on the Node.js
                                  runtime, not Edge; see note below)
lib/
  supabase/                      client.ts (browser), server.ts (Server
                                  Components), middleware.ts (session
                                  refresh helper used by proxy.ts),
                                  admin.ts (service-role client — only for
                                  requireAdmin()-gated code)
  auth/                          require-session.ts, require-admin.ts,
                                  require-product.ts — re-checked in every
                                  Server Action/Route Handler, not just
                                  layouts (see Security below)
  products/registry.ts           product metadata (name, icon, route,
                                  accent color) — mirrors the `products`
                                  table, deliberately duplicated
  email/                         Resend client + React Email templates
  cron/send-review-reminders.ts  the reminder job proxy/dispatch calls
components/
  shell/                         sidebar, topbar, mobile nav drawer
  portal/, admin/                shared cards, tables, forms, badges
supabase/
  migrations/                    schema, RLS, auth trigger, reminder-claim
                                  function — apply in order via Supabase CLI
  seed.sql                       the four V1 products (idempotent)
  tests/                         a runnable tenant-isolation smoke test
```

### Why `proxy.ts` and not `middleware.ts`

Next.js 16 renamed the middleware file convention to `proxy.ts`. This isn't
cosmetic: **Proxy always runs on the Node.js runtime**, whereas the old
`middleware.ts` ran on the Edge runtime by default. `@supabase/supabase-js`
does a `process.version` feature-detection check that Next's Edge Runtime
compatibility linter flags as unsupported — using `proxy.ts` avoids that
entirely. Don't rename this back to `middleware.ts`.

## Security model (worth understanding before changing auth code)

- **RLS is the real boundary, not the UI.** Every tenant-scoped table has a
  `business_id` column and a policy built on one helper function,
  `is_active_tenant_member(business_id)`, which also checks
  `businesses.status = 'active'` — a suspended tenant is blocked at the data
  layer, not just hidden in the UI.
- **`proxy.ts` is a UX convenience, not a security boundary.** It refreshes
  the session and redirects unauthenticated users for a better experience,
  but every `/admin` and product-gated Server Action/Route Handler
  independently re-checks the caller's role/entitlement via
  `lib/auth/require-admin.ts` / `require-session.ts` / `require-product.ts`.
  This is deliberate defense-in-depth — Next.js middleware has a real,
  disclosed bypass history (CVE-2025-29927).
- **Admin access uses a service-role client**
  (`lib/supabase/admin.ts`, guarded by the `server-only` package so an
  accidental client-side import fails the build), not an RLS
  `OR role = 'admin'` clause — a smaller, more auditable surface. Every
  admin mutation writes to `admin_audit_log`.
- **No public sign-up, ever.** Admins create accounts via
  `supabase.auth.admin.createUser()` / `inviteUserByEmail()`; a database
  trigger creates the matching `profiles` row atomically, so a user can
  never exist without a profile.

## Environment variables

Set these in the Vercel project (Production **and** Preview environments).
Never commit real values — `.env.local` is gitignored and should only ever
contain placeholder values for local testing.

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL, used by the browser and server clients. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon/publishable key — safe to expose client-side; RLS is what actually protects data. |
| `SUPABASE_URL` | Same Supabase project URL, used server-side by the service-role client and the `/api/lead` route. |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service-role key — bypasses RLS. Used only in `lib/supabase/admin.ts` (admin console) and `app/api/lead/route.ts` (public lead capture, which legitimately needs elevated insert access). Never expose this to the browser. |
| `RESEND_API_KEY` | Resend API key for sending review-request/reminder emails. |
| `RESEND_FROM_EMAIL` | The "From" address for outgoing emails, e.g. `AutomateIQ <hello@automateiq.ie>`. Falls back to Resend's sandbox address if unset — set this once the sending domain is verified with Resend. |
| `LEAD_NOTIFY_EMAIL` | Optional. Inbox that website early-access form submissions are delivered to. Defaults to `hello@automateiq.ie` (general enquiries). |
| `NEXT_PUBLIC_SITE_URL` | The deployed site's base URL (e.g. `https://automateiq.ie`), used to build the click-tracking links (`/api/r/[token]`) embedded in emails. |
| `CRON_SECRET` | Bearer-token secret the cron dispatcher (`/api/cron/dispatch`) checks on every request. Vercel Cron sends this automatically once configured; pick any long random value. |
| `SETUP_SECRET` | One-time secret for `/api/setup/bootstrap-admin`, which creates the very first admin account. Pick any long random value; you can rotate/remove it after the first admin exists (the endpoint also permanently refuses to run a second time regardless). |

## Local development

```bash
npm install
cp .env.local.example .env.local   # fill in real values, or leave as
                                    # placeholders to test everything that
                                    # doesn't need a live Supabase call
npm run dev
```

The marketing site (`/`) works with no environment variables at all. Every
`/portal`, `/admin`, and `/api/*` route needs real Supabase credentials to
do anything beyond render its auth-guard redirect.

## Database migrations

**Option A — Supabase CLI** (requires a computer, not just a phone/browser).
Apply in order:

```bash
npx supabase link --project-ref <your-project-ref>
npx supabase db push
```

This runs, in order: `0001_platform_schema.sql` (tables), `0002_auth_trigger.sql`
(profile-on-signup trigger), `0003_rls.sql` (Row Level Security policies),
`0004_claim_reminders_function.sql` (the atomic reminder-claim function the
cron job calls). Then seed the product catalog:

```bash
npx supabase db execute -f supabase/seed.sql
```

**Option B — Supabase SQL Editor** (no CLI, no computer needed — works from
the Supabase dashboard in a phone browser). Open your project's SQL Editor,
paste the entire contents of `supabase/manual_setup.sql`, and run it once.
It's the same four migrations plus `seed.sql` plus a `leads` table (needed
by the marketing site's lead-capture form, which predates the platform and
isn't part of the numbered migrations), combined into a single idempotent
script — safe to re-run if something goes wrong partway through. Verified
by applying it twice in a row against a real Postgres instance with no
errors, and by running the tenant-isolation test below against its output.

`supabase/tests/tenant_isolation_test.sql` is a self-contained smoke test
(wrapped in `BEGIN … ROLLBACK`, safe to run against a real database) that
asserts one business can never read another's data, and that a suspended
business is blocked even with valid credentials. Optional, but if you want
to run it: paste it into the SQL Editor the same way, after
`manual_setup.sql`.

## Deployment guide

This should require nothing more than connecting four accounts:

1. **Supabase** — create a project, then run the migrations and seed above
   against it.
2. **Resend** — create an API key, and verify the sending domain
   (automateiq.ie) so `RESEND_FROM_EMAIL` can use a real address instead of
   the sandbox one.
3. **GitHub** — this repo, connected as the Vercel project's source.
4. **Vercel** — import the repo, set every environment variable from the
   table above (Production + Preview), and deploy. `vercel.json` already
   defines the daily Cron entry (`/api/cron/dispatch`, 08:00 UTC) — no
   further Vercel configuration needed.

Then, once deployed:

```bash
curl -X POST https://<your-domain>/api/setup/bootstrap-admin \
  -H "Content-Type: application/json" \
  -d '{"email":"you@yourcompany.com","secret":"<SETUP_SECRET value>"}'
```

This sends an invite email to that address — follow it to set a password and
sign in at `/login`. From there, every other admin/customer account is
created from inside `/admin` itself.

## Post-deployment checklist

- [ ] All four Supabase migrations applied, `seed.sql` run.
- [ ] Every environment variable in the table above set in Vercel
      (Production **and** Preview).
- [ ] Resend sending domain verified; `RESEND_FROM_EMAIL` set to a real
      address on that domain.
- [ ] First admin account created via `/api/setup/bootstrap-admin`, invite
      email received, password set, can sign in at `/login` and land on
      `/admin`.
- [ ] From `/admin`, create a test customer, confirm the invite email
      arrives and the account can sign in and lands on `/portal`.
- [ ] In `/portal/review-agent/settings`, set a Google Review Link, then
      send a real review request from `/portal/review-agent/send` — confirm
      the email arrives with the correct business name/logo/link.
- [ ] Click the review link in that email — confirm it redirects correctly
      and the request's status flips to "Clicked" in
      `/portal/review-agent/history`.
- [ ] Suspend the test customer from `/admin` — confirm they're immediately
      locked out of `/portal` even with a still-valid session.
- [ ] Confirm `/`, `/agents.html`, and the "Request access" lead form on the
      marketing site still work exactly as before — the platform should be
      completely invisible to a visitor who never goes to `/portal`,
      `/admin`, or `/login`.
- [ ] Delete/rotate `SETUP_SECRET` once the first admin exists — the
      endpoint refuses to create a second admin regardless, but there's no
      reason to leave the secret live longer than needed.

## Final QA reference (what "done" means for this platform)

- **Auth** — no public sign-up route exists anywhere; every account is
  admin-created.
- **RLS** — verified via `supabase/tests/tenant_isolation_test.sql` and
  during development against a local Postgres install stubbed with
  Supabase's real `auth.uid()` implementation (Docker was unavailable in
  the build sandbox, so this was the verification path used throughout).
- **Emails** — initial send and the one-time reminder both use Resend
  idempotency keys, so a retried request or an overlapping cron run can
  never produce a duplicate send.
- **Reminders** — `claim_due_reminders()` claims rows with
  `FOR UPDATE SKIP LOCKED` and marks them `reminded` *before* sending,
  closing the "duplicate reminder on crash/retry" window that a naive
  "send then update" design would have.
- **Admin permissions** — every `/admin` mutation is re-checked server-side
  via `requireAdmin()`, independent of the `proxy.ts` redirect.
- **Customer permissions** — every `/portal` and product route is re-checked
  via `requireSession()` / `requireProductEnabled()`, independent of RLS and
  independent of the `proxy.ts` redirect (three separate layers).
- **Responsiveness** — the app shell (sidebar, topbar, product grid, tables)
  was verified with Playwright at 1440px/834px/390px widths: no horizontal
  overflow at any width, tables scroll inside their own container instead of
  the page, the sidebar collapses to a slide-in drawer under 900px.
- **Existing site unaffected** — `public/` and the marketing site's own lead
  endpoint were verified byte-identical/behaviorally-identical at every
  stage; `git status` on `public/` shows no changes from the platform work.
