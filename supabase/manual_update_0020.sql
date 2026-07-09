-- =============================================================================
-- AutomateIQ manual update 0020 — Voice Agent ↔ ElevenLabs link
--
-- Run in the Supabase SQL Editor (after 0019). Fully idempotent — safe to
-- re-run. Identical to supabase/migrations/0020_voice_agent_elevenlabs.sql.
--
-- Adds va_config.elevenlabs_agent_id: the ElevenLabs Conversational AI agent
-- id for the business, so a knowledge-base edit in the portal is pushed
-- straight to the live agent via the ElevenLabs API. Set by AutomateIQ
-- (service role) at provisioning time — customers never see or set it.
-- =============================================================================

alter table va_config
  add column if not exists elevenlabs_agent_id text;
