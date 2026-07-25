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
