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
