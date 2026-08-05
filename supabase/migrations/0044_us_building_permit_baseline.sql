-- ======================================================================
-- 0044 — PlanIQ: a typical US residential building-permit requirement list.
--
-- WHY THIS EXISTS
--   The US side of this product has been fully wired since 0033: the schema
--   constrains `jurisdiction` to ('ie','us'), the portal has a United States
--   tab, the application form offers `building_permit`, and the checklist
--   resolver already filters requirements by jurisdiction. Everything worked
--   except that NOT ONE US REQUIREMENT ROW WAS EVER SEEDED, so a customer who
--   created a US application got an empty checklist and the page had to tell
--   them so ("US permits are set up but not yet stocked").
--
--   That was the honest thing to say while it was true. This makes it stop
--   being true.
--
-- WHAT IT CLAIMS, EXACTLY
--   The same claim the Irish baseline in 0033 makes, and no more: this is the
--   national/default list (authority = null) — "deliberately a STARTING POINT,
--   not a claim of completeness". US permitting is set municipality by
--   municipality, not nationally, so the baseline below is the set of items
--   that a residential building permit asks for almost everywhere, and every
--   `guidance` string says plainly that the local building department's own
--   list governs.
--
--   resolveRequirements() in lib/permitiq/checklist.ts already collapses a
--   named authority's rows over the baseline PER CODE, so seeding
--   ('us', 'City of Austin', 'building_permit', …) later overrides these item
--   by item without losing the rest. Nothing here has to be undone to add a
--   real municipality — which is the whole reason the baseline is safe to
--   ship.
--
-- SAFETY
--   Additive only: one INSERT, no schema change, no UPDATE, no DELETE.
--   Idempotent via the (jurisdiction, authority, application_type, code)
--   unique constraint with NULLS NOT DISTINCT, so re-running changes nothing
--   and a municipality's own rows are untouched.
-- ======================================================================

insert into pq_requirements
  (jurisdiction, authority, application_type, code, label, guidance, mandatory, sort_order)
values
  ('us', null, 'building_permit', 'application_form', 'Completed permit application',
   'The building department''s own application form, signed. Nearly every jurisdiction has its own; check theirs before using a generic one.', true, 10),
  ('us', null, 'building_permit', 'plot_plan', 'Plot / site plan',
   'The lot with the proposed work on it: property lines, setbacks from each boundary, existing structures, driveway and easements. Usually to scale and often required to be stamped.', true, 20),
  ('us', null, 'building_permit', 'floor_plans', 'Floor plans',
   'Existing and proposed, dimensioned, with room uses, window and door schedules, and smoke/CO alarm locations marked.', true, 30),
  ('us', null, 'building_permit', 'elevations', 'Exterior elevations',
   'Every elevation affected by the work, showing finished grade, overall height and exterior finishes.', true, 40),
  ('us', null, 'building_permit', 'structural_plans', 'Foundation and framing plans',
   'Foundation plan, framing plans and sections. Most jurisdictions require these stamped by a licensed engineer or architect once the work is structural.', true, 50),
  ('us', null, 'building_permit', 'energy_compliance', 'Energy code compliance',
   'The IECC (or the state''s own code — Title 24 in California, for example) compliance documentation for new conditioned space or an envelope alteration.', true, 60),
  ('us', null, 'building_permit', 'contractor_license', 'Contractor license and insurance',
   'The license number for the state or municipality, plus proof of general liability and workers'' compensation cover. Owner-builders are usually asked for a signed affidavit instead.', true, 70),
  ('us', null, 'building_permit', 'permit_fee', 'Permit fee',
   'Normally calculated from the valuation of the work, so the valuation figure is typically required with the application.', true, 80),
  ('us', null, 'building_permit', 'zoning_approval', 'Zoning approval or variance',
   'Required where the work does not meet the base zoning — setbacks, lot coverage, height or use. Some jurisdictions run this as a separate approval that must be granted before the building permit is issued.', false, 90),
  ('us', null, 'building_permit', 'septic_well_approval', 'Septic / well approval',
   'Required where the property is not on municipal sewer or water. Usually issued by the county health department rather than the building department.', false, 100),
  ('us', null, 'building_permit', 'trade_permits', 'Plumbing, mechanical and electrical permits',
   'Frequently applied for separately by each licensed trade rather than being part of the building permit. Listed here so it is not forgotten, not because it is always one submission.', false, 110),
  ('us', null, 'building_permit', 'survey', 'Boundary survey',
   'Asked for where setbacks are tight, the lot lines are disputed, or the work is in a flood or coastal zone.', false, 120)
on conflict (jurisdiction, authority, application_type, code) do nothing;
