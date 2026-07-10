-- Stripe-backed activation: a one-off setup fee + monthly subscription taken
-- through Stripe Checkout. Purely additive and inert until the app has the
-- STRIPE_* env vars set — existing customers/pages are unaffected.
--
-- Flow: admin creates the customer → they log in → Billing tab → Stripe
-- Checkout (setup fee + first month) → webhook confirms payment → the
-- business is marked active and the AI Assistant + Voice Agent products are
-- enabled for them (a row in business_products, exactly as an admin toggle
-- would create).

alter table businesses add column if not exists stripe_customer_id text;
alter table businesses add column if not exists stripe_subscription_id text;
alter table businesses
  add column if not exists subscription_status text not null default 'inactive';
alter table businesses add column if not exists activated_at timestamptz;

-- Webhook idempotency + a light audit trail. Service-role only: RLS is on
-- with no policies, so nothing but the server-side webhook (service role,
-- which bypasses RLS) can read or write it — same doctrine as other
-- platform-internal tables.
create table if not exists bl_billing_events (
  id uuid primary key default gen_random_uuid(),
  stripe_event_id text unique not null,
  type text not null,
  business_id uuid references businesses (id) on delete set null,
  created_at timestamptz not null default now()
);

alter table bl_billing_events enable row level security;
