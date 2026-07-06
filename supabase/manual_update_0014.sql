-- =============================================================================
-- AutomateIQ manual update 0014 — Growth Engine V2 (research → proposal workflow)
--
-- Run in the Supabase SQL Editor (after 0013). Fully idempotent — safe to
-- re-run. Identical to supabase/migrations/0014_growth_engine_v2.sql.
-- =============================================================================


-- Pipeline gains two stages: 'research_complete' (set automatically when the
-- AI research finishes) and 'proposal_sent'. Postgres check constraints can't
-- be altered in place, so drop + re-add with the expanded list.
alter table ge_prospects drop constraint if exists ge_prospects_status_check;
alter table ge_prospects add constraint ge_prospects_status_check
  check (status in ('new', 'researching', 'research_complete', 'contacted',
                    'replied', 'qualified', 'meeting_booked', 'proposal_sent',
                    'won', 'lost', 'do_not_contact'));

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
