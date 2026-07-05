-- =============================================================================
-- AutomateIQ manual update 0008 — agent depth upgrades
--
-- Turns the lightweight agents into complete, end-to-end business tools:
--   * Instant Quote Agent → quote-to-close lifecycle (send, view, accept)
--   (CRM / Content / Speed-to-Lead depth ships in later sections of this file)
--
-- Run in the Supabase SQL Editor after 0007. Fully idempotent.
-- Requires 0007 (qa_quotes) to have been run first.
-- =============================================================================

-- Instant Quote Agent — quote lifecycle -------------------------------------
alter table qa_quotes
  add column if not exists status text not null default 'draft';

do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'qa_quotes_status_check'
  ) then
    alter table qa_quotes add constraint qa_quotes_status_check
      check (status in ('draft', 'sent', 'viewed', 'accepted', 'declined'));
  end if;
end $$;

alter table qa_quotes add column if not exists customer_email text;
alter table qa_quotes add column if not exists view_token uuid not null default gen_random_uuid();
alter table qa_quotes add column if not exists sent_at timestamptz;
alter table qa_quotes add column if not exists viewed_at timestamptz;
alter table qa_quotes add column if not exists decided_at timestamptz;
alter table qa_quotes add column if not exists valid_until date;

create unique index if not exists qa_quotes_view_token_idx on qa_quotes (view_token);
create index if not exists qa_quotes_status_idx on qa_quotes (business_id, status);

-- CRM Agent — contacts, activity timeline, follow-up tasks -------------------
create table if not exists crm_contacts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  name text not null,
  email text,
  phone text,
  company text,
  stage text not null default 'new'
    check (stage in ('new', 'contacted', 'qualified', 'won', 'lost')),
  source text,
  value numeric,
  notes text not null default '',
  last_activity_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists crm_contacts_business_idx
  on crm_contacts (business_id, last_activity_at desc);
-- One contact per email per business (case-insensitive) so imports dedup.
create unique index if not exists crm_contacts_business_email_idx
  on crm_contacts (business_id, lower(email))
  where email is not null and email <> '';

alter table crm_contacts enable row level security;
drop policy if exists "members manage their own contacts" on crm_contacts;
create policy "members manage their own contacts"
  on crm_contacts for all
  using (is_active_tenant_member(business_id))
  with check (is_active_tenant_member(business_id));

create table if not exists crm_activities (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  contact_id uuid not null references crm_contacts (id) on delete cascade,
  type text not null default 'note',
  body text not null,
  created_at timestamptz not null default now()
);
create index if not exists crm_activities_contact_idx
  on crm_activities (contact_id, created_at desc);

alter table crm_activities enable row level security;
drop policy if exists "members manage their own crm activities" on crm_activities;
create policy "members manage their own crm activities"
  on crm_activities for all
  using (is_active_tenant_member(business_id))
  with check (is_active_tenant_member(business_id));

create table if not exists crm_tasks (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  contact_id uuid references crm_contacts (id) on delete set null,
  title text not null,
  due_date date,
  done boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists crm_tasks_business_idx
  on crm_tasks (business_id, done, due_date);

alter table crm_tasks enable row level security;
drop policy if exists "members manage their own crm tasks" on crm_tasks;
create policy "members manage their own crm tasks"
  on crm_tasks for all
  using (is_active_tenant_member(business_id))
  with check (is_active_tenant_member(business_id));

-- Content Agent — campaigns + editorial calendar ----------------------------
create table if not exists ca_campaigns (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  name text not null,
  goal text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists ca_campaigns_business_idx
  on ca_campaigns (business_id, created_at desc);

alter table ca_campaigns enable row level security;
drop policy if exists "members manage their own campaigns" on ca_campaigns;
create policy "members manage their own campaigns"
  on ca_campaigns for all
  using (is_active_tenant_member(business_id))
  with check (is_active_tenant_member(business_id));

-- Editorial workflow columns on the existing content table.
alter table ca_content add column if not exists status text not null default 'draft';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'ca_content_status_check') then
    alter table ca_content add constraint ca_content_status_check
      check (status in ('draft', 'scheduled', 'published'));
  end if;
end $$;
alter table ca_content add column if not exists scheduled_for date;
alter table ca_content add column if not exists published_at timestamptz;
alter table ca_content add column if not exists campaign_id uuid
  references ca_campaigns (id) on delete set null;
create index if not exists ca_content_schedule_idx
  on ca_content (business_id, status, scheduled_for);
