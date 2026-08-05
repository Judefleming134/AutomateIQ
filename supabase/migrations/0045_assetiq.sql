-- =============================================================================
-- 0045 — AssetIQ: what you own, where it is, and what's due on it.
--
-- DELIBERATELY ONE TABLE.
--
-- Asset management as a category means depreciation schedules, barcode
-- scanning, check-in/check-out custody chains and maintenance work orders.
-- None of that is the problem a plumber with four vans, a pipe-freezer and a
-- set of test meters actually has. Theirs is smaller and sharper:
--
--   * what do we own, and what did it cost
--   * who has it / which van is it in
--   * WHAT IS DUE, AND HAS IT GONE PAST
--
-- The third is the whole product. A CVRT that lapsed, a PAT test nobody
-- booked, a calibration cert that expired the week before it was needed on
-- site — those cost real money and they are missed because they live in a
-- glovebox and somebody's memory. So `next_due_date` and `next_due_label` are
-- first-class columns rather than a maintenance sub-table: one date per asset
-- that the list can sort and colour by. When somebody genuinely needs a
-- schedule of every service a van has ever had, that is a second table added
-- later — it does not have to exist for the first version to be useful, and
-- pretending otherwise is how a simple product ships late and unused.
--
-- `assigned_to` and `location` are free TEXT on purpose. Making them foreign
-- keys to a staff table means AssetIQ cannot be switched on until a staff
-- table exists, and "Ciaran's van" is a perfectly good answer that no
-- normalisation improves for a nine-person business.
--
-- SAFETY
--   Purely additive. New table, new indexes, new policy, one product row.
--   Every statement is IF NOT EXISTS / drop-then-create / on-conflict, so the
--   file is safe to run against a database in any state and safe to re-run.
--   Nothing existing is altered, renamed or deleted.
-- =============================================================================

create table if not exists ast_assets (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,

  name text not null,
  -- Broad on purpose. A category that needs a migration to add is a category
  -- nobody uses; 'other' is always available and always valid.
  category text not null default 'other'
    check (category in ('vehicle', 'plant', 'tool', 'equipment', 'it', 'other')),
  -- Registration, serial or asset tag — whichever the business actually uses.
  identifier text,
  assigned_to text,
  location text,

  status text not null default 'in_service'
    check (status in ('in_service', 'in_repair', 'retired')),

  purchase_date date,
  -- Integer cents, like qa_invoices.amount_cents and NOT like qa_quotes.total,
  -- which is free text and cannot be summed. A "what are we sitting on"
  -- number that silently drops the assets somebody typed "approx 2k" into is
  -- worse than no number.
  purchase_cost_cents integer
    check (purchase_cost_cents is null or purchase_cost_cents >= 0),

  -- The reason the product exists. Nullable because plenty of assets have
  -- nothing due — a wheelbarrow needs no certificate — and forcing a date
  -- would train people to type a fake one.
  next_due_date date,
  next_due_label text,

  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The due list: everything with a date, soonest first, per business. Partial
-- so the index carries only rows that can appear on it — an asset with nothing
-- due is not a row the due query ever wants to read past.
create index if not exists ast_assets_due_idx
  on ast_assets (business_id, next_due_date)
  where next_due_date is not null;

create index if not exists ast_assets_recent_idx
  on ast_assets (business_id, created_at desc);

alter table ast_assets enable row level security;

drop policy if exists "members manage their own assets" on ast_assets;
create policy "members manage their own assets"
  on ast_assets
  for all
  using (is_active_tenant_member (business_id))
  with check (is_active_tenant_member (business_id));

comment on table ast_assets is
  'AssetIQ: one row per owned asset. next_due_date/next_due_label carry the single next thing due on it (CVRT, service, PAT test, calibration, insurance) — deliberately one date rather than a maintenance schedule table, because the product is "what has gone past", not a service history.';

-- ── Product registry row ─────────────────────────────────────────────────────
-- The key is permanent from this moment: business_products joins on it, so it
-- can never be renamed. Brand-led like 'permitiq', not '…-agent' — that naming
-- is retired.
insert into products (key, name, description, icon_name, status)
values (
  'assetiq',
  'AssetIQ',
  'Every van, tool and machine you own — what it cost, who has it, and what is due on it before it goes past.',
  'wrench',
  'active'
)
on conflict (key) do nothing;
