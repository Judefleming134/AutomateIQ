-- manual_update_tradeos_finance.sql — everything TradeOS + AutomateIQ Finance
-- needs, in one paste: migrations 0026 → 0029 combined, in order. Every
-- statement is idempotent (create if not exists / drop-then-create policies),
-- so re-running this whole file is safe. Run in: Supabase → SQL Editor → Run.

-- ═══════════════════════ 0026_trades.sql ═══════════════════════
-- 0026_trades.sql — Trades quoting & invoicing tool.
--
-- A self-serve product for tradespeople (plumbers, electricians, …): create a
-- quote, send it, convert it to an invoice, get paid. Deliberately NOT wired
-- into the portal's businesses/profiles tenancy — every row is owned directly
-- by the Supabase auth user (auth.uid()), so the whole product stays cleanly
-- separable into its own app/domain later. Public quote/invoice pages are read
-- by server code via the service-role client (looked up by public_token), the
-- same pattern as the booking page — so no public RLS policy is needed.
--
-- Idempotent: safe to re-run.

create extension if not exists pgcrypto;

-- ── The tradesperson's own account/profile ───────────────────────────────
create table if not exists trades_accounts (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null unique references auth.users (id) on delete cascade,
  business_name      text not null default '',
  trade              text,                         -- plumber / electrician / …
  email              text,
  phone              text,
  address            text,
  logo_url           text,
  vat_rate           numeric(5,2)  not null default 0,   -- %; 0 = not VAT registered
  vat_number         text,
  payment_terms_days int           not null default 14,
  -- Per-account running numbers so quotes/invoices read Q-0001 / INV-0001.
  quote_seq          int not null default 0,
  invoice_seq        int not null default 0,
  created_at         timestamptz not null default now()
);

-- ── Their customers ───────────────────────────────────────────────────────
create table if not exists trades_customers (
  id         uuid primary key default gen_random_uuid(),
  account_id uuid not null references trades_accounts (id) on delete cascade,
  name       text not null,
  email      text,
  phone      text,
  address    text,
  created_at timestamptz not null default now()
);
create index if not exists trades_customers_account_idx on trades_customers (account_id);

-- ── Quotes & invoices (one row, distinguished by kind) ────────────────────
create table if not exists trades_documents (
  id           uuid primary key default gen_random_uuid(),
  account_id   uuid not null references trades_accounts (id) on delete cascade,
  customer_id  uuid references trades_customers (id) on delete set null,
  kind         text not null check (kind in ('quote','invoice')),
  number       text not null,
  status       text not null default 'draft'
                 check (status in ('draft','sent','accepted','declined','paid','void')),
  currency     text not null default 'EUR',
  notes        text,
  subtotal     numeric(12,2) not null default 0,
  vat_rate     numeric(5,2)  not null default 0,
  vat_amount   numeric(12,2) not null default 0,
  total        numeric(12,2) not null default 0,
  issued_at    date,
  due_at       date,
  -- Unguessable token for the public view/accept/pay page (service-role read).
  public_token text not null unique default encode(gen_random_bytes(16), 'hex'),
  -- When a quote is turned into an invoice, link the two.
  converted_to uuid references trades_documents (id) on delete set null,
  paid_at      timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists trades_documents_account_idx on trades_documents (account_id, kind, status);
create index if not exists trades_documents_customer_idx on trades_documents (customer_id);

-- ── Line items ────────────────────────────────────────────────────────────
create table if not exists trades_line_items (
  id          uuid primary key default gen_random_uuid(),
  document_id uuid not null references trades_documents (id) on delete cascade,
  description text not null default '',
  quantity    numeric(12,2) not null default 1,
  unit_price  numeric(12,2) not null default 0,
  amount      numeric(12,2) not null default 0,
  position    int not null default 0
);
create index if not exists trades_line_items_doc_idx on trades_line_items (document_id);

-- ── RLS: each tradesperson sees ONLY their own rows ───────────────────────
alter table trades_accounts  enable row level security;
alter table trades_customers enable row level security;
alter table trades_documents enable row level security;
alter table trades_line_items enable row level security;

-- Owns-this-account helper (security definer so the policy can read the table
-- it's protecting without recursing through RLS).
create or replace function public.owns_trades_account(acc uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from trades_accounts a
    where a.id = acc and a.user_id = (select auth.uid())
  );
$$;

drop policy if exists "trades_accounts own select" on trades_accounts;
create policy "trades_accounts own select" on trades_accounts
  for select using (user_id = (select auth.uid()));
drop policy if exists "trades_accounts own insert" on trades_accounts;
create policy "trades_accounts own insert" on trades_accounts
  for insert with check (user_id = (select auth.uid()));
drop policy if exists "trades_accounts own update" on trades_accounts;
create policy "trades_accounts own update" on trades_accounts
  for update using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "trades_customers own all" on trades_customers;
create policy "trades_customers own all" on trades_customers
  for all using (owns_trades_account(account_id))
  with check (owns_trades_account(account_id));

drop policy if exists "trades_documents own all" on trades_documents;
create policy "trades_documents own all" on trades_documents
  for all using (owns_trades_account(account_id))
  with check (owns_trades_account(account_id));

drop policy if exists "trades_line_items own all" on trades_line_items;
create policy "trades_line_items own all" on trades_line_items
  for all using (
    exists (select 1 from trades_documents d
            where d.id = document_id and owns_trades_account(d.account_id))
  )
  with check (
    exists (select 1 from trades_documents d
            where d.id = document_id and owns_trades_account(d.account_id))
  );

-- ═══════════════════════ 0027_trades_expenses.sql ═══════════════════════
-- 0027_trades_expenses.sql — TradeOS scan-and-track finance records.
--
-- A scanned/photographed invoice becomes a row here: money OUT (a supplier
-- bill to pay — direction 'payable') or money IN (an invoice the tradesperson
-- issued on paper and wants tracked — direction 'receivable'). The full AI
-- extraction is kept in `extracted` (jsonb) for complete transparency: what
-- the scanner read is always inspectable next to what was saved.
--
-- Same ownership model as 0026: rows keyed to the tradesperson's account,
-- RLS via owns_trades_account() (defined in 0026). Idempotent — safe to re-run.

create table if not exists trades_expenses (
  id                 uuid primary key default gen_random_uuid(),
  account_id         uuid not null references trades_accounts (id) on delete cascade,
  direction          text not null default 'payable'
                       check (direction in ('payable','receivable')),
  counterparty       text not null default '',       -- supplier or customer name
  counterparty_email text,
  category           text,                            -- materials / fuel / insurance / tools / ...
  doc_number         text,
  issued_at          date,
  due_at             date,
  subtotal           numeric(12,2) not null default 0,
  vat_amount         numeric(12,2) not null default 0,
  total              numeric(12,2) not null default 0,
  currency           text not null default 'EUR',
  status             text not null default 'unpaid'
                       check (status in ('unpaid','paid','disputed')),
  paid_at            timestamptz,
  summary            text,                            -- one line: what this is for
  extracted          jsonb,                           -- raw AI extraction (transparency/audit)
  source             text not null default 'scan' check (source in ('scan','manual')),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists trades_expenses_account_idx
  on trades_expenses (account_id, direction, status);
create index if not exists trades_expenses_due_idx
  on trades_expenses (account_id, due_at);

alter table trades_expenses enable row level security;

drop policy if exists "trades_expenses own all" on trades_expenses;
create policy "trades_expenses own all" on trades_expenses
  for all using (owns_trades_account(account_id))
  with check (owns_trades_account(account_id));

-- ═══════════════════════ 0028_trades_network.sql ═══════════════════════
-- 0028_trades_network.sql — the TradeOS network: linked accounts.
--
-- When a tradesperson receives a TradeOS invoice and claims it (or the send
-- finds their signup email), the two accounts become CONNECTED and the
-- document lands in the recipient's Finance as a bill automatically — no
-- scanning. Connections are stored in BOTH directions so reads stay a simple
-- owner-scoped select. Idempotent — safe to re-run.

create table if not exists trades_connections (
  id              uuid primary key default gen_random_uuid(),
  account_id      uuid not null references trades_accounts (id) on delete cascade,
  peer_account_id uuid not null references trades_accounts (id) on delete cascade,
  created_at      timestamptz not null default now(),
  unique (account_id, peer_account_id),
  check (account_id <> peer_account_id)
);
create index if not exists trades_connections_account_idx on trades_connections (account_id);

alter table trades_connections enable row level security;
drop policy if exists "trades_connections own select" on trades_connections;
create policy "trades_connections own select" on trades_connections
  for select using (owns_trades_account(account_id));

-- A network bill links back to the sender's document, so paid-status can sync
-- both books. One expense row per (account, document) — a re-claim is a no-op.
alter table trades_expenses
  add column if not exists linked_document_id uuid references trades_documents (id) on delete set null;
create unique index if not exists trades_expenses_linked_doc_uniq
  on trades_expenses (account_id, linked_document_id)
  where linked_document_id is not null;

-- Allow the 'network' source alongside scan/manual.
alter table trades_expenses drop constraint if exists trades_expenses_source_check;
alter table trades_expenses add constraint trades_expenses_source_check
  check (source in ('scan','manual','network'));

-- ═══════════════════════ 0029_finance_product.sql ═══════════════════════
-- 0029_finance_product.sql — AutomateIQ Finance: forecast + budgets.
--
-- bank_balance: the manually-entered current balance the 13-week forecast
-- starts from (the interim until an open-banking feed lands; set_at shown so
-- staleness is visible). trades_budgets: per-category monthly spend limits,
-- the Ramp-style budget guardrails. Idempotent — safe to re-run.

alter table trades_accounts
  add column if not exists bank_balance numeric(14,2);
alter table trades_accounts
  add column if not exists bank_balance_set_at timestamptz;

create table if not exists trades_budgets (
  id            uuid primary key default gen_random_uuid(),
  account_id    uuid not null references trades_accounts (id) on delete cascade,
  category      text not null,
  monthly_limit numeric(12,2) not null default 0,
  created_at    timestamptz not null default now(),
  unique (account_id, category)
);

alter table trades_budgets enable row level security;
drop policy if exists "trades_budgets own all" on trades_budgets;
create policy "trades_budgets own all" on trades_budgets
  for all using (owns_trades_account(account_id))
  with check (owns_trades_account(account_id));

