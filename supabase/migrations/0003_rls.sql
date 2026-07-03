-- Row Level Security. Enabled on every tenant-scoped table with NO
-- exceptions — admin access does NOT go through an RLS "OR role=admin"
-- clause (that would require every policy on every current/future table to
-- correctly include it, forever). Instead /admin server code uses the
-- service-role client, which bypasses RLS entirely, gated by an explicit
-- role check re-run inside every admin Server Action/Route Handler (see
-- lib/auth/require-admin.ts) — never trust middleware alone as that
-- boundary.
--
-- Customer-facing tables use a single helper function rather than
-- copy-pasted subqueries, and it enforces business suspension too — a
-- suspended tenant's users are blocked at the data layer, not just a UI flag.

create function public.is_active_tenant_member(target_business_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from profiles p
    join businesses b on b.id = p.business_id
    where p.id = (select auth.uid())
      and p.business_id = target_business_id
      and b.status = 'active'
      and b.deleted_at is null
  );
$$;

-- businesses ---------------------------------------------------------

alter table businesses enable row level security;

create policy "members can view their own business"
  on businesses for select
  using (is_active_tenant_member(id));

create policy "members can update their own business"
  on businesses for update
  using (is_active_tenant_member(id))
  with check (is_active_tenant_member(id));

-- profiles -------------------------------------------------------------

alter table profiles enable row level security;

create policy "users can view their own profile"
  on profiles for select
  using (id = (select auth.uid()));

-- products / business_products -----------------------------------------

alter table products enable row level security;

create policy "authenticated users can view the product catalog"
  on products for select
  to authenticated
  using (true);

alter table business_products enable row level security;

create policy "members can view their own enabled products"
  on business_products for select
  using (is_active_tenant_member(business_id));

-- custom_modules ---------------------------------------------------------

alter table custom_modules enable row level security;

create policy "members can view their own custom modules"
  on custom_modules for select
  using (is_active_tenant_member(business_id));

-- ra_customers / ra_review_requests --------------------------------------

alter table ra_customers enable row level security;

create policy "members can manage their own review-agent customers"
  on ra_customers for all
  using (is_active_tenant_member(business_id))
  with check (is_active_tenant_member(business_id));

alter table ra_review_requests enable row level security;

create policy "members can manage their own review requests"
  on ra_review_requests for all
  using (is_active_tenant_member(business_id))
  with check (is_active_tenant_member(business_id));

-- admin_audit_log ---------------------------------------------------------
-- No policies at all: only ever read/written via the service-role client
-- from gated /admin code. RLS enabled with zero policies denies all access
-- to the anon/authenticated roles by default, which is exactly what we want.

alter table admin_audit_log enable row level security;
