-- =============================================================================
-- AutomateIQ manual update 0025 — In-dashboard binding order form
--
-- Run in the Supabase SQL Editor (after 0024). Fully idempotent — safe to
-- re-run. Identical to supabase/migrations/0025_order_forms.sql.
--
-- Creates order_forms: one row per business. The customer reviews their order
-- on the Billing page, fills their details, ticks agreement and types their
-- name; on save the app stamps agreed_at + agreed_name and the record locks
-- ("binding once filled and saved"). Customer-writable via RLS (their own
-- business only); the post-agreement lock is enforced in the server action.
-- =============================================================================

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
