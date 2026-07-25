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
