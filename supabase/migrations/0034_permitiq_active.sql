-- ---------------------------------------------------------------------------
-- PermitIQ goes from 'coming_soon' to 'active'.
--
-- 0033 created the schema and registered the product as coming_soon because
-- there was no surface behind it yet. The applicant surface now exists:
-- create an application, upload drawings, get them read and attributed, and
-- see a live checklist against the Irish requirements catalog.
--
-- This flips the product's STATUS only. It does NOT grant PermitIQ to anyone:
-- access still comes from a business_products row, added per customer from the
-- admin area, exactly like every other module. So running this changes what the
-- badge says, not who can get in.
--
-- Idempotent: re-running sets the same value.
-- ---------------------------------------------------------------------------

update products set status = 'active' where key = 'permitiq';
