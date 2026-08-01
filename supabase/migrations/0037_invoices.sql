-- =============================================================================
-- 0037 — Invoices. The half of QuoteIQ that was sold but never built.
--
-- /products/tradeiq says, in as many words: "Quotes become invoices in one
-- step, with online card payment on the link" and "Chasing is automatic rather
-- than a job for a Sunday evening."
--
-- There was no invoice anywhere in the product. A quote could be created,
-- sent, viewed and accepted — and then the trail stopped. The customer had
-- agreed to pay and the platform had no way to ask them for the money. The
-- trades_* tables are a separate TradeOS schema and are not reachable from
-- QuoteIQ, so nothing filled the gap.
--
-- This is the table behind: accept a quote -> raise the invoice in one step ->
-- send it -> the customer opens a public page -> it is marked paid, and the
-- CRM records the money.
--
-- DESIGN NOTES
--
-- * `amount_cents` is an INTEGER, unlike qa_quotes.total which is free TEXT.
--   A quote total is a human sentence ("from EUR 900"); an invoice is a demand
--   for an exact sum and must never be stored as prose. The conversion parses
--   the quote text once, at creation, and anything unparseable forces the
--   number to be typed rather than guessed.
-- * `number` is per-business and human-facing ("INV-0007"). Unique per
--   business so two customers never receive the same reference, which is both
--   confusing and an accounting problem.
-- * `view_token` mirrors qa_quotes: an unguessable uuid is the customer's key
--   to a public page, so no login is needed to view or pay.
-- * Money is never deleted. `status` moves draft -> sent -> paid, or -> void.
--   There is no DELETE path in the app: voiding leaves the record and the
--   audit trail intact, which is what an invoice is for.
--
-- Idempotent. Safe to re-run. Purely additive — creates one new table and
-- touches nothing that already exists.
-- =============================================================================

create table if not exists qa_invoices (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  -- The quote it came from, when it came from one. Nullable so an invoice can
  -- also be raised directly for work that never had a formal quote.
  quote_id uuid references qa_quotes (id) on delete set null,
  number text not null,
  customer_name text not null,
  customer_email text,
  -- Same shape as qa_quotes.quote_lines: [{ item, price }]
  lines jsonb not null default '[]'::jsonb,
  amount_cents integer not null default 0 check (amount_cents >= 0),
  currency text not null default 'EUR',
  status text not null default 'draft'
    check (status in ('draft', 'sent', 'paid', 'void')),
  notes text not null default '',
  due_date date,
  view_token uuid not null default gen_random_uuid(),
  sent_at timestamptz,
  paid_at timestamptz,
  -- What was actually received. A part payment is real life; it must not be
  -- silently rounded up to the invoice total.
  paid_amount_cents integer check (paid_amount_cents >= 0),
  created_at timestamptz not null default now()
);

-- The customer's key to the public page. Unique so a token identifies exactly
-- one invoice.
create unique index if not exists qa_invoices_view_token_idx
  on qa_invoices (view_token);

-- Human reference, unique within a business.
create unique index if not exists qa_invoices_business_number_idx
  on qa_invoices (business_id, number);

-- The list view: newest first for one business.
create index if not exists qa_invoices_business_created_idx
  on qa_invoices (business_id, created_at desc);

-- The chase query: what is sent, unpaid and past its due date.
create index if not exists qa_invoices_outstanding_idx
  on qa_invoices (business_id, due_date)
  where status = 'sent';

-- One invoice per quote. Raising a second invoice for the same accepted quote
-- is double-billing a customer, which is the single worst thing this table
-- could be used to do by accident — a double-click on "Create invoice" must
-- not be able to cause it.
create unique index if not exists qa_invoices_quote_idx
  on qa_invoices (quote_id)
  where quote_id is not null;

alter table qa_invoices enable row level security;

drop policy if exists "members manage their own invoices" on qa_invoices;
create policy "members manage their own invoices"
  on qa_invoices
  for all
  using (is_active_tenant_member (business_id))
  with check (is_active_tenant_member (business_id));

comment on table qa_invoices is
  'Invoices raised from accepted QuoteIQ quotes, or directly. amount_cents is an exact integer — unlike qa_quotes.total, which is free text. One invoice per quote, enforced by a partial unique index, so a double-click cannot double-bill.';
