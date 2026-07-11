-- =============================================================================
-- 0022 — Growth Engine: 'research_failed' prospect status
--
-- Leads whose research fails are moved into their OWN group instead of
-- circulating back into the research queue: they're excluded from fresh
-- batches entirely, listed separately with a one-tap retry, filterable in
-- the prospects table (Status → Research failed) and bulk archive/delete-able
-- from there. A successful retry moves them to research_complete like normal.
-- Additive to 0018; fully idempotent.
-- =============================================================================

alter table ge_prospects drop constraint if exists ge_prospects_status_check;
alter table ge_prospects add constraint ge_prospects_status_check
  check (status in (
    'new', 'researching', 'research_failed', 'research_complete',
    'outreach_ready', 'contacted', 'follow_up_sent', 'replied', 'qualified',
    'meeting_booked', 'proposal_in_progress', 'proposal_sent', 'negotiation',
    'won', 'lost', 'future_opportunity', 'do_not_contact', 'archived'
  ));

-- Backfill: leads that already failed research under the previous handling
-- (their timeline carries a "Research failed:" entry) move into the group
-- now, so tonight's failures are parked immediately — not on their next
-- failed attempt. Idempotent: already-moved or since-researched leads are
-- untouched.
update ge_prospects
   set status = 'research_failed'
 where status in ('new', 'researching')
   and id in (
     select prospect_id from ge_activities
      where type = 'system'
        and content like 'Research failed:%'
        and prospect_id is not null
   );
