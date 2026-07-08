import "server-only";

import type { AgentModule } from "@/lib/agents/types";

/**
 * Voice Agent — the AI receptionist. The agent that actually answers calls
 * runs on ElevenLabs + Twilio; this module is its portal surface, where the
 * customer sees whether it's live, reads its number, edits the knowledge
 * base it answers from, and logs a problem if something's off.
 *
 * No AI-Assistant tools yet — the receptionist is operated from its own
 * page, not driven through the Assistant — so `tools` is empty. Adding tools
 * later (e.g. "pause the line", "read today's call summaries") is a matter
 * of filling this array; nothing else changes.
 */
export const voiceAgentModule: AgentModule = {
  key: "voice-agent",
  name: "Voice Agent",
  version: "1.0",
  category: "voice",
  description:
    "An AI receptionist that answers missed calls, books jobs and texts you the details.",
  iconName: "mic",
  accent: "#22D3EE",
  href: "/portal/voice-agent",
  availability: "live",
  capabilities: [
    "24/7 call answering on your own number",
    "Job booking & message taking",
    "Editable knowledge base",
    "Call summaries texted to you",
  ],
  tools: [],
};
