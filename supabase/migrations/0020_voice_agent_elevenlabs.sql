-- Voice Agent ↔ ElevenLabs link. Stores the ElevenLabs Conversational AI
-- agent id for each business so a knowledge-base edit in the portal can be
-- pushed straight to the live agent via the ElevenLabs API. Set by AutomateIQ
-- (service role) at provisioning time — customers never see or set it.
-- Idempotent — safe to re-run.

alter table va_config
  add column if not exists elevenlabs_agent_id text;
