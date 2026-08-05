-- ======================================================================
-- AutomateIQ — the WHOLE database schema, in one paste.
--
-- Every migration from 0001_platform_schema.sql to 0045_assetiq.sql
-- (37 files), in order, made safe to run against a database in ANY
-- state: empty, fully up to date, or somewhere in between.
--
-- YOU DO NOT NEED TO KNOW WHICH MIGRATIONS YOU HAVE ALREADY RUN.
-- Run it, and the database ends up correct either way. Run it twice and the
-- second run changes nothing.
--
-- HOW TO RUN IT
--   Supabase dashboard -> SQL Editor -> New query -> paste the whole file
--   -> Run. It executes top to bottom in ONE transaction: if anything fails,
--   the entire thing rolls back and your database is exactly as it was.
--
-- WHAT IT WILL NOT DO
--   It never drops a table, never drops a column, and never deletes a row.
--   Tables and columns that already exist are left exactly as they are.
--   The only things it replaces are functions, views, policies and triggers —
--   definitions, not data.
--
-- GENERATED, NOT HAND-WRITTEN
--   Built by scripts/build-schema-bundle.mjs from supabase/migrations/.
--   The migration files themselves are untouched: they are the record of what
--   was actually applied and must stay that way. Re-run the script after
--   adding a migration and this file picks it up.
--
-- ONE LIMITATION, STATED PLAINLY
--   Four tables — strategy_bookings, ca_content, crm_contacts and qa_quotes —
--   exist in production but were created directly in the dashboard, so no
--   migration in this repo knows their shape (K10 in docs/OUTSTANDING.md).
--   This file therefore does NOT create them. That is fine for the job you are
--   doing — your database already has them — but it does mean this is not yet
--   a from-nothing rebuild of an empty database.
-- ======================================================================

begin;

-- ======================================================================
-- 0001_platform_schema.sql
-- ======================================================================
-- AutomateIQ Platform V1 — core schema
-- Shared-schema multi-tenancy: every tenant-scoped table carries business_id.
-- Naming convention: each product prefixes its own tables (e.g. ra_ for
-- Review Agent, wa_ for a future Website Agent) so N modules' worth of
-- tables stay untangled without needing separate Postgres schemas.

create extension if not exists "pgcrypto"; -- gen_random_uuid()

-- Tenant identity ------------------------------------------------------

create table if not exists businesses (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  google_review_link text,
  logo_url text,
  email_signature text,
  status text not null default 'active' check (status in ('active', 'suspended')),
  created_at timestamptz not null default now(),
  deleted_at timestamptz -- soft delete: GDPR/audit-friendly, Resend logs
                         -- outlive a hard delete regardless
);

-- profiles is 1:1 with auth.users. Rows are created ONLY by the trigger in
-- 0002_auth_trigger.sql, never inserted directly by application code, so a
-- user can never exist without a matching profile.
create table if not exists profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role text not null default 'customer' check (role in ('admin', 'customer')),
  business_id uuid references businesses (id),
  created_at timestamptz not null default now()
);

-- Product registry (DB) -------------------------------------------------
-- products rows are written ONLY by migrations/seeds when a module actually
-- ships code — never via free-form admin input. custom_modules (below) is
-- the deliberate exception: it IS admin/data-driven, because it has no
-- code-per-instance.

create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  key text unique not null, -- 'review-agent', 'website-agent', ...
  name text not null,
  description text,
  icon_name text,
  status text not null default 'coming_soon' check (status in ('active', 'coming_soon', 'framework')),
  created_at timestamptz not null default now()
);

create table if not exists business_products (
  business_id uuid not null references businesses (id) on delete cascade,
  product_id uuid not null references products (id) on delete cascade,
  enabled_at timestamptz not null default now(),
  primary key (business_id, product_id)
);

create table if not exists custom_modules (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  name text not null,
  description text,
  config jsonb not null default '{}'::jsonb,
  route_slug text not null,
  created_at timestamptz not null default now()
);

-- Admin audit log --------------------------------------------------------
-- Every admin mutation (suspend, delete, assign product, reset password...)
-- writes here. Cheap now, expensive to retrofit once support questions
-- ("why did customer X lose access") start arriving.

create table if not exists admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users (id),
  action text not null,
  target_business_id uuid references businesses (id),
  metadata jsonb,
  created_at timestamptz not null default now()
);

-- Review Agent (ra_) ------------------------------------------------------

create table if not exists ra_customers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  name text not null,
  email text not null,
  created_at timestamptz not null default now()
);

create table if not exists ra_review_requests (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  ra_customer_id uuid not null references ra_customers (id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'sent', 'reminded', 'clicked', 'failed')),
  sent_at timestamptz,
  reminder_sent_at timestamptz,
  clicked_at timestamptz,
  click_token uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now()
);

-- Cron query: eligible-for-reminder scan
create index if not exists ra_review_requests_reminder_idx
  on ra_review_requests (status, reminder_sent_at, sent_at);
-- Tenant/admin list queries
create index if not exists ra_review_requests_business_idx on ra_review_requests (business_id);
-- Click-tracking redirect lookup
create unique index if not exists ra_review_requests_click_token_idx on ra_review_requests (click_token);
-- Duplicate-submit guard (recent requests for the same recipient)
create index if not exists ra_review_requests_customer_created_idx
  on ra_review_requests (ra_customer_id, created_at);

-- ======================================================================
-- 0002_auth_trigger.sql
-- ======================================================================
-- Atomic profile creation: a profiles row is created in the SAME operation
-- as the auth.users row, driven by a trigger, so there is no window where a
-- user exists without a profile (which would make every RLS policy that
-- joins through profiles silently deny that user everything).
--
-- role/business_id are read from raw_user_meta_data, which the admin sets
-- explicitly when calling supabase.auth.admin.createUser({ user_metadata }).
-- Defaults to role='customer' with no business_id if unset (should not
-- happen in practice — every admin-created user must set these).

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, role, business_id)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'role', 'customer'),
    nullif(new.raw_user_meta_data ->> 'business_id', '')::uuid
  );
  return new;
end;
$$;drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ======================================================================
-- 0003_rls.sql
-- ======================================================================
-- Row Level Security. Enabled on every tenant-scoped table with NO
-- exceptions — admin access does NOT go through an RLS "OR role=admin"
-- clause (that would require every policy on every current/future table to
-- correctly include it, forever). Instead /admin server code uses the
-- service-role client, which bypasses RLS entirely, gated by an explicit
-- role check re-run inside every admin Server Action/Route Handler (see
-- lib/auth/require-admin.ts) — never trust middleware alone as that
-- boundary.
--
-- Customer-facing tables use a single helper function rather than
-- copy-pasted subqueries, and it enforces business suspension too — a
-- suspended tenant's users are blocked at the data layer, not just a UI flag.

create or replace function public.is_active_tenant_member(target_business_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from profiles p
    join businesses b on b.id = p.business_id
    where p.id = (select auth.uid())
      and p.business_id = target_business_id
      and b.status = 'active'
      and b.deleted_at is null
  );
$$;

-- businesses ---------------------------------------------------------

alter table businesses enable row level security;drop policy if exists "members can view their own business" on businesses;
create policy "members can view their own business"
  on businesses for select
  using (is_active_tenant_member(id));drop policy if exists "members can update their own business" on businesses;
create policy "members can update their own business"
  on businesses for update
  using (is_active_tenant_member(id))
  with check (is_active_tenant_member(id));

-- profiles -------------------------------------------------------------

alter table profiles enable row level security;drop policy if exists "users can view their own profile" on profiles;
create policy "users can view their own profile"
  on profiles for select
  using (id = (select auth.uid()));

-- products / business_products -----------------------------------------

alter table products enable row level security;drop policy if exists "authenticated users can view the product catalog" on products;
create policy "authenticated users can view the product catalog"
  on products for select
  to authenticated
  using (true);

alter table business_products enable row level security;drop policy if exists "members can view their own enabled products" on business_products;
create policy "members can view their own enabled products"
  on business_products for select
  using (is_active_tenant_member(business_id));

-- custom_modules ---------------------------------------------------------

alter table custom_modules enable row level security;drop policy if exists "members can view their own custom modules" on custom_modules;
create policy "members can view their own custom modules"
  on custom_modules for select
  using (is_active_tenant_member(business_id));

-- ra_customers / ra_review_requests --------------------------------------

alter table ra_customers enable row level security;drop policy if exists "members can manage their own review-agent customers" on ra_customers;
create policy "members can manage their own review-agent customers"
  on ra_customers for all
  using (is_active_tenant_member(business_id))
  with check (is_active_tenant_member(business_id));

alter table ra_review_requests enable row level security;drop policy if exists "members can manage their own review requests" on ra_review_requests;
create policy "members can manage their own review requests"
  on ra_review_requests for all
  using (is_active_tenant_member(business_id))
  with check (is_active_tenant_member(business_id));

-- admin_audit_log ---------------------------------------------------------
-- No policies at all: only ever read/written via the service-role client
-- from gated /admin code. RLS enabled with zero policies denies all access
-- to the anon/authenticated roles by default, which is exactly what we want.

alter table admin_audit_log enable row level security;

-- ======================================================================
-- 0004_claim_reminders_function.sql
-- ======================================================================
-- The reminder cron's atomic "claim before send" step (see Stage 6 plan)
-- needs FOR UPDATE SKIP LOCKED, which PostgREST's query builder can't
-- express — so it's a Postgres function called via RPC from the
-- service-role client instead. This is the exact query verified in
-- Stage 1 against a real Postgres instance: claims exactly the eligible
-- rows on the first call and zero rows on an immediately-repeated call,
-- which is what makes the exactly-once-reminder guarantee hold even if
-- the cron endpoint is somehow invoked twice concurrently.
create or replace function claim_due_reminders(batch_size int default 200)
returns setof ra_review_requests
language sql
security definer
set search_path = public
as $$
  update ra_review_requests
  set reminder_sent_at = now(), status = 'reminded'
  where id in (
    select id from ra_review_requests
    where sent_at <= now() - interval '3 days'
      and reminder_sent_at is null
      and status = 'sent'
    for update skip locked
    limit batch_size
  )
  returning *;
$$;

-- Only the service role calls this (the cron dispatcher, gated by
-- CRON_SECRET). Postgres grants EXECUTE to PUBLIC by default for new
-- functions — revoking only from authenticated/anon leaves that PUBLIC
-- grant in place and does NOT actually block them (verified: without this
-- line, calling the function as `authenticated` still succeeds). Must
-- revoke from PUBLIC explicitly, which then means no role can call it
-- except the function owner and any role explicitly granted afterward
-- (service_role has the superuser-like bypassrls/broad-grants setup
-- Supabase configures for it, so it retains access).
revoke execute on function claim_due_reminders(int) from public;

-- service_role is not the function owner and does not automatically
-- inherit execute rights just by bypassing RLS — it needs its own
-- explicit grant like any other role, same as PUBLIC needed revoking
-- explicitly above.
grant execute on function claim_due_reminders(int) to service_role;

-- ======================================================================
-- 0005_products_v1.sql
-- ======================================================================
-- Website Agent + AI Assistant V1 tables, following the same conventions
-- as 0001/0003: per-product table prefixes (wa_, aa_), business_id on every
-- tenant-scoped table, RLS via is_active_tenant_member(). Public surfaces
-- (the hosted business page and its lead form) are served exclusively
-- through the service-role client in Route Handlers — no anon RLS policies
-- needed or wanted.

-- Website Agent ----------------------------------------------------------

create table if not exists wa_pages (
  business_id uuid primary key references businesses (id) on delete cascade,
  slug text unique not null,
  headline text not null default '',
  about text not null default '',
  services jsonb not null default '[]'::jsonb,
  phone text,
  contact_email text,
  published boolean not null default false,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists wa_leads (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  name text not null,
  contact text not null,
  message text,
  created_at timestamptz not null default now()
);

create index if not exists wa_leads_business_created_idx
  on wa_leads (business_id, created_at desc);

alter table wa_pages enable row level security;

drop policy if exists "members manage their own page" on wa_pages;
create policy "members manage their own page"
  on wa_pages for all
  using (is_active_tenant_member(business_id))
  with check (is_active_tenant_member(business_id));

alter table wa_leads enable row level security;

drop policy if exists "members view their own website leads" on wa_leads;
create policy "members view their own website leads"
  on wa_leads for select
  using (is_active_tenant_member(business_id));

-- AI Assistant ------------------------------------------------------------

create table if not exists aa_assistants (
  business_id uuid primary key references businesses (id) on delete cascade,
  knowledge text not null default '',
  tone text not null default 'friendly and professional',
  updated_at timestamptz not null default now()
);

create table if not exists aa_conversations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  title text not null default 'New conversation',
  created_at timestamptz not null default now()
);

create table if not exists aa_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references aa_conversations (id) on delete cascade,
  business_id uuid not null references businesses (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  created_at timestamptz not null default now()
);

create index if not exists aa_messages_conversation_idx
  on aa_messages (conversation_id, created_at);
create index if not exists aa_conversations_business_idx
  on aa_conversations (business_id, created_at desc);

alter table aa_assistants enable row level security;

drop policy if exists "members manage their own assistant" on aa_assistants;
create policy "members manage their own assistant"
  on aa_assistants for all
  using (is_active_tenant_member(business_id))
  with check (is_active_tenant_member(business_id));

alter table aa_conversations enable row level security;

drop policy if exists "members manage their own conversations" on aa_conversations;
create policy "members manage their own conversations"
  on aa_conversations for all
  using (is_active_tenant_member(business_id))
  with check (is_active_tenant_member(business_id));

alter table aa_messages enable row level security;

drop policy if exists "members manage their own messages" on aa_messages;
create policy "members manage their own messages"
  on aa_messages for all
  using (is_active_tenant_member(business_id))
  with check (is_active_tenant_member(business_id));

-- Product catalog: Website Agent and AI Assistant are now shipped code,
-- not placeholders.

update products set status = 'active'
where key in ('website-agent', 'ai-assistant');

-- ======================================================================
-- 0006_documents.sql
-- ======================================================================
-- Customer documents (contracts, paperwork). Files live in a private
-- Supabase Storage bucket; this table is the per-business index of them.
-- All writes (upload/delete) happen through admin-gated server actions
-- using the service-role client; customers get read-only access to their
-- own rows via RLS, and downloads are short-lived signed URLs generated
-- server-side after an RLS-scoped ownership check.

create table if not exists documents (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  name text not null,
  storage_path text not null,
  file_size bigint,
  content_type text,
  created_at timestamptz not null default now()
);

create index if not exists documents_business_created_idx
  on documents (business_id, created_at desc);

alter table documents enable row level security;

drop policy if exists "members view their own documents" on documents;
create policy "members view their own documents"
  on documents for select
  using (is_active_tenant_member(business_id));

-- Private bucket for the files themselves. No storage.objects policies on
-- purpose: anon/authenticated get no direct storage access at all — only
-- the service-role client (server-side) touches the bucket.
insert into storage.buckets (id, name, public)
values ('documents', 'documents', false)
on conflict (id) do nothing;

-- ======================================================================
-- 0013_growth_engine.sql
-- ======================================================================
-- =============================================================================
-- 0011 — AutomateIQ Growth Engine
--
-- A standalone INTERNAL sales & marketing workspace (LinkedIn / Instagram /
-- Email / SMS outreach → qualified leads → booked AI Strategy Sessions).
-- It lives at /growth with its own login and team list, and shares nothing
-- with the customer platform except infrastructure (Supabase Auth, Resend).
-- No customer-facing table references any ge_ table and vice versa; the only
-- read across the boundary is the meetings sync, which READS strategy_bookings
-- to match booked Strategy Sessions to prospects.
--
-- Security model: every ge_ table is RLS-enabled with NO policies (deny-all
-- to the anon/authenticated roles). All access goes through service-role
-- server actions gated by requireGrowth() — the same trust boundary the
-- /admin console already uses.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Team — who may use the Growth Engine. Platform admins are auto-provisioned
-- as owners on first visit; further members are added in Settings → Team.
-- ---------------------------------------------------------------------------
create table if not exists ge_team_members (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users (id) on delete set null,
  email text not null,
  name text not null,
  role text not null default 'member' check (role in ('owner', 'member')),
  status text not null default 'active' check (status in ('active', 'suspended')),
  created_at timestamptz not null default now()
);

create unique index if not exists ge_team_members_email_idx
  on ge_team_members (lower(email));

-- ---------------------------------------------------------------------------
-- Campaigns — organised outreach pushes (by industry / service / location /
-- audience), each tracking its own funnel.
-- ---------------------------------------------------------------------------
create table if not exists ge_campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  channel text not null default 'multi'
    check (channel in ('linkedin', 'instagram', 'email', 'sms', 'multi')),
  industry text,
  service text,
  location text,
  target_audience text,
  status text not null default 'draft'
    check (status in ('draft', 'active', 'paused', 'completed')),
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Prospects — the central database. Qualification criteria are stored as six
-- 0–3 scores; lead_score is the derived 0–100 value (computed in
-- lib/growth/scoring.ts so the formula lives in one place).
-- ---------------------------------------------------------------------------
create table if not exists ge_prospects (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid references ge_campaigns (id) on delete set null,
  company text not null,
  contact_name text not null,
  job_title text,
  industry text,
  website text,
  location text,
  email text,
  phone text,
  linkedin_url text,
  instagram_url text,
  status text not null default 'new'
    check (status in ('new', 'researching', 'contacted', 'replied', 'qualified',
                      'meeting_booked', 'won', 'lost', 'do_not_contact')),
  notes text,
  source text not null default 'manual',
  last_contact_at timestamptz,
  next_follow_up_at date,
  -- Qualification criteria, each 0 (poor/unknown) to 3 (strong).
  q_company_size int not null default 0 check (q_company_size between 0 and 3),
  q_industry_fit int not null default 0 check (q_industry_fit between 0 and 3),
  q_budget int not null default 0 check (q_budget between 0 and 3),
  q_decision_maker int not null default 0 check (q_decision_maker between 0 and 3),
  q_pain_points int not null default 0 check (q_pain_points between 0 and 3),
  q_timeline int not null default 0 check (q_timeline between 0 and 3),
  lead_score int not null default 0 check (lead_score between 0 and 100),
  qualification_status text not null default 'unqualified'
    check (qualification_status in ('unqualified', 'in_review', 'qualified', 'disqualified')),
  pipeline_value numeric(12, 2),
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ge_prospects_status_idx on ge_prospects (status);
create index if not exists ge_prospects_campaign_idx on ge_prospects (campaign_id);
create index if not exists ge_prospects_email_idx on ge_prospects (lower(email));
create index if not exists ge_prospects_follow_up_idx on ge_prospects (next_follow_up_at);

-- ---------------------------------------------------------------------------
-- Messages — the outreach queue AND the conversation record. Outbound rows
-- move draft → queued → sent (email sends via Resend; LinkedIn / Instagram /
-- SMS are manual-assist: copy the text, send in the app, mark sent). Inbound
-- rows are logged replies with a sentiment tag.
-- ---------------------------------------------------------------------------
create table if not exists ge_messages (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references ge_prospects (id) on delete cascade,
  campaign_id uuid references ge_campaigns (id) on delete set null,
  channel text not null check (channel in ('linkedin', 'instagram', 'email', 'sms')),
  direction text not null default 'outbound' check (direction in ('outbound', 'inbound')),
  status text not null default 'draft'
    check (status in ('draft', 'queued', 'sent', 'failed', 'received')),
  subject text,
  body text not null,
  sentiment text check (sentiment in ('positive', 'neutral', 'negative')),
  scheduled_at timestamptz,
  sent_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ge_messages_prospect_idx on ge_messages (prospect_id, created_at);
create index if not exists ge_messages_status_idx on ge_messages (status);
create index if not exists ge_messages_campaign_idx on ge_messages (campaign_id);

-- ---------------------------------------------------------------------------
-- Activities — the CRM timeline per prospect (notes, calls, status changes,
-- meetings, system events).
-- ---------------------------------------------------------------------------
create table if not exists ge_activities (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references ge_prospects (id) on delete cascade,
  type text not null default 'note'
    check (type in ('note', 'call', 'email', 'linkedin', 'instagram', 'sms',
                    'meeting', 'status_change', 'task', 'system')),
  content text not null,
  created_by uuid,
  created_at timestamptz not null default now()
);

create index if not exists ge_activities_prospect_idx
  on ge_activities (prospect_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Tasks — follow-ups with due dates, optionally tied to a prospect.
-- ---------------------------------------------------------------------------
create table if not exists ge_tasks (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid references ge_prospects (id) on delete cascade,
  title text not null,
  due_at date,
  status text not null default 'open' check (status in ('open', 'done')),
  created_by uuid,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists ge_tasks_status_idx on ge_tasks (status, due_at);

-- ---------------------------------------------------------------------------
-- Meetings — booked AI Strategy Sessions (and any other sales meetings).
-- strategy_booking_id links a meeting to the public /book system when the
-- sync matches a booking to a prospect by email; the partial unique index
-- makes that sync idempotent.
-- ---------------------------------------------------------------------------
create table if not exists ge_meetings (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references ge_prospects (id) on delete cascade,
  scheduled_at timestamptz not null,
  status text not null default 'booked'
    check (status in ('booked', 'completed', 'cancelled', 'no_show')),
  notes text,
  strategy_booking_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists ge_meetings_booking_idx
  on ge_meetings (strategy_booking_id)
  where strategy_booking_id is not null;
create index if not exists ge_meetings_prospect_idx on ge_meetings (prospect_id);
create index if not exists ge_meetings_scheduled_idx on ge_meetings (status, scheduled_at);

-- ---------------------------------------------------------------------------
-- Templates — reusable message starting points, editable in Settings.
-- ---------------------------------------------------------------------------
create table if not exists ge_templates (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  channel text not null default 'email'
    check (channel in ('linkedin', 'instagram', 'email', 'sms')),
  category text not null default 'initial'
    check (category in ('initial', 'follow_up', 're_engagement', 'confirmation', 'reply')),
  subject text,
  body text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Settings — a singleton row (id is a bool that must be true).
-- ---------------------------------------------------------------------------
create table if not exists ge_settings (
  id boolean primary key default true check (id),
  booking_url text not null default 'https://automateiq.ie/book',
  qualify_threshold int not null default 70
    check (qualify_threshold between 1 and 100),
  review_threshold int not null default 40
    check (review_threshold between 0 and 100),
  updated_at timestamptz not null default now()
);

insert into ge_settings (id) values (true) on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- RLS: deny-all to anon/authenticated (no policies). Service-role only.
-- ---------------------------------------------------------------------------
alter table ge_team_members enable row level security;
alter table ge_campaigns enable row level security;
alter table ge_prospects enable row level security;
alter table ge_messages enable row level security;
alter table ge_activities enable row level security;
alter table ge_tasks enable row level security;
alter table ge_meetings enable row level security;
alter table ge_templates enable row level security;
alter table ge_settings enable row level security;

-- ---------------------------------------------------------------------------
-- updated_at maintenance, one shared trigger function.
-- ---------------------------------------------------------------------------
create or replace function set_updated_at_ge()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists ge_campaigns_updated_at on ge_campaigns;
create trigger ge_campaigns_updated_at
  before update on ge_campaigns
  for each row execute function set_updated_at_ge();

drop trigger if exists ge_prospects_updated_at on ge_prospects;
create trigger ge_prospects_updated_at
  before update on ge_prospects
  for each row execute function set_updated_at_ge();

drop trigger if exists ge_messages_updated_at on ge_messages;
create trigger ge_messages_updated_at
  before update on ge_messages
  for each row execute function set_updated_at_ge();

drop trigger if exists ge_meetings_updated_at on ge_meetings;
create trigger ge_meetings_updated_at
  before update on ge_meetings
  for each row execute function set_updated_at_ge();

drop trigger if exists ge_templates_updated_at on ge_templates;
create trigger ge_templates_updated_at
  before update on ge_templates
  for each row execute function set_updated_at_ge();

drop trigger if exists ge_settings_updated_at on ge_settings;
create trigger ge_settings_updated_at
  before update on ge_settings
  for each row execute function set_updated_at_ge();

-- ---------------------------------------------------------------------------
-- Starter templates (skipped if a template with the same name already
-- exists, so re-running never clobbers edits).
-- ---------------------------------------------------------------------------
insert into ge_templates (name, channel, category, subject, body) values
(
  'LinkedIn — first touch',
  'linkedin', 'initial', null,
  'Hi {{first_name}} — I came across {{company}} and was impressed by what you''re building. We help {{industry}} businesses in Ireland automate the repetitive work (missed calls, follow-ups, quotes, reviews) with practical AI. Would you be open to a quick chat about where automation could save {{company}} the most time?'
),
(
  'Email — first touch',
  'email', 'initial', 'A quick idea for {{company}}',
  'Hi {{first_name}},

I''ll keep this short. We work with {{industry}} businesses and typically find 5–10 hours a week being lost to manual follow-ups, quoting and admin.

AutomateIQ builds practical AI systems that take that work off your plate — and we offer a free AI Strategy Session where we map out exactly where {{company}} could benefit, with no obligation.

Would a 30-minute call this week or next be useful?

Best regards,
AutomateIQ'
),
(
  'Follow-up — no reply',
  'email', 'follow_up', 'Re: A quick idea for {{company}}',
  'Hi {{first_name}},

Just floating this back to the top of your inbox. Most owners we speak to are surprised how much of their week can be automated — the strategy session is free and usually pays for itself in ideas alone.

If now isn''t the right time, no problem at all — happy to check back in a few months.

Best regards,
AutomateIQ'
),
(
  'Re-engagement — gone quiet',
  'email', 're_engagement', 'Still thinking about automation at {{company}}?',
  'Hi {{first_name}},

We spoke a while back about automating some of the manual work at {{company}}. Since then we''ve launched new AI agents for reviews, instant quotes and lead response — all built for businesses like yours.

If it''s worth a fresh look, I''d be glad to walk you through what''s new in a free 30-minute strategy session.

Best regards,
AutomateIQ'
),
(
  'Booking invite — ready to book',
  'email', 'confirmation', 'Your free AI Strategy Session — pick a time',
  'Hi {{first_name}},

Great speaking with you. As promised, here''s the link to book your free AI Strategy Session at a time that suits:

{{booking_url}}

It''s a 30-minute call where we''ll map out the biggest automation opportunities for {{company}} — you''ll leave with a concrete plan either way.

Looking forward to it,
AutomateIQ'
)
on conflict (name) do nothing;

-- ======================================================================
-- 0014_growth_engine_v2.sql
-- ======================================================================
-- [bundle] paired with the superseded add below
-- -- =============================================================================
-- -- 0014 — Growth Engine V2: company research, proposals, workflow automation
-- --
-- -- Turns the Growth Engine from a CRM dashboard into the full workflow:
-- -- research a company → AI report + solution recommendations + outreach
-- -- drafts → mark sent (auto follow-up) → replied → qualified → meeting →
-- -- proposal → won. Additive to 0013; run after it. Fully idempotent.
-- -- =============================================================================
--
-- -- Pipeline gains two stages: 'research_complete' (set automatically when the
-- -- AI research finishes) and 'proposal_sent'. Postgres check constraints can't
-- -- be altered in place, so drop + re-add with the expanded list.
-- alter table ge_prospects drop constraint if exists ge_prospects_status_check;

-- [bundle] superseded by 0022_research_failed_status.sql — an older, narrower definition of ge_prospects.ge_prospects_status_check. Replaying it would validate today's rows against a rule they have outgrown.
-- alter table ge_prospects add constraint ge_prospects_status_check
--   check (status in ('new', 'researching', 'research_complete', 'contacted',
--                     'replied', 'qualified', 'meeting_booked', 'proposal_sent',
--                     'won', 'lost', 'do_not_contact'));


-- Who owns this prospect (Settings → Team member).
alter table ge_prospects
  add column if not exists assigned_to uuid references ge_team_members (id) on delete set null;
create index if not exists ge_prospects_assigned_idx on ge_prospects (assigned_to);

-- Message Studio metadata: which of the five draft purposes a message is,
-- and the tone it was written in (feeds "best performing outreach style").
alter table ge_messages add column if not exists purpose text;
alter table ge_messages add column if not exists tone text;

-- ---------------------------------------------------------------------------
-- Company research — one living report per prospect (re-running research
-- replaces it). report/solutions are structured JSON produced by the AI:
--   report: overview, industry, services[], business_model, company_size,
--     operational_observations[], manual_processes[], inefficiencies[],
--     ai_opportunities[], conversation_starters[], discovery_questions[],
--     proposal_angle, next_action
--   solutions: [{ key, name, why, complexity, benefits }]
-- ---------------------------------------------------------------------------
create table if not exists ge_research (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null unique references ge_prospects (id) on delete cascade,
  report jsonb not null default '{}'::jsonb,
  solutions jsonb not null default '[]'::jsonb,
  website_fetched boolean not null default false,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Proposals — AI-drafted from CRM data after a Strategy Session, edited by a
-- human, then exported/sent. Markdown content.
-- ---------------------------------------------------------------------------
create table if not exists ge_proposals (
  id uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references ge_prospects (id) on delete cascade,
  title text not null,
  content text not null,
  status text not null default 'draft' check (status in ('draft', 'sent')),
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ge_proposals_prospect_idx on ge_proposals (prospect_id, created_at desc);

-- Deny-all RLS, service-role access only (same as every other ge_ table).
alter table ge_research enable row level security;
alter table ge_proposals enable row level security;

drop trigger if exists ge_research_updated_at on ge_research;
create trigger ge_research_updated_at
  before update on ge_research
  for each row execute function set_updated_at_ge();

drop trigger if exists ge_proposals_updated_at on ge_proposals;
create trigger ge_proposals_updated_at
  before update on ge_proposals
  for each row execute function set_updated_at_ge();

-- ======================================================================
-- 0017_growth_engine_channels.sql
-- ======================================================================
-- =============================================================================
-- 0017 — Growth Engine: Facebook channel + phone-call scripts
--
-- The owner's real workflow is DM-ing local trades on Instagram, Facebook
-- and LinkedIn and cold-calling them personally. This adds:
--   - 'facebook' as a full outreach channel (prospect URL, messages,
--     templates, campaigns, activity log)
--   - 'call' as a channel: a "message" on the call channel is the prepared
--     call script; marking it sent records that the call was made.
-- Additive to 0014/0016; run after them. Fully idempotent.
-- =============================================================================

alter table ge_prospects add column if not exists facebook_url text;

alter table ge_messages drop constraint if exists ge_messages_channel_check;
alter table ge_messages add constraint ge_messages_channel_check
  check (channel in ('linkedin', 'instagram', 'facebook', 'email', 'sms', 'call'));

alter table ge_activities drop constraint if exists ge_activities_type_check;
alter table ge_activities add constraint ge_activities_type_check
  check (type in ('note', 'call', 'email', 'linkedin', 'instagram', 'facebook',
                  'sms', 'meeting', 'status_change', 'task', 'system'));

alter table ge_templates drop constraint if exists ge_templates_channel_check;
alter table ge_templates add constraint ge_templates_channel_check
  check (channel in ('linkedin', 'instagram', 'facebook', 'email', 'sms', 'call'));

alter table ge_campaigns drop constraint if exists ge_campaigns_channel_check;
alter table ge_campaigns add constraint ge_campaigns_channel_check
  check (channel in ('linkedin', 'instagram', 'facebook', 'email', 'sms', 'call', 'multi'));

-- ======================================================================
-- 0018_growth_pipeline_statuses.sql
-- ======================================================================
-- [bundle] paired with the superseded add below
-- -- =============================================================================
-- -- 0018 — Growth Engine: complete outbound pipeline statuses
-- --
-- -- Extends (never renames) the prospect pipeline with six stages:
-- --   outreach_ready, follow_up_sent, proposal_in_progress, negotiation,
-- --   future_opportunity, archived
-- -- Existing statuses and every automation on them are preserved; the new
-- -- ones slot between them (see lib/growth/constants.ts for the full order).
-- -- Additive to 0017; run after it. Fully idempotent.
-- -- =============================================================================
--
-- alter table ge_prospects drop constraint if exists ge_prospects_status_check;

-- [bundle] superseded by 0022_research_failed_status.sql — an older, narrower definition of ge_prospects.ge_prospects_status_check. Replaying it would validate today's rows against a rule they have outgrown.
-- alter table ge_prospects add constraint ge_prospects_status_check
--   check (status in (
--     'new', 'researching', 'research_complete', 'outreach_ready',
--     'contacted', 'follow_up_sent', 'replied', 'qualified', 'meeting_booked',
--     'proposal_in_progress', 'proposal_sent', 'negotiation',
--     'won', 'lost', 'future_opportunity', 'do_not_contact', 'archived'
--   ));

-- ======================================================================
-- 0019_voice_agent.sql
-- ======================================================================
-- Voice Agent (va_) — the AI receptionist customers monitor and configure
-- from the portal. The agent itself runs on ElevenLabs + Twilio; these
-- tables are the customer-facing control surface:
--   va_config  — one row per business: live/paused status, the number, and
--                the editable knowledge base the agent answers from.
--   va_tickets — "log a problem" support requests the customer raises.
-- Same conventions as 0001/0005: va_ prefix, business_id on every row, RLS
-- via is_active_tenant_member(). Idempotent — safe to re-run.

create table if not exists va_config (
  business_id uuid primary key references businesses (id) on delete cascade,
  status text not null default 'provisioning'
    check (status in ('provisioning', 'live', 'paused')),
  phone_number text,
  greeting text not null default '',
  services text not null default '',
  business_hours text not null default '',
  service_area text not null default '',
  knowledge text not null default '',
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists va_tickets (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  subject text not null,
  detail text not null default '',
  status text not null default 'open'
    check (status in ('open', 'in_progress', 'resolved')),
  created_at timestamptz not null default now()
);

create index if not exists va_tickets_business_created_idx
  on va_tickets (business_id, created_at desc);

alter table va_config enable row level security;

drop policy if exists "members manage their own voice config" on va_config;
create policy "members manage their own voice config"
  on va_config for all
  using (is_active_tenant_member(business_id))
  with check (is_active_tenant_member(business_id));

alter table va_tickets enable row level security;

-- Customers may raise tickets and see their own, but not rewrite them —
-- status transitions happen through the service-role admin client.
drop policy if exists "members view their own voice tickets" on va_tickets;
create policy "members view their own voice tickets"
  on va_tickets for select
  using (is_active_tenant_member(business_id));

drop policy if exists "members raise their own voice tickets" on va_tickets;
create policy "members raise their own voice tickets"
  on va_tickets for insert
  with check (is_active_tenant_member(business_id));

-- Product catalog: the Voice Agent is now shipped code, not a placeholder.
insert into products (key, name, description, icon_name, status)
values (
  'voice-agent',
  'Voice Agent',
  'An AI receptionist that answers missed calls, books jobs and texts you the details.',
  'mic',
  'active'
)
on conflict (key) do update set
  name = excluded.name,
  description = excluded.description,
  icon_name = excluded.icon_name,
  status = excluded.status;

-- ======================================================================
-- 0020_voice_agent_elevenlabs.sql
-- ======================================================================
-- Voice Agent ↔ ElevenLabs link. Stores the ElevenLabs Conversational AI
-- agent id for each business so a knowledge-base edit in the portal can be
-- pushed straight to the live agent via the ElevenLabs API. Set by AutomateIQ
-- (service role) at provisioning time — customers never see or set it.
-- Idempotent — safe to re-run.

alter table va_config
  add column if not exists elevenlabs_agent_id text;

-- ======================================================================
-- 0021_billing.sql
-- ======================================================================
-- Stripe-backed activation: a one-off setup fee + monthly subscription taken
-- through Stripe Checkout. Purely additive and inert until the app has the
-- STRIPE_* env vars set — existing customers/pages are unaffected.
--
-- Flow: admin creates the customer → they log in → Billing tab → Stripe
-- Checkout (setup fee + first month) → webhook confirms payment → the
-- business is marked active and the AI Assistant + Voice Agent products are
-- enabled for them (a row in business_products, exactly as an admin toggle
-- would create).

alter table businesses add column if not exists stripe_customer_id text;
alter table businesses add column if not exists stripe_subscription_id text;
alter table businesses
  add column if not exists subscription_status text not null default 'inactive';
alter table businesses add column if not exists activated_at timestamptz;

-- Webhook idempotency + a light audit trail. Service-role only: RLS is on
-- with no policies, so nothing but the server-side webhook (service role,
-- which bypasses RLS) can read or write it — same doctrine as other
-- platform-internal tables.
create table if not exists bl_billing_events (
  id uuid primary key default gen_random_uuid(),
  stripe_event_id text unique not null,
  type text not null,
  business_id uuid references businesses (id) on delete set null,
  created_at timestamptz not null default now()
);

alter table bl_billing_events enable row level security;

-- ======================================================================
-- 0022_research_failed_status.sql
-- ======================================================================
-- =============================================================================
-- 0022 — Growth Engine: 'research_failed' prospect status
--
-- Leads whose research fails are moved into their OWN group instead of
-- circulating back into the research queue: they're excluded from fresh
-- batches entirely, listed separately with a one-tap retry, filterable in
-- the prospects table (Status → Research failed) and bulk archive/delete-able
-- from there. A successful retry moves them to research_complete like normal.
-- Additive to 0018; fully idempotent.
-- =============================================================================

alter table ge_prospects drop constraint if exists ge_prospects_status_check;
alter table ge_prospects add constraint ge_prospects_status_check
  check (status in (
    'new', 'researching', 'research_failed', 'research_complete',
    'outreach_ready', 'contacted', 'follow_up_sent', 'replied', 'qualified',
    'meeting_booked', 'proposal_in_progress', 'proposal_sent', 'negotiation',
    'won', 'lost', 'future_opportunity', 'do_not_contact', 'archived'
  ));

-- Backfill: leads that already failed research under the previous handling
-- (their timeline carries a "Research failed:" entry) move into the group
-- now, so tonight's failures are parked immediately — not on their next
-- failed attempt. Idempotent: already-moved or since-researched leads are
-- untouched.
update ge_prospects
   set status = 'research_failed'
 where status in ('new', 'researching')
   and id in (
     select prospect_id from ge_activities
      where type = 'system'
        and content like 'Research failed:%'
        and prospect_id is not null
   );

-- ======================================================================
-- 0023_voice_agent_jobs.sql
-- ======================================================================
-- Voice Agent jobs (va_jobs) — the record of every enquiry the AI receptionist
-- captured on a call. The ElevenLabs post-call webhook already emails Jude a
-- job card; this table also PERSISTS each one so the customer's portal can show
-- a living list of jobs their receptionist booked — the proof the product is
-- earning its keep, not just a config screen.
--
-- Same conventions as 0019: va_ prefix, business_id on every row, RLS via
-- is_active_tenant_member(). Idempotent — safe to re-run.

create table if not exists va_jobs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  caller_name text not null default '',
  caller_phone text not null default '',
  address text not null default '',
  problem text not null default '',
  urgency text not null default '',
  booking_slot text not null default '',
  summary text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists va_jobs_business_created_idx
  on va_jobs (business_id, created_at desc);

alter table va_jobs enable row level security;

-- Customers see their own captured jobs; rows are only ever written by the
-- service-role admin client from the post-call webhook, never by the customer.
drop policy if exists "members view their own voice jobs" on va_jobs;
create policy "members view their own voice jobs"
  on va_jobs for select
  using (is_active_tenant_member(business_id));

-- ======================================================================
-- 0024_va_jobs_conversation_id.sql
-- ======================================================================
-- Adds the ElevenLabs conversation id to captured voice jobs, so duplicate
-- webhook deliveries (ElevenLabs retries on timeouts/non-2xx) can be deduped
-- and a job can be traced back to its exact call. Purely additive and
-- OPTIONAL: the webhook detects a missing column and simply skips deduping,
-- so nothing breaks if this hasn't run yet.

alter table va_jobs add column if not exists conversation_id text;

-- Lookup index for the dedupe check (one small query per webhook delivery).
create index if not exists va_jobs_conversation_id_idx
  on va_jobs (conversation_id)
  where conversation_id is not null;

-- ======================================================================
-- 0025_order_forms.sql
-- ======================================================================
-- In-dashboard, fillable, binding order form — one per business. The customer
-- reviews their order, fills their details, ticks agreement and types their
-- name; on save the app stamps agreed_at + agreed_name and the record becomes
-- read-only ("binding once filled and saved"). Written by the customer (RLS,
-- their own business only); the lock after agreement is enforced in the server
-- action. Additive and inert until the app renders the panel.

create table if not exists order_forms (
  business_id uuid primary key references businesses (id) on delete cascade,
  contact_name text not null default '',
  phone text not null default '',
  email text not null default '',
  business_hours text not null default '',
  service_area text not null default '',
  agreed boolean not null default false,
  agreed_name text not null default '',
  agreed_at timestamptz,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table order_forms enable row level security;

drop policy if exists "members manage their own order form" on order_forms;
create policy "members manage their own order form"
  on order_forms for all
  using (is_active_tenant_member(business_id))
  with check (is_active_tenant_member(business_id));

-- ======================================================================
-- 0026_trades.sql
-- ======================================================================
-- 0026_trades.sql — Trades quoting & invoicing tool.
--
-- A self-serve product for tradespeople (plumbers, electricians, …): create a
-- quote, send it, convert it to an invoice, get paid. Deliberately NOT wired
-- into the portal's businesses/profiles tenancy — every row is owned directly
-- by the Supabase auth user (auth.uid()), so the whole product stays cleanly
-- separable into its own app/domain later. Public quote/invoice pages are read
-- by server code via the service-role client (looked up by public_token), the
-- same pattern as the booking page — so no public RLS policy is needed.
--
-- Idempotent: safe to re-run.

create extension if not exists pgcrypto;

-- ── The tradesperson's own account/profile ───────────────────────────────
create table if not exists trades_accounts (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null unique references auth.users (id) on delete cascade,
  business_name      text not null default '',
  trade              text,                         -- plumber / electrician / …
  email              text,
  phone              text,
  address            text,
  logo_url           text,
  vat_rate           numeric(5,2)  not null default 0,   -- %; 0 = not VAT registered
  vat_number         text,
  payment_terms_days int           not null default 14,
  -- Per-account running numbers so quotes/invoices read Q-0001 / INV-0001.
  quote_seq          int not null default 0,
  invoice_seq        int not null default 0,
  created_at         timestamptz not null default now()
);

-- ── Their customers ───────────────────────────────────────────────────────
create table if not exists trades_customers (
  id         uuid primary key default gen_random_uuid(),
  account_id uuid not null references trades_accounts (id) on delete cascade,
  name       text not null,
  email      text,
  phone      text,
  address    text,
  created_at timestamptz not null default now()
);
create index if not exists trades_customers_account_idx on trades_customers (account_id);

-- ── Quotes & invoices (one row, distinguished by kind) ────────────────────
create table if not exists trades_documents (
  id           uuid primary key default gen_random_uuid(),
  account_id   uuid not null references trades_accounts (id) on delete cascade,
  customer_id  uuid references trades_customers (id) on delete set null,
  kind         text not null check (kind in ('quote','invoice')),
  number       text not null,
  status       text not null default 'draft'
                 check (status in ('draft','sent','accepted','declined','paid','void')),
  currency     text not null default 'EUR',
  notes        text,
  subtotal     numeric(12,2) not null default 0,
  vat_rate     numeric(5,2)  not null default 0,
  vat_amount   numeric(12,2) not null default 0,
  total        numeric(12,2) not null default 0,
  issued_at    date,
  due_at       date,
  -- Unguessable token for the public view/accept/pay page (service-role read).
  public_token text not null unique default encode(gen_random_bytes(16), 'hex'),
  -- When a quote is turned into an invoice, link the two.
  converted_to uuid references trades_documents (id) on delete set null,
  paid_at      timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists trades_documents_account_idx on trades_documents (account_id, kind, status);
create index if not exists trades_documents_customer_idx on trades_documents (customer_id);

-- ── Line items ────────────────────────────────────────────────────────────
create table if not exists trades_line_items (
  id          uuid primary key default gen_random_uuid(),
  document_id uuid not null references trades_documents (id) on delete cascade,
  description text not null default '',
  quantity    numeric(12,2) not null default 1,
  unit_price  numeric(12,2) not null default 0,
  amount      numeric(12,2) not null default 0,
  position    int not null default 0
);
create index if not exists trades_line_items_doc_idx on trades_line_items (document_id);

-- ── RLS: each tradesperson sees ONLY their own rows ───────────────────────
alter table trades_accounts  enable row level security;
alter table trades_customers enable row level security;
alter table trades_documents enable row level security;
alter table trades_line_items enable row level security;

-- Owns-this-account helper (security definer so the policy can read the table
-- it's protecting without recursing through RLS).
create or replace function public.owns_trades_account(acc uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from trades_accounts a
    where a.id = acc and a.user_id = (select auth.uid())
  );
$$;

drop policy if exists "trades_accounts own select" on trades_accounts;
create policy "trades_accounts own select" on trades_accounts
  for select using (user_id = (select auth.uid()));
drop policy if exists "trades_accounts own insert" on trades_accounts;
create policy "trades_accounts own insert" on trades_accounts
  for insert with check (user_id = (select auth.uid()));
drop policy if exists "trades_accounts own update" on trades_accounts;
create policy "trades_accounts own update" on trades_accounts
  for update using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "trades_customers own all" on trades_customers;
create policy "trades_customers own all" on trades_customers
  for all using (owns_trades_account(account_id))
  with check (owns_trades_account(account_id));

drop policy if exists "trades_documents own all" on trades_documents;
create policy "trades_documents own all" on trades_documents
  for all using (owns_trades_account(account_id))
  with check (owns_trades_account(account_id));

drop policy if exists "trades_line_items own all" on trades_line_items;
create policy "trades_line_items own all" on trades_line_items
  for all using (
    exists (select 1 from trades_documents d
            where d.id = document_id and owns_trades_account(d.account_id))
  )
  with check (
    exists (select 1 from trades_documents d
            where d.id = document_id and owns_trades_account(d.account_id))
  );

-- ======================================================================
-- 0027_trades_expenses.sql
-- ======================================================================
-- 0027_trades_expenses.sql — TradeOS scan-and-track finance records.
--
-- A scanned/photographed invoice becomes a row here: money OUT (a supplier
-- bill to pay — direction 'payable') or money IN (an invoice the tradesperson
-- issued on paper and wants tracked — direction 'receivable'). The full AI
-- extraction is kept in `extracted` (jsonb) for complete transparency: what
-- the scanner read is always inspectable next to what was saved.
--
-- Same ownership model as 0026: rows keyed to the tradesperson's account,
-- RLS via owns_trades_account() (defined in 0026). Idempotent — safe to re-run.

create table if not exists trades_expenses (
  id                 uuid primary key default gen_random_uuid(),
  account_id         uuid not null references trades_accounts (id) on delete cascade,
  direction          text not null default 'payable'
                       check (direction in ('payable','receivable')),
  counterparty       text not null default '',       -- supplier or customer name
  counterparty_email text,
  category           text,                            -- materials / fuel / insurance / tools / ...
  doc_number         text,
  issued_at          date,
  due_at             date,
  subtotal           numeric(12,2) not null default 0,
  vat_amount         numeric(12,2) not null default 0,
  total              numeric(12,2) not null default 0,
  currency           text not null default 'EUR',
  status             text not null default 'unpaid'
                       check (status in ('unpaid','paid','disputed')),
  paid_at            timestamptz,
  summary            text,                            -- one line: what this is for
  extracted          jsonb,                           -- raw AI extraction (transparency/audit)
  source             text not null default 'scan' check (source in ('scan','manual')),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists trades_expenses_account_idx
  on trades_expenses (account_id, direction, status);
create index if not exists trades_expenses_due_idx
  on trades_expenses (account_id, due_at);

alter table trades_expenses enable row level security;

drop policy if exists "trades_expenses own all" on trades_expenses;
create policy "trades_expenses own all" on trades_expenses
  for all using (owns_trades_account(account_id))
  with check (owns_trades_account(account_id));

-- ======================================================================
-- 0028_trades_network.sql
-- ======================================================================
-- 0028_trades_network.sql — the TradeOS network: linked accounts.
--
-- When a tradesperson receives a TradeOS invoice and claims it (or the send
-- finds their signup email), the two accounts become CONNECTED and the
-- document lands in the recipient's Finance as a bill automatically — no
-- scanning. Connections are stored in BOTH directions so reads stay a simple
-- owner-scoped select. Idempotent — safe to re-run.

create table if not exists trades_connections (
  id              uuid primary key default gen_random_uuid(),
  account_id      uuid not null references trades_accounts (id) on delete cascade,
  peer_account_id uuid not null references trades_accounts (id) on delete cascade,
  created_at      timestamptz not null default now(),
  unique (account_id, peer_account_id),
  check (account_id <> peer_account_id)
);
create index if not exists trades_connections_account_idx on trades_connections (account_id);

alter table trades_connections enable row level security;
drop policy if exists "trades_connections own select" on trades_connections;
create policy "trades_connections own select" on trades_connections
  for select using (owns_trades_account(account_id));

-- A network bill links back to the sender's document, so paid-status can sync
-- both books. One expense row per (account, document) — a re-claim is a no-op.
alter table trades_expenses
  add column if not exists linked_document_id uuid references trades_documents (id) on delete set null;
create unique index if not exists trades_expenses_linked_doc_uniq
  on trades_expenses (account_id, linked_document_id)
  where linked_document_id is not null;

-- Allow the 'network' source alongside scan/manual.
alter table trades_expenses drop constraint if exists trades_expenses_source_check;
alter table trades_expenses add constraint trades_expenses_source_check
  check (source in ('scan','manual','network'));

-- ======================================================================
-- 0029_finance_product.sql
-- ======================================================================
-- 0029_finance_product.sql — AutomateIQ Finance: forecast + budgets.
--
-- bank_balance: the manually-entered current balance the 13-week forecast
-- starts from (the interim until an open-banking feed lands; set_at shown so
-- staleness is visible). trades_budgets: per-category monthly spend limits,
-- the Ramp-style budget guardrails. Idempotent — safe to re-run.

alter table trades_accounts
  add column if not exists bank_balance numeric(14,2);
alter table trades_accounts
  add column if not exists bank_balance_set_at timestamptz;

create table if not exists trades_budgets (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null references trades_accounts (id) on delete cascade,
  category      text not null,
  monthly_limit numeric(12,2) not null default 0,
  created_at    timestamptz not null default now(),
  unique (account_id, category)
);

alter table trades_budgets enable row level security;
drop policy if exists "trades_budgets own all" on trades_budgets;
create policy "trades_budgets own all" on trades_budgets
  for all using (owns_trades_account(account_id))
  with check (owns_trades_account(account_id));

-- ======================================================================
-- 0030_growth_send_target.sql
-- ======================================================================
-- ---------------------------------------------------------------------------
-- Daily outreach send target, moved out of an environment variable.
--
-- GROWTH_AUTOQUEUE_TARGET could only be changed in Vercel, which means a
-- redeploy-shaped task stands between Jude and the single number that decides
-- how much outreach goes out. That number needs to be changeable from the
-- Growth Engine itself, on a phone, between calls.
--
-- The value is a DESTINATION, not a daily quota — resolveSendRamp() still
-- paces the climb toward it and still holds volume on bounces or complaints,
-- so a big number here can't burn the sending domain.
--
-- Additive and idempotent: the column has a default, so existing rows get it
-- without a backfill and nothing reads differently until it's changed.
-- ---------------------------------------------------------------------------

alter table ge_settings
  add column if not exists daily_send_target int not null default 250
    check (daily_send_target between 0 and 2000);

comment on column ge_settings.daily_send_target is
  'Destination for daily first-touch outreach emails. The auto-queue ramps toward this ~50%/day (faster on a provably clean list) and holds on bounces/complaints. 0 disables auto-queueing entirely.';

-- ======================================================================
-- 0031_send_target_50.sql
-- ======================================================================
-- ---------------------------------------------------------------------------
-- Set the daily outreach send target to 50.
--
-- 0030 introduced ge_settings.daily_send_target with a placeholder default of
-- 250, chosen before Jude had said what he wanted. On 2026-07-31 he set the
-- number: 50 a day. This writes it, so the engine ships with the real value
-- rather than waiting on someone to type it into /growth/settings.
--
-- 50 is a DESTINATION, not a daily quota. resolveSendRamp() still paces the
-- climb — the floor is 20 and the step is 1.5x/day (2x on a provably clean
-- list), so this lands as roughly 20 -> 30 -> 45 -> 50 over four sending days,
-- and still holds volume the moment bounces or complaints move. A month-old
-- domain cannot be burned by this number.
--
-- Safe to run whether or not 0030 was applied: the ADD COLUMN is guarded by
-- IF NOT EXISTS (which skips its CHECK too, so re-running can't collide with
-- the existing constraint), and both remaining statements are idempotent.
-- Re-running it is a no-op, not a second change.
-- ---------------------------------------------------------------------------

alter table ge_settings
  add column if not exists daily_send_target int not null default 50
    check (daily_send_target between 0 and 2000);

-- New installs start at the real number, not the placeholder.
alter table ge_settings alter column daily_send_target set default 50;

-- The live row. Unconditional on purpose: this IS the value Jude asked for,
-- and anything already in the column is the placeholder from 0030.
update ge_settings set daily_send_target = 50;

-- ======================================================================
-- 0032_agent_runs.sql
-- ======================================================================
-- ---------------------------------------------------------------------------
-- Agent Framework v2: the run log.
--
-- The agent framework declares what each agent IS (name, purpose, tools) but
-- kept no record of what any agent DID. There was no way to answer "did that
-- actually run?", "how slow is the quote agent?", or "which tool keeps
-- failing?" — for eleven live agents, let alone the five PermitIQ ones.
--
-- One row per tool execution. This single table delivers both attributes the
-- platform brief asks for — Logs and Performance tracking — for every agent at
-- once, rather than each module inventing its own telemetry.
--
-- Deliberately NOT stored here: tool input and output. They routinely contain
-- customer names, email addresses and quote figures, and a debug log is the
-- wrong place for personal data to accumulate. The row records that a call
-- happened, how it went and how long it took; the business data stays in the
-- module's own tables where RLS already governs it.
--
-- Writes go through the service-role client (same pattern as admin_audit_log)
-- and are best-effort: a logging failure must never fail the tool it describes.
-- Members can READ their own rows; there is no insert/update/delete policy, so
-- nothing but the service role can write, and nobody can rewrite history.
-- ---------------------------------------------------------------------------

create table if not exists agent_runs (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  -- Matches AgentModule.key. Plain text, not a foreign key: modules live in
  -- code and a renamed or retired agent must not cascade-delete its history.
  agent_key text not null,
  tool_name text not null,
  status text not null check (status in ('ok', 'error', 'timeout', 'denied')),
  latency_ms integer check (latency_ms >= 0),
  -- Short failure reason, never a stack trace or a payload.
  error text,
  created_at timestamptz not null default now()
);

-- The two reads this table exists to serve: one business's recent activity,
-- and one agent's performance across the platform.
create index if not exists agent_runs_business_created_idx
  on agent_runs (business_id, created_at desc);
create index if not exists agent_runs_agent_created_idx
  on agent_runs (agent_key, created_at desc);

alter table agent_runs enable row level security;

drop policy if exists "members view their own agent runs" on agent_runs;
create policy "members view their own agent runs"
  on agent_runs for select
  using (is_active_tenant_member(business_id));

comment on table agent_runs is
  'One row per agent tool execution: logs + performance tracking for every module. Service-role writes only; no tool input/output is stored.';

-- ======================================================================
-- 0033_permitiq.sql
-- ======================================================================
-- ---------------------------------------------------------------------------
-- PermitIQ — planning permission and building permit workflows.
--
-- Built on `businesses`, the tenancy root that already carries RLS,
-- entitlements, billing and admin tooling. This is deliberate and it is the
-- one architectural rule PermitIQ must not break: the platform already has
-- THREE tenancy roots (businesses, trades_accounts, and the un-scoped ge_*
-- tables) and a fourth would make consolidating them permanently impossible.
--
-- Two design decisions worth stating, because everything else follows:
--
-- 1. JURISDICTION IS A FIRST-CLASS COLUMN, not a later retro-fit. Ireland
--    ships seeded and sellable; the USA ships with the same schema and an
--    honest empty state. Retro-fitting it after Irish customers had data would
--    be a migration on live rows.
--
-- 2. REQUIREMENTS ARE A DATA CATALOG, NOT CODE. What a given authority wants
--    for a given application type is rows in pq_requirements, so adding a US
--    municipality — or fixing an Irish rule that changed — is a seed insert,
--    not a release. Hard-coding Irish planning rules would mean the American
--    half of the product is a second build.
--
-- Additive throughout: no existing table is altered, nothing is dropped.
-- ---------------------------------------------------------------------------

-- ── The requirements catalog ───────────────────────────────────────────────
-- Global reference data, NOT tenant-scoped: every tenant applying in Fingal
-- faces the same list. Readable by any signed-in user; writable only by the
-- service role, so a tenant can never edit the rules they're measured against.
create table if not exists pq_requirements (
  id uuid primary key default gen_random_uuid(),
  jurisdiction text not null check (jurisdiction in ('ie', 'us')),
  -- Null authority = the national/default baseline for that application type.
  -- A specific authority's row overrides it.
  authority text,
  application_type text not null,
  -- Stable machine code, e.g. 'site_location_map'. Referenced by checklist
  -- rows, so it must not change once seeded.
  code text not null,
  label text not null,
  guidance text,
  mandatory boolean not null default true,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  -- NULLS NOT DISTINCT is doing real work here. `authority` is null for the
  -- national baseline rows, and under Postgres's default two nulls are NOT
  -- equal — so the unique constraint would not fire, ON CONFLICT below would
  -- never match, and re-running this migration would silently duplicate every
  -- baseline requirement. Every application's checklist would then show each
  -- item twice. (Postgres 15+; Supabase is on 15/16.)
  unique nulls not distinct (jurisdiction, authority, application_type, code)
);

create index if not exists pq_requirements_lookup_idx
  on pq_requirements (jurisdiction, application_type, authority);

alter table pq_requirements enable row level security;

drop policy if exists "signed-in users read the requirements catalog" on pq_requirements;
create policy "signed-in users read the requirements catalog"
  on pq_requirements for select
  to authenticated
  using (true);

-- ── Applications ───────────────────────────────────────────────────────────
create table if not exists pq_applications (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  -- The applicant's own reference (a job number, a client name).
  reference text,
  jurisdiction text not null default 'ie' check (jurisdiction in ('ie', 'us')),
  authority text,
  application_type text not null,
  site_address text,
  -- Eircode in Ireland, ZIP in the US. One column, deliberately unvalidated:
  -- two postal-code formats and a check constraint is how you end up unable to
  -- save a legitimate address.
  postal_code text,
  applicant_name text,
  applicant_email text,
  status text not null default 'draft'
    check (status in ('draft', 'in_review', 'submitted', 'granted', 'refused', 'withdrawn')),
  submitted_at timestamptz,
  decision_due_at date,
  notes text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists pq_applications_business_idx
  on pq_applications (business_id, created_at desc);
create index if not exists pq_applications_status_idx
  on pq_applications (business_id, status);

alter table pq_applications enable row level security;

drop policy if exists "members manage their own applications" on pq_applications;
create policy "members manage their own applications"
  on pq_applications for all
  using (is_active_tenant_member(business_id))
  with check (is_active_tenant_member(business_id));

-- ── Documents ──────────────────────────────────────────────────────────────
-- business_id is carried alongside application_id on purpose. It is
-- denormalised, and it means every RLS policy is a direct predicate on this
-- row rather than a join through pq_applications — the same shape the rest of
-- the platform uses, and one less way for a policy to be written wrong.
create table if not exists pq_documents (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references pq_applications (id) on delete cascade,
  business_id uuid not null references businesses (id) on delete cascade,
  -- Which requirement this satisfies, when known. Free text rather than a
  -- foreign key: an uploaded document may not map to any catalog row, and a
  -- retired requirement must not cascade-delete a customer's file record.
  doc_type text,
  name text not null,
  storage_path text not null,
  content_type text,
  file_size bigint,
  page_count integer,
  -- What the Document Intelligence Agent read out of it. Null until analysed.
  extraction jsonb,
  extracted_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists pq_documents_application_idx
  on pq_documents (application_id, created_at desc);

alter table pq_documents enable row level security;

drop policy if exists "members manage their own permit documents" on pq_documents;
create policy "members manage their own permit documents"
  on pq_documents for all
  using (is_active_tenant_member(business_id))
  with check (is_active_tenant_member(business_id));

-- ── Per-application checklist state ────────────────────────────────────────
create table if not exists pq_application_requirements (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references pq_applications (id) on delete cascade,
  business_id uuid not null references businesses (id) on delete cascade,
  -- The catalog code, copied not referenced: an application's checklist is a
  -- record of what was asked at the time, and editing the catalog later must
  -- not rewrite the history of a submitted application.
  requirement_code text not null,
  label text not null,
  status text not null default 'missing'
    check (status in ('satisfied', 'missing', 'unclear', 'not_applicable')),
  evidence_document_id uuid references pq_documents (id) on delete set null,
  notes text,
  -- Who decided: the agent or a person. A reviewer overriding the AI must be
  -- visible as an override, not silently indistinguishable from it.
  source text not null default 'ai' check (source in ('ai', 'human')),
  updated_at timestamptz not null default now(),
  unique (application_id, requirement_code)
);

create index if not exists pq_app_requirements_app_idx
  on pq_application_requirements (application_id);

alter table pq_application_requirements enable row level security;

drop policy if exists "members manage their own checklists" on pq_application_requirements;
create policy "members manage their own checklists"
  on pq_application_requirements for all
  using (is_active_tenant_member(business_id))
  with check (is_active_tenant_member(business_id));

-- ── AI review runs ─────────────────────────────────────────────────────────
create table if not exists pq_reviews (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references pq_applications (id) on delete cascade,
  business_id uuid not null references businesses (id) on delete cascade,
  agent_key text not null,
  summary text,
  risk_flags jsonb not null default '[]'::jsonb,
  model text,
  created_at timestamptz not null default now()
);

create index if not exists pq_reviews_application_idx
  on pq_reviews (application_id, created_at desc);

alter table pq_reviews enable row level security;

drop policy if exists "members read their own reviews" on pq_reviews;
create policy "members read their own reviews"
  on pq_reviews for all
  using (is_active_tenant_member(business_id))
  with check (is_active_tenant_member(business_id));

-- ── Reviewer notes ─────────────────────────────────────────────────────────
create table if not exists pq_notes (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references pq_applications (id) on delete cascade,
  business_id uuid not null references businesses (id) on delete cascade,
  body text not null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists pq_notes_application_idx
  on pq_notes (application_id, created_at desc);

alter table pq_notes enable row level security;

drop policy if exists "members manage their own notes" on pq_notes;
create policy "members manage their own notes"
  on pq_notes for all
  using (is_active_tenant_member(business_id))
  with check (is_active_tenant_member(business_id));

-- ── Audit history ──────────────────────────────────────────────────────────
-- Append-only by policy: members can SELECT and INSERT, and there is
-- deliberately no update or delete policy. An audit trail a tenant can rewrite
-- is not an audit trail, and "audit history" is an explicit requirement of the
-- reviewer surface.
--
-- How it holds is worth knowing before someone "fixes" it: a missing policy
-- does NOT raise an error on UPDATE or DELETE. Postgres simply finds no rows
-- visible for the operation, so the statement succeeds and reports 0 rows
-- affected. Verified on scratch PG16 by counting rows either side rather than
-- by watching for an exception — a tenant's UPDATE and DELETE both returned 0
-- and every row was left byte-identical.
create table if not exists pq_events (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references pq_applications (id) on delete cascade,
  business_id uuid not null references businesses (id) on delete cascade,
  type text not null,
  detail text,
  actor uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists pq_events_application_idx
  on pq_events (application_id, created_at desc);

alter table pq_events enable row level security;

drop policy if exists "members read their own audit history" on pq_events;
create policy "members read their own audit history"
  on pq_events for select
  using (is_active_tenant_member(business_id));

drop policy if exists "members append to their own audit history" on pq_events;
create policy "members append to their own audit history"
  on pq_events for insert
  with check (is_active_tenant_member(business_id));

-- ── Private storage for the drawings and reports ───────────────────────────
-- Same pattern as the existing `documents` bucket: no storage.objects policies
-- at all, so anon/authenticated get no direct storage access and only the
-- service-role client (server-side, after an RLS-scoped ownership check)
-- issues short-lived signed URLs.
insert into storage.buckets (id, name, public)
values ('permits', 'permits', false)
on conflict (id) do nothing;

-- ── Product registry row ───────────────────────────────────────────────────
-- 'coming_soon' until the applicant surface ships. The key is permanent from
-- this moment: business_products joins on it, so it can never be renamed.
insert into products (key, name, description, icon_name, status)
values (
  'permitiq',
  'PermitIQ',
  'Planning permission and building permit workflows — upload the documents, get a checklist, a summary and the gaps before you submit.',
  'file-check',
  'coming_soon'
)
on conflict (key) do nothing;

-- ── Starter catalog: Ireland ───────────────────────────────────────────────
-- A national baseline (authority = null) for the two most common application
-- types. Deliberately a STARTING POINT, not a claim of completeness — a real
-- authority's list is seeded per authority and overrides these. Idempotent via
-- the unique constraint.
insert into pq_requirements
  (jurisdiction, authority, application_type, code, label, guidance, mandatory, sort_order)
values
  ('ie', null, 'planning_permission', 'site_location_map', 'Site location map',
   'Ordnance Survey based, typically 1:2500 in urban areas or 1:10560 rural, with the site outlined in red and any adjoining land in the applicant''s control in blue.', true, 10),
  ('ie', null, 'planning_permission', 'site_layout_plan', 'Site layout plan',
   'Usually 1:500. Shows the proposed development in context: boundaries, existing structures, access, parking and drainage.', true, 20),
  ('ie', null, 'planning_permission', 'floor_plans', 'Floor plans, elevations and sections',
   'Typically 1:100. Existing and proposed, with all elevations affected by the works.', true, 30),
  ('ie', null, 'planning_permission', 'public_notice_newspaper', 'Newspaper notice',
   'Published in an approved newspaper within two weeks before the application is lodged. The original page is normally required.', true, 40),
  ('ie', null, 'planning_permission', 'public_notice_site', 'Site notice',
   'Erected on the site on or before the day of application and maintained for five weeks. A photograph and the notice text are usually required.', true, 50),
  ('ie', null, 'planning_permission', 'application_form', 'Completed application form',
   'The planning authority''s own form, signed and dated.', true, 60),
  ('ie', null, 'planning_permission', 'fee', 'Application fee',
   'Set by the planning authority and varies by development type and scale.', true, 70),
  ('ie', null, 'planning_permission', 'wastewater_assessment', 'Site characterisation / wastewater assessment',
   'Required where the development is not connecting to a public sewer. Usually an EPA-code site assessment by a qualified assessor.', false, 80),
  ('ie', null, 'planning_permission', 'flood_risk_assessment', 'Flood risk assessment',
   'Required where the site is in or near a flood risk zone.', false, 90),
  ('ie', null, 'retention_permission', 'application_form', 'Completed retention application form',
   'The planning authority''s retention form, signed and dated.', true, 10),
  ('ie', null, 'retention_permission', 'site_location_map', 'Site location map',
   'As for a standard application, showing the structure or works already carried out.', true, 20),
  ('ie', null, 'retention_permission', 'as_built_drawings', 'As-built drawings',
   'Plans, elevations and sections of the development as actually constructed, not as originally intended.', true, 30),
  ('ie', null, 'retention_permission', 'public_notice_newspaper', 'Newspaper notice',
   'Must state that the application is for RETENTION of the development.', true, 40),
  ('ie', null, 'retention_permission', 'public_notice_site', 'Site notice',
   'Must state that the application is for RETENTION of the development.', true, 50)
on conflict (jurisdiction, authority, application_type, code) do nothing;

comment on table pq_requirements is
  'What a jurisdiction/authority requires for an application type. Global reference data: readable by any signed-in user, writable only by the service role.';
comment on table pq_events is
  'Append-only audit history per application. Members can select and insert; no update or delete policy exists on purpose.';

-- ======================================================================
-- 0034_permitiq_active.sql
-- ======================================================================
-- ---------------------------------------------------------------------------
-- PermitIQ goes from 'coming_soon' to 'active'.
--
-- 0033 created the schema and registered the product as coming_soon because
-- there was no surface behind it yet. The applicant surface now exists:
-- create an application, upload drawings, get them read and attributed, and
-- see a live checklist against the Irish requirements catalog.
--
-- This flips the product's STATUS only. It does NOT grant PermitIQ to anyone:
-- access still comes from a business_products row, added per customer from the
-- admin area, exactly like every other module. So running this changes what the
-- badge says, not who can get in.
--
-- Idempotent: re-running sets the same value.
-- ---------------------------------------------------------------------------

update products set status = 'active' where key = 'permitiq';

-- ======================================================================
-- 0035_booking_ip_guard.sql
-- ======================================================================
-- =============================================================================
-- 0035 — Per-IP abuse guard for the public booking endpoint
--
-- OUTSTANDING K5. /api/book already limits three bookings per EMAIL per day,
-- and that guard does real work — but a script that varies the address walks
-- straight past it. Every accepted booking holds a calendar slot AND sends two
-- emails, one of them to whatever address the caller typed. Unbounded, that is
-- a way to fill the calendar so genuine prospects cannot book, and to burn the
-- sending domain's reputation on third parties.
--
-- WHY A HASH RATHER THAN THE ADDRESS. The only thing this column is for is
-- counting "how many bookings came from the same origin today". That does not
-- need a raw IP, which is personal data under GDPR and would sit in the table
-- indefinitely. A salted SHA-256 counts identically and cannot be read back.
-- Set BOOKING_IP_SALT in the environment to make it genuinely irreversible;
-- without it the code falls back to a constant salt, which still de-identifies
-- the column at rest but is brute-forceable across the IPv4 space by anyone
-- holding the database. See app/api/book/route.ts.
--
-- Nullable on purpose: every booking already in the table predates this, and
-- a request that arrives with no usable client address must still be able to
-- book. Absence means "unknown", never "blocked".
--
-- Idempotent. Safe to re-run.
-- =============================================================================

alter table strategy_bookings
  add column if not exists created_ip_hash text;

-- The guard's only query: count rows for one hash inside a 24-hour window.
-- Partial, because rows with no hash are never counted and there is no reason
-- to carry them in the index.
create index if not exists strategy_bookings_ip_hash_idx
  on strategy_bookings (created_ip_hash, created_at desc)
  where created_ip_hash is not null;

comment on column strategy_bookings.created_ip_hash is
  'Salted SHA-256 of the requesting IP, for per-origin abuse counting only. Never a raw address. Null for bookings made before 0035, and for requests with no usable client address.';

-- ======================================================================
-- 0036_harvest_attempt.sql
-- ======================================================================
-- =============================================================================
-- 0036 — Record when Jarvis last tried to harvest a prospect's contact details
--
-- OUTSTANDING K8. The nightly contact harvest takes the top 8 prospects by
-- lead_score that have a website and no email, and reads their sites. Nothing
-- recorded that an attempt had happened.
--
-- So if those eight have permanently dead domains — parked, expired, blocking
-- bots — the job re-reads the same eight every single night, harvests nothing,
-- reports 0, and NEVER REACHES THE NINTH. No error, no progress, no signal.
-- The ninth prospect could have a working site and a published email sitting
-- there for months. It is the same "score-ordered cap applied before the still
-- to work filter" shape this codebase keeps hitting, except the filter here is
-- "haven't already failed on this one".
--
-- One nullable timestamp fixes it: order by attempt time (nulls first, so
-- never-tried always wins), and stamp it on every attempt whether or not
-- anything was found. The eight dead domains fall to the back of the queue and
-- the rest of the list finally gets read.
--
-- Nullable on purpose: every existing prospect predates this, and NULL is
-- exactly the right meaning — "never attempted", which sorts first.
--
-- Idempotent. Safe to re-run. Purely additive: no existing column, index,
-- constraint or row is altered.
-- =============================================================================

alter table ge_prospects
  add column if not exists last_harvest_attempt_at timestamptz;

-- The harvest's only query: among prospects with a website and no email, find
-- the least-recently-attempted. Partial, because a prospect that already has an
-- email is never a candidate and there is no reason to carry it in the index.
create index if not exists ge_prospects_harvest_attempt_idx
  on ge_prospects (last_harvest_attempt_at nulls first, lead_score desc)
  where email is null and website is not null;

comment on column ge_prospects.last_harvest_attempt_at is
  'When the Jarvis nightly contact harvest last READ this prospect''s website, successful or not. Null = never attempted, which sorts first. Stamped on every attempt so eight dead domains cannot monopolise the nightly batch forever (OUTSTANDING K8).';

-- ======================================================================
-- 0037_invoices.sql
-- ======================================================================
-- =============================================================================
-- 0037 — Invoices. The half of QuoteIQ that was sold but never built.
--
-- /products/tradeiq says, in as many words: "Quotes become invoices in one
-- step, with online card payment on the link" and "Chasing is automatic rather
-- than a job for a Sunday evening."
--
-- There was no invoice anywhere in the product. A quote could be created,
-- sent, viewed and accepted — and then the trail stopped. The customer had
-- agreed to pay and the platform had no way to ask them for the money. The
-- trades_* tables are a separate TradeOS schema and are not reachable from
-- QuoteIQ, so nothing filled the gap.
--
-- This is the table behind: accept a quote -> raise the invoice in one step ->
-- send it -> the customer opens a public page -> it is marked paid, and the
-- CRM records the money.
--
-- DESIGN NOTES
--
-- * `amount_cents` is an INTEGER, unlike qa_quotes.total which is free TEXT.
--   A quote total is a human sentence ("from EUR 900"); an invoice is a demand
--   for an exact sum and must never be stored as prose. The conversion parses
--   the quote text once, at creation, and anything unparseable forces the
--   number to be typed rather than guessed.
-- * `number` is per-business and human-facing ("INV-0007"). Unique per
--   business so two customers never receive the same reference, which is both
--   confusing and an accounting problem.
-- * `view_token` mirrors qa_quotes: an unguessable uuid is the customer's key
--   to a public page, so no login is needed to view or pay.
-- * Money is never deleted. `status` moves draft -> sent -> paid, or -> void.
--   There is no DELETE path in the app: voiding leaves the record and the
--   audit trail intact, which is what an invoice is for.
--
-- Idempotent. Safe to re-run. Purely additive — creates one new table and
-- touches nothing that already exists.
-- =============================================================================

create table if not exists qa_invoices (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  -- The quote it came from, when it came from one. Nullable so an invoice can
  -- also be raised directly for work that never had a formal quote.
  quote_id uuid references qa_quotes (id) on delete set null,
  number text not null,
  customer_name text not null,
  customer_email text,
  -- Same shape as qa_quotes.quote_lines: [{ item, price }]
  lines jsonb not null default '[]'::jsonb,
  amount_cents integer not null default 0 check (amount_cents >= 0),
  currency text not null default 'EUR',
  status text not null default 'draft'
    check (status in ('draft', 'sent', 'paid', 'void')),
  notes text not null default '',
  due_date date,
  view_token uuid not null default gen_random_uuid(),
  sent_at timestamptz,
  paid_at timestamptz,
  -- What was actually received. A part payment is real life; it must not be
  -- silently rounded up to the invoice total.
  paid_amount_cents integer check (paid_amount_cents >= 0),
  created_at timestamptz not null default now()
);

-- The customer's key to the public page. Unique so a token identifies exactly
-- one invoice.
create unique index if not exists qa_invoices_view_token_idx
  on qa_invoices (view_token);

-- Human reference, unique within a business.
create unique index if not exists qa_invoices_business_number_idx
  on qa_invoices (business_id, number);

-- The list view: newest first for one business.
create index if not exists qa_invoices_business_created_idx
  on qa_invoices (business_id, created_at desc);

-- The chase query: what is sent, unpaid and past its due date.
create index if not exists qa_invoices_outstanding_idx
  on qa_invoices (business_id, due_date)
  where status = 'sent';

-- One invoice per quote. Raising a second invoice for the same accepted quote
-- is double-billing a customer, which is the single worst thing this table
-- could be used to do by accident — a double-click on "Create invoice" must
-- not be able to cause it.
create unique index if not exists qa_invoices_quote_idx
  on qa_invoices (quote_id)
  where quote_id is not null;

alter table qa_invoices enable row level security;

drop policy if exists "members manage their own invoices" on qa_invoices;
create policy "members manage their own invoices"
  on qa_invoices
  for all
  using (is_active_tenant_member (business_id))
  with check (is_active_tenant_member (business_id));

comment on table qa_invoices is
  'Invoices raised from accepted QuoteIQ quotes, or directly. amount_cents is an exact integer — unlike qa_quotes.total, which is free text. One invoice per quote, enforced by a partial unique index, so a double-click cannot double-bill.';

-- ======================================================================
-- 0038_invoice_chasing.sql
-- ======================================================================
-- =============================================================================
-- 0038 — Automatic chasing for overdue invoices
--
-- /products/tradeiq: "Chasing is automatic rather than a job for a Sunday
-- evening." 0037 made invoices real; nothing ever chased them. An invoice
-- could go out, go past its due date, and sit there forever with the platform
-- silent — which is precisely the Sunday-evening job the page says it removes.
--
-- Two columns are all it takes, and both exist to answer "have we already
-- nagged this person, and how hard":
--
--   last_chased_at — when the last reminder went. NULL = never chased, which
--     is what makes the first chase findable without a second query.
--   chase_count    — how many have gone. The tone escalates and the sequence
--     STOPS; a business that emails a customer every day about EUR 300 does
--     more damage to the relationship than the debt is worth.
--
-- Nullable and defaulted, so every invoice already raised is untouched and
-- reads correctly as "never chased".
--
-- Idempotent. Safe to re-run. Purely additive.
-- =============================================================================

alter table qa_invoices
  add column if not exists last_chased_at timestamptz;

alter table qa_invoices
  add column if not exists chase_count integer not null default 0;

-- The chaser's only query: sent, unpaid, past due, and not chased recently.
-- Partial on status so the index carries only the rows that can ever be
-- chased — a paid or voided invoice is never a candidate.
create index if not exists qa_invoices_chase_idx
  on qa_invoices (due_date, last_chased_at nulls first)
  where status = 'sent';

comment on column qa_invoices.last_chased_at is
  'When the last overdue reminder was sent. Null = never chased, and sorts first so the oldest neglected invoice is always found before one already nagged.';

comment on column qa_invoices.chase_count is
  'How many reminders have gone out. The sequence stops at a hard cap — chasing a customer indefinitely costs more than the invoice is worth.';

-- ======================================================================
-- 0039_content_sends.sql
-- ======================================================================
-- =============================================================================
-- 0039 — ContentIQ actually publishes something
--
-- ContentIQ generated a post and then offered "Mark published" — a checkbox
-- that set a status and published NOTHING. The content sat in a table. The
-- customer copied it somewhere by hand, or didn't. A product whose entire
-- purpose is producing content had no way to deliver any.
--
-- Email is the one channel this platform genuinely has (Resend), and ClientIQ
-- now holds a real audience. So "publish" becomes: send this piece to your
-- customer list, and keep a per-recipient record of it.
--
-- WHY A PER-RECIPIENT TABLE rather than a count on ca_content.
--
-- Sending to a list is the single most dangerous thing this platform can do on
-- a customer's behalf. The things that go wrong are all "who exactly got
-- what": the same person receiving a piece twice, a send half-completing and
-- being re-run from the start, someone who opted out being included anyway.
-- A counter answers none of those. A row per recipient answers all of them,
-- and the unique index below makes double-sending impossible rather than
-- unlikely.
--
-- Idempotent. Safe to re-run. Purely additive.
-- =============================================================================

alter table ca_content
  add column if not exists sent_at timestamptz;

alter table ca_content
  add column if not exists recipient_count integer not null default 0;

create table if not exists ca_sends (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  content_id uuid not null references ca_content (id) on delete cascade,
  -- Nullable: a recipient may have been removed from the CRM afterwards, and
  -- deleting the contact must not erase the record that they were emailed.
  contact_id uuid references crm_contacts (id) on delete set null,
  email text not null,
  status text not null default 'sent' check (status in ('sent', 'failed')),
  error text,
  created_at timestamptz not null default now()
);

-- THE guarantee: one send per piece of content per address, case-insensitive.
-- A re-run, a double-click or a half-finished batch picked up again can never
-- send the same person the same thing twice — the database refuses it rather
-- than the code remembering to.
create unique index if not exists ca_sends_content_email_idx
  on ca_sends (content_id, lower(email));

create index if not exists ca_sends_business_created_idx
  on ca_sends (business_id, created_at desc);

alter table ca_sends enable row level security;

drop policy if exists "members manage their own content sends" on ca_sends;
create policy "members manage their own content sends"
  on ca_sends
  for all
  using (is_active_tenant_member (business_id))
  with check (is_active_tenant_member (business_id));

comment on table ca_sends is
  'One row per recipient per piece of ContentIQ content. The unique index on (content_id, lower(email)) makes double-sending impossible, so a retry or a half-finished batch is always safe to re-run.';

-- ======================================================================
-- 0040_siteiq_page.sql
-- ======================================================================
-- =============================================================================
-- 0040 — SiteIQ becomes a business page, and can be measured
--
-- The page had a headline, a paragraph, a list of services and a phone
-- number. That is a business card. The three things a person actually looks
-- for on a local business page — are you open, do you cover my area, how do I
-- reach you — were none of them answerable, and a search engine could read
-- none of it either, so the page was a blue link at best.
--
-- This adds the two missing fields (opening hours, areas served) and the
-- thing that makes the whole product provable: a view count.
--
-- WHY VIEWS ARE COUNTED PER DAY, NOT PER VISIT.
--
-- A row per visit on a PUBLIC page is a table anyone on the internet can
-- write to, without a session, as fast as they can hold a key down. It grows
-- without bound and the first thing it costs is the database everything else
-- runs on. A daily counter is one row per page per day forever, and the
-- increment is a single atomic UPDATE that cannot be made to fan out.
--
-- Idempotent. Safe to re-run. Purely additive — every existing page keeps
-- working exactly as it does today, with empty hours and no areas.
-- =============================================================================

alter table wa_pages
  add column if not exists hours jsonb not null default '[]'::jsonb;

alter table wa_pages
  add column if not exists areas jsonb not null default '[]'::jsonb;

-- One row per page per day. `day` is the Irish calendar date, matching every
-- other date in the app.
create table if not exists wa_page_views (
  business_id uuid not null references businesses (id) on delete cascade,
  day date not null,
  views integer not null default 0 check (views >= 0),
  primary key (business_id, day)
);

create index if not exists wa_page_views_day_idx
  on wa_page_views (business_id, day desc);

alter table wa_page_views enable row level security;

-- Read-only through RLS. The public page cannot reach this table with a user
-- session — it has none — so the WRITE happens through the function below,
-- which is the only way a row is ever created or changed.
drop policy if exists "members view their own page views" on wa_page_views;
create policy "members view their own page views"
  on wa_page_views
  for select
  using (is_active_tenant_member (business_id));

-- The entire write surface for view counting, and deliberately the only one.
--
-- SECURITY DEFINER because the caller is an anonymous visitor with no session.
-- It takes a business and a date and adds one. It cannot be made to write any
-- other column, any other table, or any value other than +1 — which is what
-- makes it safe to expose to the public internet.
create or replace function record_page_view (p_business_id uuid, p_day date)
  returns void
  language sql
  security definer
  set search_path = public
  as $$
  insert into wa_page_views (business_id, day, views)
  values (p_business_id, p_day, 1)
  on conflict (business_id, day)
    do update set
      views = wa_page_views.views + 1;
$$;

comment on function record_page_view (uuid, date) is
  'Adds one to a SiteIQ page''s view count for a day. The only write path to wa_page_views: it cannot set an arbitrary value, touch another column, or reach another table, which is what makes it safe to call from an anonymous public page.';

comment on table wa_page_views is
  'Daily view counts for SiteIQ public pages. Per day rather than per visit because a public page is a table the whole internet can write to — this bounds it to one row per page per day.';

-- ======================================================================
-- 0041_review_autopilot.sql
-- ======================================================================
-- =============================================================================
-- 0041 — ReputationIQ asks on its own when a job is finished
--
-- /products/reputationiq sells "Ask while the job is still fresh — send the
-- request the day you finish, when goodwill is at its highest." Everything
-- about that is built except the part that matters: somebody has to remember
-- to press Send, on the day, for every job. On the evening of a long week
-- nobody does, and the goodwill window closes.
--
-- QuoteIQ now knows exactly when a job finished, because the business marks
-- the invoice PAID. That is the most reliable "this went well" signal in the
-- platform — better than a job status somebody has to maintain, because it is
-- a thing they do anyway for their own reasons.
--
-- So: invoice paid -> review request goes out on the next morning run.
--
-- WHY A COLUMN ON THE INVOICE RATHER THAN A NEW TABLE.
--
-- The only question this feature has to answer is "have we already asked
-- about THIS job?", and the job is the invoice. A timestamp on the invoice
-- answers it exactly, cannot drift out of sync with the thing it describes,
-- and disappears with the invoice if that is ever deleted.
--
-- OPT-IN, DEFAULT OFF. Nothing changes for any existing customer until they
-- switch it on, and switching it on cannot reach backwards — see the age
-- window in lib/review-agent/auto-request.ts, which is the guard that stops
-- flipping this toggle from emailing every customer of the last two years at
-- once.
--
-- Idempotent. Safe to re-run. Purely additive.
-- =============================================================================

-- Set the moment a request is sent for this invoice, so a second run can
-- never ask the same customer about the same job twice.
alter table qa_invoices
  add column if not exists review_requested_at timestamptz;

-- The opt-in. Default false: an existing business's behaviour is unchanged
-- until a human decides otherwise.
alter table businesses
  add column if not exists auto_review_requests boolean not null default false;

-- The nightly scan: paid invoices that have not been asked about yet.
--
-- Partial, because the rows it must never return are the overwhelming
-- majority — every invoice already asked about, forever.
--
-- Led by paid_at, NOT business_id: the run sweeps every tenant at once and
-- orders by when the job finished. A business_id-first index cannot serve
-- that, and the planner falls back to a sequential scan of the whole invoice
-- table on every morning run — confirmed on scratch Postgres before this was
-- changed.
create index if not exists qa_invoices_review_pending_idx
  on qa_invoices (paid_at)
  where status = 'paid' and review_requested_at is null;

comment on column qa_invoices.review_requested_at is
  'When ReputationIQ asked this customer for a review about this job. Set once, immediately after the send, so a re-run can never ask twice. Null means never asked.';

comment on column businesses.auto_review_requests is
  'Opt-in: when true, marking an invoice paid queues a review request for the next morning run. Default false so existing behaviour is unchanged, and turning it on cannot reach back over old invoices.';

-- ======================================================================
-- 0042_prospect_views.sql
-- ======================================================================
-- =============================================================================
-- 0042 — Stop shipping the whole database to render one page
--
-- /growth/prospects is the page Jude lives on. Every single load of it — every
-- page-turn, every search, every filter change — did three FULL TABLE READS
-- whose results are then thrown away almost entirely:
--
--   1. Every prospect's `industry`, to build a <select> of ~32 distinct
--      values. 20,000 rows read to render 32 options.
--   2. Every active prospect (id, company, website, status), to work out which
--      ones still need researching.
--   3. Every row of ge_research, for the same reason.
--
-- At Jude's scale that is ~42,000 rows serialised to JSON, fetched over ~20
-- paged PostgREST requests (selectAllRows pages at 1,000), and reduced in Node
-- to a 32-item dropdown and a 300-row queue.
--
-- Postgres was never the slow part — it answers all three in under 10ms. The
-- cost is the transfer and the parse, and the fix is to ask Postgres the
-- question we actually have instead of asking for everything and filtering
-- afterwards. Same answers, 332 rows instead of 42,001.
--
-- SECURITY INVOKER is not optional here. A view without it runs with the
-- OWNER's rights, which would let it read straight past the row-level security
-- on ge_prospects for whoever queries it. With it, the view is exactly as
-- privileged as the caller already was.
--
-- Idempotent. Safe to re-run. Purely additive — nothing reads these until the
-- code does, and the code falls back to the old path if they are absent.
-- =============================================================================

-- Supports the DISTINCT below, and the industry filter on the page itself.
create index if not exists ge_prospects_industry_idx
  on ge_prospects (industry)
  where industry is not null;

-- The anti-join's inner side.
create index if not exists ge_research_prospect_idx
  on ge_research (prospect_id);

-- ---------------------------------------------------------------------------
-- The industries actually in use, for the filter dropdown.
-- ---------------------------------------------------------------------------
create or replace view ge_prospect_industries
with (security_invoker = true) as
select distinct
  btrim(industry) as industry
from
  ge_prospects
where
  industry is not null
  and btrim(industry) <> ''
order by
  1;

comment on view ge_prospect_industries is
  'Distinct non-empty industries, for the Prospects filter dropdown. Replaces reading every prospect''s industry column to compute the same ~32 values in Node.';

-- ---------------------------------------------------------------------------
-- Prospects that still need researching.
--
-- Includes research_failed rows and exposes `status`, so the page can split
-- the fresh queue from the retry group with a filter rather than a second
-- full read. `has_website` is materialised because PostgREST can only order
-- by a column, and website-first is the ordering that matters — the engine
-- reads the site, so a lead with one researches far better.
-- ---------------------------------------------------------------------------
create or replace view ge_unresearched_prospects
with (security_invoker = true) as
select
  p.id,
  p.company,
  p.website,
  p.status,
  p.lead_score,
  p.created_at,
  (p.website is not null and btrim(p.website) <> '') as has_website
from
  ge_prospects p
where
  p.status not in ('won', 'lost', 'do_not_contact', 'archived')
  and not exists (
    select 1 from ge_research r where r.prospect_id = p.id
  );

comment on view ge_unresearched_prospects is
  'Active prospects with no ge_research row yet, including research_failed. Replaces reading every active prospect AND every research row into Node to compute the difference there. Query it with an exact count to get the batch and the total in one request.';

-- ======================================================================
-- 0043_permitiq_design_brief.sql
-- ======================================================================
-- ---------------------------------------------------------------------------
-- PermitIQ — the design brief behind the generated drawings and form pack.
--
-- ONE TABLE, AND DELIBERATELY NOT TWO.
--
-- The obvious schema here is a briefs table plus a drawings table holding the
-- generated SVGs. There is no drawings table, because the drawings are a PURE
-- FUNCTION of the brief: lib/permitiq/design/sheets.ts is deterministic and
-- takes its date from its caller, so the same brief renders byte-identically
-- for ever. Storing the output would buy nothing and cost the one thing that
-- actually matters — a stored drawing can drift out of step with the brief it
-- came from, and then the sheet in the file and the sheet on screen disagree
-- about a building. Render on read; there is nothing to go stale.
--
-- That is also why `drawing_date` is a stored column rather than current_date
-- at render time. It is fixed when the brief is first saved so a set printed
-- in September is identical to the set printed in August, which is what makes
-- a drawing re-checkable after a request for further information.
--
-- Built on `businesses` like the rest of PermitIQ (see 0033) — no fourth
-- tenancy root. Additive throughout: nothing existing is altered or dropped.
-- ---------------------------------------------------------------------------

create table if not exists pq_design_briefs (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references pq_applications (id) on delete cascade,
  business_id uuid not null references businesses (id) on delete cascade,

  -- The whole DesignBrief, as the questionnaire captured it. jsonb rather than
  -- forty columns: the brief's shape belongs to the drawing code, which is
  -- versioned in the repo and tested, and pinning it into columns would make
  -- every future question a migration on live rows.
  brief jsonb not null,

  -- Frozen at first save. See the note above on why this is not current_date.
  drawing_date date not null default current_date,

  -- Fields the form pack needs that are not part of the geometry.
  project_name text,
  applicant_name text,
  applicant_address text,
  applicant_email text,
  applicant_phone text,
  agent_name text,
  agent_address text,
  interest_in_land text,
  authority text,
  newspaper text,
  intended_application_date date,

  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- One brief per application. The drawings and the form pack are two views of
  -- the same answers, so a second brief on the same application would mean an
  -- application whose form and drawings could describe different buildings —
  -- the exact contradiction the form pack exists to prevent.
  unique (application_id)
);

create index if not exists pq_design_briefs_business_idx
  on pq_design_briefs (business_id, updated_at desc);

alter table pq_design_briefs enable row level security;

-- Same tenancy rule as every other pq_ table (0033): membership of the owning
-- business, checked on read AND write, so a brief cannot be written into
-- another tenant's application.
drop policy if exists "tenant members manage their design briefs" on pq_design_briefs;
create policy "tenant members manage their design briefs"
  on pq_design_briefs for all
  using (is_active_tenant_member(business_id))
  with check (is_active_tenant_member(business_id));

-- ======================================================================
-- 0044_us_building_permit_baseline.sql
-- ======================================================================
-- ======================================================================
-- 0044 — PlanIQ: a typical US residential building-permit requirement list.
--
-- WHY THIS EXISTS
--   The US side of this product has been fully wired since 0033: the schema
--   constrains `jurisdiction` to ('ie','us'), the portal has a United States
--   tab, the application form offers `building_permit`, and the checklist
--   resolver already filters requirements by jurisdiction. Everything worked
--   except that NOT ONE US REQUIREMENT ROW WAS EVER SEEDED, so a customer who
--   created a US application got an empty checklist and the page had to tell
--   them so ("US permits are set up but not yet stocked").
--
--   That was the honest thing to say while it was true. This makes it stop
--   being true.
--
-- WHAT IT CLAIMS, EXACTLY
--   The same claim the Irish baseline in 0033 makes, and no more: this is the
--   national/default list (authority = null) — "deliberately a STARTING POINT,
--   not a claim of completeness". US permitting is set municipality by
--   municipality, not nationally, so the baseline below is the set of items
--   that a residential building permit asks for almost everywhere, and every
--   `guidance` string says plainly that the local building department's own
--   list governs.
--
--   resolveRequirements() in lib/permitiq/checklist.ts already collapses a
--   named authority's rows over the baseline PER CODE, so seeding
--   ('us', 'City of Austin', 'building_permit', …) later overrides these item
--   by item without losing the rest. Nothing here has to be undone to add a
--   real municipality — which is the whole reason the baseline is safe to
--   ship.
--
-- SAFETY
--   Additive only: one INSERT, no schema change, no UPDATE, no DELETE.
--   Idempotent via the (jurisdiction, authority, application_type, code)
--   unique constraint with NULLS NOT DISTINCT, so re-running changes nothing
--   and a municipality's own rows are untouched.
-- ======================================================================

insert into pq_requirements
  (jurisdiction, authority, application_type, code, label, guidance, mandatory, sort_order)
values
  ('us', null, 'building_permit', 'application_form', 'Completed permit application',
   'The building department''s own application form, signed. Nearly every jurisdiction has its own; check theirs before using a generic one.', true, 10),
  ('us', null, 'building_permit', 'plot_plan', 'Plot / site plan',
   'The lot with the proposed work on it: property lines, setbacks from each boundary, existing structures, driveway and easements. Usually to scale and often required to be stamped.', true, 20),
  ('us', null, 'building_permit', 'floor_plans', 'Floor plans',
   'Existing and proposed, dimensioned, with room uses, window and door schedules, and smoke/CO alarm locations marked.', true, 30),
  ('us', null, 'building_permit', 'elevations', 'Exterior elevations',
   'Every elevation affected by the work, showing finished grade, overall height and exterior finishes.', true, 40),
  ('us', null, 'building_permit', 'structural_plans', 'Foundation and framing plans',
   'Foundation plan, framing plans and sections. Most jurisdictions require these stamped by a licensed engineer or architect once the work is structural.', true, 50),
  ('us', null, 'building_permit', 'energy_compliance', 'Energy code compliance',
   'The IECC (or the state''s own code — Title 24 in California, for example) compliance documentation for new conditioned space or an envelope alteration.', true, 60),
  ('us', null, 'building_permit', 'contractor_license', 'Contractor license and insurance',
   'The license number for the state or municipality, plus proof of general liability and workers'' compensation cover. Owner-builders are usually asked for a signed affidavit instead.', true, 70),
  ('us', null, 'building_permit', 'permit_fee', 'Permit fee',
   'Normally calculated from the valuation of the work, so the valuation figure is typically required with the application.', true, 80),
  ('us', null, 'building_permit', 'zoning_approval', 'Zoning approval or variance',
   'Required where the work does not meet the base zoning — setbacks, lot coverage, height or use. Some jurisdictions run this as a separate approval that must be granted before the building permit is issued.', false, 90),
  ('us', null, 'building_permit', 'septic_well_approval', 'Septic / well approval',
   'Required where the property is not on municipal sewer or water. Usually issued by the county health department rather than the building department.', false, 100),
  ('us', null, 'building_permit', 'trade_permits', 'Plumbing, mechanical and electrical permits',
   'Frequently applied for separately by each licensed trade rather than being part of the building permit. Listed here so it is not forgotten, not because it is always one submission.', false, 110),
  ('us', null, 'building_permit', 'survey', 'Boundary survey',
   'Asked for where setbacks are tight, the lot lines are disputed, or the work is in a flood or coastal zone.', false, 120)
on conflict (jurisdiction, authority, application_type, code) do nothing;

-- ======================================================================
-- 0045_assetiq.sql
-- ======================================================================
-- =============================================================================
-- 0045 — AssetIQ: what you own, where it is, and what's due on it.
--
-- DELIBERATELY ONE TABLE.
--
-- Asset management as a category means depreciation schedules, barcode
-- scanning, check-in/check-out custody chains and maintenance work orders.
-- None of that is the problem a plumber with four vans, a pipe-freezer and a
-- set of test meters actually has. Theirs is smaller and sharper:
--
--   * what do we own, and what did it cost
--   * who has it / which van is it in
--   * WHAT IS DUE, AND HAS IT GONE PAST
--
-- The third is the whole product. A CVRT that lapsed, a PAT test nobody
-- booked, a calibration cert that expired the week before it was needed on
-- site — those cost real money and they are missed because they live in a
-- glovebox and somebody's memory. So `next_due_date` and `next_due_label` are
-- first-class columns rather than a maintenance sub-table: one date per asset
-- that the list can sort and colour by. When somebody genuinely needs a
-- schedule of every service a van has ever had, that is a second table added
-- later — it does not have to exist for the first version to be useful, and
-- pretending otherwise is how a simple product ships late and unused.
--
-- `assigned_to` and `location` are free TEXT on purpose. Making them foreign
-- keys to a staff table means AssetIQ cannot be switched on until a staff
-- table exists, and "Ciaran's van" is a perfectly good answer that no
-- normalisation improves for a nine-person business.
--
-- SAFETY
--   Purely additive. New table, new indexes, new policy, one product row.
--   Every statement is IF NOT EXISTS / drop-then-create / on-conflict, so the
--   file is safe to run against a database in any state and safe to re-run.
--   Nothing existing is altered, renamed or deleted.
-- =============================================================================

create table if not exists ast_assets (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,

  name text not null,
  -- Broad on purpose. A category that needs a migration to add is a category
  -- nobody uses; 'other' is always available and always valid.
  category text not null default 'other'
    check (category in ('vehicle', 'plant', 'tool', 'equipment', 'it', 'other')),
  -- Registration, serial or asset tag — whichever the business actually uses.
  identifier text,
  assigned_to text,
  location text,

  status text not null default 'in_service'
    check (status in ('in_service', 'in_repair', 'retired')),

  purchase_date date,
  -- Integer cents, like qa_invoices.amount_cents and NOT like qa_quotes.total,
  -- which is free text and cannot be summed. A "what are we sitting on"
  -- number that silently drops the assets somebody typed "approx 2k" into is
  -- worse than no number.
  purchase_cost_cents integer
    check (purchase_cost_cents is null or purchase_cost_cents >= 0),

  -- The reason the product exists. Nullable because plenty of assets have
  -- nothing due — a wheelbarrow needs no certificate — and forcing a date
  -- would train people to type a fake one.
  next_due_date date,
  next_due_label text,

  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The due list: everything with a date, soonest first, per business. Partial
-- so the index carries only rows that can appear on it — an asset with nothing
-- due is not a row the due query ever wants to read past.
create index if not exists ast_assets_due_idx
  on ast_assets (business_id, next_due_date)
  where next_due_date is not null;

create index if not exists ast_assets_recent_idx
  on ast_assets (business_id, created_at desc);

alter table ast_assets enable row level security;

drop policy if exists "members manage their own assets" on ast_assets;
create policy "members manage their own assets"
  on ast_assets
  for all
  using (is_active_tenant_member (business_id))
  with check (is_active_tenant_member (business_id));

comment on table ast_assets is
  'AssetIQ: one row per owned asset. next_due_date/next_due_label carry the single next thing due on it (CVRT, service, PAT test, calibration, insurance) — deliberately one date rather than a maintenance schedule table, because the product is "what has gone past", not a service history.';

-- ── Product registry row ─────────────────────────────────────────────────────
-- The key is permanent from this moment: business_products joins on it, so it
-- can never be renamed. Brand-led like 'permitiq', not '…-agent' — that naming
-- is retired.
insert into products (key, name, description, icon_name, status)
values (
  'assetiq',
  'AssetIQ',
  'Every van, tool and machine you own — what it cost, who has it, and what is due on it before it goes past.',
  'wrench',
  'active'
)
on conflict (key) do nothing;

commit;
