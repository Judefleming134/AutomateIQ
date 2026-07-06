-- =============================================================================
-- 0018 — Growth Engine: complete outbound pipeline statuses
--
-- Extends (never renames) the prospect pipeline with six stages:
--   outreach_ready, follow_up_sent, proposal_in_progress, negotiation,
--   future_opportunity, archived
-- Existing statuses and every automation on them are preserved; the new
-- ones slot between them (see lib/growth/constants.ts for the full order).
-- Additive to 0017; run after it. Fully idempotent.
-- =============================================================================

alter table ge_prospects drop constraint if exists ge_prospects_status_check;
alter table ge_prospects add constraint ge_prospects_status_check
  check (status in (
    'new', 'researching', 'research_complete', 'outreach_ready',
    'contacted', 'follow_up_sent', 'replied', 'qualified', 'meeting_booked',
    'proposal_in_progress', 'proposal_sent', 'negotiation',
    'won', 'lost', 'future_opportunity', 'do_not_contact', 'archived'
  ));
