-- =============================================================================
-- AutomateIQ manual update 0007 — four new agents
-- Content Agent, Instant Quote Agent, CRM Agent, Speed-to-Lead Agent
--
-- Run this whole file in the Supabase SQL Editor. Safe to run more than
-- once — everything is idempotent. (CRM Agent needs no tables of its own;
-- it reads ra_customers + wa_leads.)
-- =============================================================================

-- Content Agent (ca_) --------------------------------------------------------
create table if not exists ca_content (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  content_type text not null check (
    content_type in ('blog', 'social', 'email', 'ad', 'other')
  ),
  topic text not null,
  body text not null,
  created_at timestamptz not null default now()
);

create index if not exists ca_content_business_created_idx
  on ca_content (business_id, created_at desc);

alter table ca_content enable row level security;

drop policy if exists "members manage their own content" on ca_content;
create policy "members manage their own content"
  on ca_content for all
  using (is_active_tenant_member(business_id))
  with check (is_active_tenant_member(business_id));

-- Instant Quote Agent (qa_) ---------------------------------------------------
create table if not exists qa_settings (
  business_id uuid primary key references businesses (id) on delete cascade,
  price_guide text not null default '',
  updated_at timestamptz not null default now()
);

alter table qa_settings enable row level security;

drop policy if exists "members manage their own quote settings" on qa_settings;
create policy "members manage their own quote settings"
  on qa_settings for all
  using (is_active_tenant_member(business_id))
  with check (is_active_tenant_member(business_id));

create table if not exists qa_quotes (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  customer_name text not null,
  job_description text not null,
  quote_lines jsonb not null default '[]'::jsonb,
  total text not null default '',
  notes text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists qa_quotes_business_created_idx
  on qa_quotes (business_id, created_at desc);

alter table qa_quotes enable row level security;

drop policy if exists "members manage their own quotes" on qa_quotes;
create policy "members manage their own quotes"
  on qa_quotes for all
  using (is_active_tenant_member(business_id))
  with check (is_active_tenant_member(business_id));

-- Speed-to-Lead Agent (stl_) --------------------------------------------------
create table if not exists stl_settings (
  business_id uuid primary key references businesses (id) on delete cascade,
  enabled boolean not null default true,
  subject text not null default 'Thanks {{name}} — we''ve got your enquiry',
  reply_template text not null default
    'Hi {{name}},

Thanks for getting in touch with {{business}} — your message just landed with us and it''s already in front of the team.

We''ll come back to you personally as soon as possible, usually within the hour during working hours.

Talk soon,
{{business}}',
  updated_at timestamptz not null default now()
);

alter table stl_settings enable row level security;

drop policy if exists "members manage their own speed-to-lead settings" on stl_settings;
create policy "members manage their own speed-to-lead settings"
  on stl_settings for all
  using (is_active_tenant_member(business_id))
  with check (is_active_tenant_member(business_id));

create table if not exists stl_replies (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  lead_id uuid not null references wa_leads (id) on delete cascade,
  sent_to text not null,
  created_at timestamptz not null default now()
);

create index if not exists stl_replies_business_created_idx
  on stl_replies (business_id, created_at desc);

alter table stl_replies enable row level security;

-- Customers read their reply log; rows are written by the platform
-- (service role) at lead-capture time, so no insert policy is needed.
drop policy if exists "members read their own instant replies" on stl_replies;
create policy "members read their own instant replies"
  on stl_replies for select
  using (is_active_tenant_member(business_id));

-- Product rows (assignable in the admin console) ------------------------------
insert into products (key, name, description, icon_name, status)
values
  ('content-agent', 'Content Agent', 'AI-written blogs, social posts, emails and ad copy — on brand, on demand.', 'pen-line', 'active'),
  ('instant-quote-agent', 'Instant Quote Agent', 'Turns a job description into a priced, itemised quote in seconds.', 'calculator', 'active'),
  ('crm-agent', 'CRM Agent', 'Every customer and lead in one place, searchable and up to date.', 'contact', 'active'),
  ('speed-to-lead-agent', 'Speed-to-Lead Agent', 'Replies to every new lead in under 60 seconds, day or night.', 'zap', 'active')
on conflict (key) do update set
  name = excluded.name,
  description = excluded.description,
  icon_name = excluded.icon_name,
  status = excluded.status;
