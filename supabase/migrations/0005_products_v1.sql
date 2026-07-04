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
