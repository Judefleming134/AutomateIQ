-- AutomateIQ Platform V1 — core schema
-- Shared-schema multi-tenancy: every tenant-scoped table carries business_id.
-- Naming convention: each product prefixes its own tables (e.g. ra_ for
-- Review Agent, wa_ for a future Website Agent) so N modules' worth of
-- tables stay untangled without needing separate Postgres schemas.

create extension if not exists "pgcrypto"; -- gen_random_uuid()

-- Tenant identity ------------------------------------------------------

create table businesses (
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
create table profiles (
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

create table products (
  id uuid primary key default gen_random_uuid(),
  key text unique not null, -- 'review-agent', 'website-agent', ...
  name text not null,
  description text,
  icon_name text,
  status text not null default 'coming_soon' check (status in ('active', 'coming_soon', 'framework')),
  created_at timestamptz not null default now()
);

create table business_products (
  business_id uuid not null references businesses (id) on delete cascade,
  product_id uuid not null references products (id) on delete cascade,
  enabled_at timestamptz not null default now(),
  primary key (business_id, product_id)
);

create table custom_modules (
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

create table admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users (id),
  action text not null,
  target_business_id uuid references businesses (id),
  metadata jsonb,
  created_at timestamptz not null default now()
);

-- Review Agent (ra_) ------------------------------------------------------

create table ra_customers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  name text not null,
  email text not null,
  created_at timestamptz not null default now()
);

create table ra_review_requests (
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
create index ra_review_requests_reminder_idx
  on ra_review_requests (status, reminder_sent_at, sent_at);
-- Tenant/admin list queries
create index ra_review_requests_business_idx on ra_review_requests (business_id);
-- Click-tracking redirect lookup
create unique index ra_review_requests_click_token_idx on ra_review_requests (click_token);
-- Duplicate-submit guard (recent requests for the same recipient)
create index ra_review_requests_customer_created_idx
  on ra_review_requests (ra_customer_id, created_at);
