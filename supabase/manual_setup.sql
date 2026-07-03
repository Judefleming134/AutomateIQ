-- =============================================================================
-- AutomateIQ Platform — combined manual setup script
--
-- For running directly in the Supabase SQL Editor (Dashboard → SQL Editor)
-- on a brand-new project, as an alternative to `supabase db push` when the
-- Supabase CLI isn't available (e.g. working from a phone). This is the
-- exact content of supabase/migrations/0001-0004 plus supabase/seed.sql,
-- combined into one idempotent script, in the correct dependency order.
--
-- Safe to run more than once: tables/indexes use IF NOT EXISTS, functions
-- use CREATE OR REPLACE, policies are dropped-then-recreated, and the seed
-- data uses ON CONFLICT DO UPDATE. Run this as a single script (select all,
-- run once) — do not split it up, later sections depend on earlier ones.
--
-- After this succeeds, the only remaining setup step is bootstrapping the
-- first admin account via POST /api/setup/bootstrap-admin (see README.md).
-- =============================================================================

begin;

-- -----------------------------------------------------------------------
-- 0001: core schema
-- -----------------------------------------------------------------------

create extension if not exists "pgcrypto"; -- gen_random_uuid()

create table if not exists businesses (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  google_review_link text,
  logo_url text,
  email_signature text,
  status text not null default 'active' check (status in ('active', 'suspended')),
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role text not null default 'customer' check (role in ('admin', 'customer')),
  business_id uuid references businesses (id),
  created_at timestamptz not null default now()
);

create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  key text unique not null,
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

create table if not exists admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users (id),
  action text not null,
  target_business_id uuid references businesses (id),
  metadata jsonb,
  created_at timestamptz not null default now()
);

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

create index if not exists ra_review_requests_reminder_idx
  on ra_review_requests (status, reminder_sent_at, sent_at);
create index if not exists ra_review_requests_business_idx
  on ra_review_requests (business_id);
create unique index if not exists ra_review_requests_click_token_idx
  on ra_review_requests (click_token);
create index if not exists ra_review_requests_customer_created_idx
  on ra_review_requests (ra_customer_id, created_at);

-- -----------------------------------------------------------------------
-- 0002: auth trigger — creates a profiles row atomically whenever an
-- admin creates a new auth.users row (supabase.auth.admin.createUser /
-- inviteUserByEmail with role/business_id in user_metadata).
-- -----------------------------------------------------------------------

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
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- -----------------------------------------------------------------------
-- 0003: Row Level Security
-- -----------------------------------------------------------------------

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

alter table businesses enable row level security;

drop policy if exists "members can view their own business" on businesses;
create policy "members can view their own business"
  on businesses for select
  using (is_active_tenant_member(id));

drop policy if exists "members can update their own business" on businesses;
create policy "members can update their own business"
  on businesses for update
  using (is_active_tenant_member(id))
  with check (is_active_tenant_member(id));

alter table profiles enable row level security;

drop policy if exists "users can view their own profile" on profiles;
create policy "users can view their own profile"
  on profiles for select
  using (id = (select auth.uid()));

alter table products enable row level security;

drop policy if exists "authenticated users can view the product catalog" on products;
create policy "authenticated users can view the product catalog"
  on products for select
  to authenticated
  using (true);

alter table business_products enable row level security;

drop policy if exists "members can view their own enabled products" on business_products;
create policy "members can view their own enabled products"
  on business_products for select
  using (is_active_tenant_member(business_id));

alter table custom_modules enable row level security;

drop policy if exists "members can view their own custom modules" on custom_modules;
create policy "members can view their own custom modules"
  on custom_modules for select
  using (is_active_tenant_member(business_id));

alter table ra_customers enable row level security;

drop policy if exists "members can manage their own review-agent customers" on ra_customers;
create policy "members can manage their own review-agent customers"
  on ra_customers for all
  using (is_active_tenant_member(business_id))
  with check (is_active_tenant_member(business_id));

alter table ra_review_requests enable row level security;

drop policy if exists "members can manage their own review requests" on ra_review_requests;
create policy "members can manage their own review requests"
  on ra_review_requests for all
  using (is_active_tenant_member(business_id))
  with check (is_active_tenant_member(business_id));

-- No policies on admin_audit_log by design — RLS enabled with zero
-- policies denies all anon/authenticated access; only the service-role
-- client (used exclusively by requireAdmin()-gated /admin code) can read
-- or write it.
alter table admin_audit_log enable row level security;

-- -----------------------------------------------------------------------
-- 0004: atomic "claim before send" function for the reminder cron
-- -----------------------------------------------------------------------

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

revoke execute on function claim_due_reminders(int) from public;
grant execute on function claim_due_reminders(int) to service_role;

-- -----------------------------------------------------------------------
-- seed.sql: the four V1 products
-- -----------------------------------------------------------------------

insert into products (key, name, description, icon_name, status)
values
  ('review-agent', 'Review Agent', 'Automate review requests and follow-ups to grow your online reputation.', 'star', 'active'),
  ('website-agent', 'Website Agent', 'AI-powered websites that convert and engage.', 'globe', 'coming_soon'),
  ('ai-assistant', 'AI Assistant', 'A smart assistant that helps your business around the clock.', 'bot', 'coming_soon'),
  ('custom-solutions', 'Custom Solutions', 'Bespoke AI modules built specifically for your business.', 'box', 'framework')
on conflict (key) do update set
  name = excluded.name,
  description = excluded.description,
  icon_name = excluded.icon_name,
  status = excluded.status;

-- -----------------------------------------------------------------------
-- leads: the marketing site's "Request access" form (public/index.html's
-- #access section, via app/api/lead/route.ts). This table predates the
-- platform work and isn't part of migrations 0001-0004 — it was assumed
-- to already exist in whatever Supabase project api/lead.js originally
-- pointed at. On a brand-new project it needs to be created here, or the
-- public lead form will fail. Only ever written via the service-role
-- client (app/api/lead/route.ts uses its own service-role client, not the
-- anon key), so RLS is enabled with zero policies — same pattern as
-- admin_audit_log above.
-- -----------------------------------------------------------------------

create table if not exists leads (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  source text,
  created_at timestamptz not null default now()
);

alter table leads enable row level security;

commit;

-- Done. Verify with:
--   select key, name, status from products order by key;
-- should return the 4 rows above.
