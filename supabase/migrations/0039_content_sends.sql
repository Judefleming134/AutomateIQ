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
