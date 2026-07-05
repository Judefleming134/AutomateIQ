-- =============================================================================
-- AutomateIQ manual update 0010 — AI Strategy Session bookings
--
-- Backs the public "Book Your Free AI Strategy Session" page. Public visitors
-- create bookings through the service-role client (no session), exactly like
-- Website Agent lead capture; the owner manages them in /admin/bookings.
--
-- Reuses the existing Supabase project. Run in the Supabase SQL Editor.
-- Fully idempotent.
-- =============================================================================

create table if not exists strategy_bookings (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  company text,
  email text not null,
  phone text,
  business_type text,
  message text,
  -- The agreed consultation time. Stored as a consistent wall-clock instant
  -- (see lib/booking/slots.ts) and always displayed in Irish time.
  slot_at timestamptz not null,
  status text not null default 'pending'
    check (status in ('pending', 'confirmed', 'rescheduled', 'cancelled', 'completed')),
  admin_notes text,
  source text not null default 'website',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Prevent double-booking: at most one active booking may hold a given slot.
-- Cancelled/completed bookings free the slot again. This is the real guard —
-- the UI hides taken slots, but the DB is what makes it correct under a race.
create unique index if not exists strategy_bookings_active_slot_idx
  on strategy_bookings (slot_at)
  where status in ('pending', 'confirmed', 'rescheduled');

create index if not exists strategy_bookings_status_idx
  on strategy_bookings (status, slot_at);

-- RLS on, no policy: deny-all to the authenticated/anon roles. Public creation
-- and admin management both go through the service-role client, which bypasses
-- RLS (the same trust boundary the rest of the platform already uses).
alter table strategy_bookings enable row level security;

create or replace function set_updated_at_strategy_bookings()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists strategy_bookings_updated_at on strategy_bookings;
create trigger strategy_bookings_updated_at
  before update on strategy_bookings
  for each row execute function set_updated_at_strategy_bookings();
