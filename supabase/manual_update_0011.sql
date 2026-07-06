-- =============================================================================
-- AutomateIQ manual update 0011 — Instagram DM Setter Agent
--
-- A specialist agent that engages Instagram DMs and books appointments, using
-- the SAME AI intelligence, business knowledge (aa_assistants), CRM and booking
-- system as the rest of the platform. This migration only adds the agent's own
-- storage + the product row; it reuses every existing table and policy.
--
-- Reuses the existing Supabase project + is_active_tenant_member() RLS helper.
-- Run in the Supabase SQL Editor. Fully idempotent. Additive only.
-- =============================================================================

-- Per-business connection + behaviour ---------------------------------------
create table if not exists ig_settings (
  business_id uuid primary key references businesses (id) on delete cascade,
  -- Instagram connection (filled once the business connects their account).
  ig_account_id text,          -- the IG account id messages are delivered to
  ig_username text,
  page_access_token text,      -- token used to send replies via the Graph API
  connected boolean not null default false,
  -- Behaviour
  auto_reply boolean not null default true,
  persona text not null default '',   -- extra voice/role guidance for the setter
  greeting text not null default '',   -- optional first-touch opener
  booking_link text not null default '', -- where the setter sends leads to book
  updated_at timestamptz not null default now()
);

-- One row per Instagram person the business is talking to --------------------
create table if not exists ig_conversations (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  ig_user_id text not null,    -- the lead's IG-scoped id (or a sim id)
  username text,
  status text not null default 'new'
    check (status in ('new', 'engaged', 'booked', 'closed')),
  last_message_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (business_id, ig_user_id)
);
create index if not exists ig_conversations_business_idx
  on ig_conversations (business_id, last_message_at desc);

-- Every message in both directions ------------------------------------------
create table if not exists ig_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references ig_conversations (id) on delete cascade,
  business_id uuid not null references businesses (id) on delete cascade,
  direction text not null check (direction in ('inbound', 'outbound')),
  -- inbound = from the lead; outbound sender: 'ai' (the setter) or 'human'.
  sender text not null default 'lead' check (sender in ('lead', 'ai', 'human')),
  text text not null,
  created_at timestamptz not null default now()
);
create index if not exists ig_messages_conversation_idx
  on ig_messages (conversation_id, created_at);

-- RLS: same tenant-isolation model as every other agent table. The webhook
-- and the AI Assistant tools run under the caller's tenant (or service role);
-- a business can only ever see its own Instagram data.
alter table ig_settings enable row level security;
drop policy if exists "members manage their own instagram settings" on ig_settings;
create policy "members manage their own instagram settings"
  on ig_settings for all
  using (is_active_tenant_member(business_id))
  with check (is_active_tenant_member(business_id));

alter table ig_conversations enable row level security;
drop policy if exists "members manage their own instagram conversations" on ig_conversations;
create policy "members manage their own instagram conversations"
  on ig_conversations for all
  using (is_active_tenant_member(business_id))
  with check (is_active_tenant_member(business_id));

alter table ig_messages enable row level security;
drop policy if exists "members manage their own instagram messages" on ig_messages;
create policy "members manage their own instagram messages"
  on ig_messages for all
  using (is_active_tenant_member(business_id))
  with check (is_active_tenant_member(business_id));

-- Register the product so it can be assigned in the admin console -----------
insert into products (key, name, description, icon_name, status)
values
  ('instagram-dm-setter', 'Instagram DM Setter',
   'Engages Instagram DMs, answers questions in your brand voice and books appointments — coordinated by your AI Assistant.',
   'instagram', 'active')
on conflict (key) do update set
  name = excluded.name,
  description = excluded.description,
  icon_name = excluded.icon_name,
  status = excluded.status;
