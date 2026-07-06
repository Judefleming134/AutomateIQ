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
