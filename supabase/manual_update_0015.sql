-- =============================================================================
-- AutomateIQ manual update 0015 — Growth Engine: Facebook channel + call scripts
--
-- Run in the Supabase SQL Editor (after 0014). Fully idempotent — safe to
-- re-run. Identical to supabase/migrations/0015_growth_engine_channels.sql.
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
