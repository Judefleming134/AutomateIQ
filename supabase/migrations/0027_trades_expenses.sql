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
