-- =============================================================================
-- 0038 — Automatic chasing for overdue invoices
--
-- /products/tradeiq: "Chasing is automatic rather than a job for a Sunday
-- evening." 0037 made invoices real; nothing ever chased them. An invoice
-- could go out, go past its due date, and sit there forever with the platform
-- silent — which is precisely the Sunday-evening job the page says it removes.
--
-- Two columns are all it takes, and both exist to answer "have we already
-- nagged this person, and how hard":
--
--   last_chased_at — when the last reminder went. NULL = never chased, which
--     is what makes the first chase findable without a second query.
--   chase_count    — how many have gone. The tone escalates and the sequence
--     STOPS; a business that emails a customer every day about EUR 300 does
--     more damage to the relationship than the debt is worth.
--
-- Nullable and defaulted, so every invoice already raised is untouched and
-- reads correctly as "never chased".
--
-- Idempotent. Safe to re-run. Purely additive.
-- =============================================================================

alter table qa_invoices
  add column if not exists last_chased_at timestamptz;

alter table qa_invoices
  add column if not exists chase_count integer not null default 0;

-- The chaser's only query: sent, unpaid, past due, and not chased recently.
-- Partial on status so the index carries only the rows that can ever be
-- chased — a paid or voided invoice is never a candidate.
create index if not exists qa_invoices_chase_idx
  on qa_invoices (due_date, last_chased_at nulls first)
  where status = 'sent';

comment on column qa_invoices.last_chased_at is
  'When the last overdue reminder was sent. Null = never chased, and sorts first so the oldest neglected invoice is always found before one already nagged.';

comment on column qa_invoices.chase_count is
  'How many reminders have gone out. The sequence stops at a hard cap — chasing a customer indefinitely costs more than the invoice is worth.';
