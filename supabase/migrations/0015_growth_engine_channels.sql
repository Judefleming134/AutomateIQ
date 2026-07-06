-- =============================================================================
-- 0015 — Growth Engine: Facebook channel + phone-call scripts
--
-- The owner's real workflow is DM-ing local trades on Instagram, Facebook
-- and LinkedIn and cold-calling them personally. This adds:
--   - 'facebook' as a full outreach channel (prospect URL, messages,
--     templates, campaigns, activity log)
--   - 'call' as a channel: a "message" on the call channel is the prepared
--     call script; marking it sent records that the call was made.
-- Additive to 0014; run after it. Fully idempotent.
-- =============================================================================

alter table ge_prospects add column if not exists facebook_url text;

alter table ge_messages drop constraint if exists ge_messages_channel_check;
alter table ge_messages add constraint ge_messages_channel_check
  check (channel in ('linkedin', 'instagram', 'facebook', 'email', 'sms', 'call'));

alter table ge_activities drop constraint if exists ge_activities_type_check;
alter table ge_activities add constraint ge_activities_type_check
  check (type in ('note', 'call', 'email', 'linkedin', 'instagram', 'facebook',
                  'sms', 'meeting', 'status_change', 'task', 'system'));

alter table ge_templates drop constraint if exists ge_templates_channel_check;
alter table ge_templates add constraint ge_templates_channel_check
  check (channel in ('linkedin', 'instagram', 'facebook', 'email', 'sms', 'call'));

alter table ge_campaigns drop constraint if exists ge_campaigns_channel_check;
alter table ge_campaigns add constraint ge_campaigns_channel_check
  check (channel in ('linkedin', 'instagram', 'facebook', 'email', 'sms', 'call', 'multi'));
