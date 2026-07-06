-- =============================================================================
-- AutomateIQ manual update 0013 — AI Logistics Control Centre
--
-- The first bespoke Business System: an enterprise logistics platform, built as
-- a specialist AI agent inside the existing ecosystem. Reuses the existing
-- Supabase project, organisations, auth, is_active_tenant_member() RLS and
-- product entitlement — this migration only adds the logistics tables + the
-- product row. Additive only; nothing existing is changed.
--
-- Run in the Supabase SQL Editor. Fully idempotent.
-- =============================================================================

-- Drivers -------------------------------------------------------------------
create table if not exists log_drivers (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  name text not null,
  phone text,
  email text,
  license_no text,
  status text not null default 'active' check (status in ('active', 'off_duty', 'inactive')),
  notes text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists log_drivers_business_idx on log_drivers (business_id);

-- Warehouses ----------------------------------------------------------------
create table if not exists log_warehouses (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  name text not null,
  address text not null default '',
  lat double precision,
  lng double precision,
  contact_name text,
  contact_phone text,
  capacity numeric,             -- total capacity (units/pallets/etc.)
  current_utilisation numeric,  -- current used capacity
  wh_type text not null default 'distribution',
  opening_hours text not null default '',
  notes text not null default '',
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now()
);
create index if not exists log_warehouses_business_idx on log_warehouses (business_id);

-- Vehicles / fleet ----------------------------------------------------------
create table if not exists log_vehicles (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  registration text not null,
  name text,
  vtype text not null default 'van' check (vtype in ('truck', 'van', 'lorry', 'trailer')),
  capacity numeric,
  driver_id uuid references log_drivers (id) on delete set null,
  status text not null default 'idle' check (status in ('active', 'idle', 'maintenance', 'inactive')),
  -- GPS: live (from a provider), manual (owner-updated), or disconnected.
  gps_status text not null default 'manual' check (gps_status in ('live', 'manual', 'disconnected')),
  gps_provider text,   -- samsara | geotab | verizon | teltonika | traccar | custom
  last_lat double precision,
  last_lng double precision,
  last_seen_at timestamptz,
  maintenance_notes text not null default '',
  insurance_expiry date,
  created_at timestamptz not null default now()
);
create index if not exists log_vehicles_business_idx on log_vehicles (business_id);

-- Routes + stops ------------------------------------------------------------
create table if not exists log_routes (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  name text not null,
  start_warehouse_id uuid references log_warehouses (id) on delete set null,
  end_address text not null default '',
  end_lat double precision,
  end_lng double precision,
  driver_id uuid references log_drivers (id) on delete set null,
  vehicle_id uuid references log_vehicles (id) on delete set null,
  status text not null default 'draft' check (status in ('draft', 'active', 'completed', 'archived')),
  distance_km numeric,
  duration_min numeric,
  notes text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists log_routes_business_idx on log_routes (business_id);

create table if not exists log_route_stops (
  id uuid primary key default gen_random_uuid(),
  route_id uuid not null references log_routes (id) on delete cascade,
  business_id uuid not null references businesses (id) on delete cascade,
  seq integer not null default 0,
  label text not null default '',
  address text not null default '',
  lat double precision,
  lng double precision,
  window_start timestamptz,
  window_end timestamptz
);
create index if not exists log_route_stops_route_idx on log_route_stops (route_id, seq);

-- Deliveries ----------------------------------------------------------------
create table if not exists log_deliveries (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses (id) on delete cascade,
  customer_name text not null,
  address text not null default '',
  lat double precision,
  lng double precision,
  window_start timestamptz,
  window_end timestamptz,
  status text not null default 'scheduled'
    check (status in ('scheduled', 'in_transit', 'delivered', 'delayed', 'failed')),
  driver_id uuid references log_drivers (id) on delete set null,
  vehicle_id uuid references log_vehicles (id) on delete set null,
  route_id uuid references log_routes (id) on delete set null,
  notes text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists log_deliveries_business_idx on log_deliveries (business_id, status);

-- RLS: same tenant-isolation model as every other agent table. --------------
do $$
declare t text;
begin
  foreach t in array array[
    'log_drivers', 'log_warehouses', 'log_vehicles',
    'log_routes', 'log_route_stops', 'log_deliveries'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "members manage their own logistics data" on %I', t);
    execute format(
      'create policy "members manage their own logistics data" on %I for all using (is_active_tenant_member(business_id)) with check (is_active_tenant_member(business_id))',
      t
    );
  end loop;
end $$;

-- Register the product so it can be assigned in Admin -> customer -> Products.
insert into products (key, name, description, icon_name, status)
values
  ('logistics-control-centre', 'AI Logistics Control Centre',
   'Live fleet tracking, warehouses, routes and deliveries on one interactive map — coordinated by your AI Assistant.',
   'truck', 'active')
on conflict (key) do update set
  name = excluded.name,
  description = excluded.description,
  icon_name = excluded.icon_name,
  status = excluded.status;

-- Mark the matching Business System available + link its portal route (0012).
update bsys_systems
  set dev_status = 'available'
  where key = 'ai-logistics-control-centre';
