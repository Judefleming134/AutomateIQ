-- =============================================================================
-- AutomateIQ manual update 0018 — Growth Engine: complete pipeline statuses
--
-- Run in the Supabase SQL Editor (after 0017). Fully idempotent — safe to
-- re-run. Identical to supabase/migrations/0018_growth_pipeline_statuses.sql.
-- =============================================================================

alter table ge_prospects drop constraint if exists ge_prospects_status_check;
alter table ge_prospects add constraint ge_prospects_status_check
  check (status in (
    'new', 'researching', 'research_complete', 'outreach_ready',
    'contacted', 'follow_up_sent', 'replied', 'qualified', 'meeting_booked',
    'proposal_in_progress', 'proposal_sent', 'negotiation',
    'won', 'lost', 'future_opportunity', 'do_not_contact', 'archived'
  ));
