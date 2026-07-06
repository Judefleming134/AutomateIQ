-- =============================================================================
-- AutomateIQ manual update 0012 — Custom Business Systems framework
--
-- The foundation that future bespoke enterprise systems plug into. This adds a
-- global catalogue of system types (bsys_systems) and per-organisation
-- assignments (bsys_assignments) — the framework only. Nothing is "built" here;
-- each system becomes a plug-in module later, sharing the existing AI Assistant,
-- auth, RLS, organisations and branding.
--
-- Reuses the existing Supabase project + is_active_tenant_member() helper.
-- Run in the Supabase SQL Editor. Fully idempotent. Additive only.
-- =============================================================================

-- Catalogue of system types (global, like `products`) ------------------------
create table if not exists bsys_systems (
  id uuid primary key default gen_random_uuid(),
  key text unique not null,
  name text not null,
  description text not null default '',
  icon text,
  -- Where the system is in our build pipeline.
  dev_status text not null default 'in_development'
    check (dev_status in ('planned', 'in_development', 'available')),
  sort_order integer not null default 100,
  is_custom boolean not null default false, -- true when an admin created it
  created_at timestamptz not null default now()
);
create index if not exists bsys_systems_sort_idx on bsys_systems (sort_order);

-- Per-organisation assignment / module state --------------------------------
create table if not exists bsys_assignments (
  business_id uuid not null references businesses (id) on delete cascade,
  system_id uuid not null references bsys_systems (id) on delete cascade,
  -- The module's state for this organisation.
  module_status text not null default 'coming_soon'
    check (module_status in ('coming_soon', 'provisioning', 'active', 'disabled')),
  notes text not null default '',
  assigned_at timestamptz not null default now(),
  primary key (business_id, system_id)
);
create index if not exists bsys_assignments_business_idx
  on bsys_assignments (business_id);

-- RLS: the catalogue is readable by any authenticated user (exactly like the
-- products catalogue); assignments are tenant-isolated. Admin manages both via
-- the service-role client.
alter table bsys_systems enable row level security;
drop policy if exists "authenticated can view the systems catalogue" on bsys_systems;
create policy "authenticated can view the systems catalogue"
  on bsys_systems for select
  to authenticated
  using (true);

alter table bsys_assignments enable row level security;
drop policy if exists "members view their own system assignments" on bsys_assignments;
create policy "members view their own system assignments"
  on bsys_assignments for select
  using (is_active_tenant_member(business_id));

-- Seed the eight showcase systems (idempotent) ------------------------------
insert into bsys_systems (key, name, description, icon, dev_status, sort_order) values
  ('workforce-management', 'Workforce Management System',
   'Mobile clock-in, scheduling, leave and payroll-ready timesheets built around your teams.', 'users', 'in_development', 10),
  ('asset-management', 'Asset Management System',
   'A live asset register with scanning, maintenance, warranties and full service history.', 'boxes', 'in_development', 20),
  ('field-service-management', 'Job & Field Service Management System',
   'Schedule, dispatch, track and close field jobs on-site with photos and signatures.', 'wrench', 'in_development', 30),
  ('health-safety-compliance', 'Health, Safety & Compliance Management System',
   'Risk assessments, RAMS, SOPs, incidents, training and audit-ready compliance in one place.', 'shield-check', 'in_development', 40),
  ('erp', 'Enterprise Resource Planning (ERP) System',
   'A bespoke ERP inspired by systems such as SAP — designed around your organisation.', 'factory', 'in_development', 50),
  ('finance-invoice-automation', 'Finance & Invoice Automation System',
   'Automated invoicing, AI receipt OCR, reminders and VAT-ready financial reporting.', 'banknote', 'in_development', 60),
  ('business-operations-platform', 'Business Operations Platform',
   'The central operating system for your business — CRM, projects, workflow and BI together.', 'layout-dashboard', 'in_development', 70),
  ('ai-logistics-control-centre', 'AI Logistics Control Centre',
   'Live fleet tracking, AI route optimisation and predictive maintenance on one map.', 'truck', 'in_development', 80)
on conflict (key) do update set
  name = excluded.name,
  description = excluded.description,
  icon = excluded.icon,
  sort_order = excluded.sort_order;
