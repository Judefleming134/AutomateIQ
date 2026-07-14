import "server-only";

/**
 * Voice Agent ↔ ElevenLabs sync. The portal is where a customer edits what
 * their receptionist says; this pushes those edits to the live ElevenLabs
 * Conversational AI agent so a change takes effect on the very next call —
 * no manual copy-paste into the ElevenLabs dashboard.
 *
 * Best-effort by contract: the portal has already saved the edit to our own
 * DB (the source of truth) before this runs, so a sync failure never loses
 * the customer's change — it just means the live agent is briefly behind.
 */

export type VoiceAgentFields = {
  greeting: string;
  services: string;
  businessHours: string;
  serviceArea: string;
  knowledge: string;
};

/**
 * Builds the agent's system prompt from the customer-editable fields. Kept
 * deliberately close to a good receptionist brief: identity, tone, what the
 * business does, the details to collect, and hard rules that keep an
 * unattended agent safe (never quote prices, never invent availability).
 */
export function composeVoiceAgentPrompt(
  businessName: string,
  f: VoiceAgentFields
): string {
  const name = businessName.trim() || "the business";
  const lines = [
    `# Role`,
    `You are the phone receptionist for ${name}, answering calls the team can't get to. Your only job: get the caller's details and either book them in or take a message — quickly — so no job is lost.`,
    ``,
    `# How you speak`,
    `- Direct and efficient. Polite, but not chatty — a busy front desk, not a customer-service script.`,
    `- Ask ONE short question at a time. Never stack questions or over-explain.`,
    `- No filler. Never say "I'd be happy to help", "Great question", "Absolutely", "Of course!". Just move the call forward.`,
    `- Natural spoken English — contractions, plain words. Never sound like you're reading a form.`,
    `- Acknowledge in one or two words ("Got it.", "Right."), then ask the next thing.`,
    ``,
    f.services.trim() ? `# ${name} — services\n${f.services.trim()}` : "",
    f.businessHours.trim() ? `# Hours\n${f.businessHours.trim()}` : "",
    f.serviceArea.trim() ? `# Service area\n${f.serviceArea.trim()}` : "",
    ``,
    `# What to get — one at a time, in this order:`,
    `1. Their name.`,
    `2. The problem — what's wrong.`,
    `3. The address or area.`,
    `4. Best phone number (read it back once to confirm).`,
    `5. How urgent — emergency, today, or this week.`,
    `If it's not an emergency, ask for a preferred day or time. Then confirm the key details back in ONE line and tell them the team will call to confirm. Then end.`,
    ``,
    `# Hard rules — never break these:`,
    `- Never quote or estimate a price. Say "That depends on the job — the team will confirm," then take the details.`,
    `- Never promise a specific time or that someone is available. The team confirms on the callback.`,
    `- If you don't know something, say so and take a message — never guess.`,
    `- Only handle enquiries for ${name}. Politely decline anything else.`,
    ``,
    f.knowledge.trim() ? `# Good to know\n${f.knowledge.trim()}` : "",
    ``,
    `# Ending`,
    `Close in one line and stop — e.g. "Thanks, we've got your details and the team will be in touch shortly." Don't linger or repeat yourself.`,
  ];
  return lines.filter((l) => l !== "").join("\n");
}

/**
 * Pushes the composed prompt + greeting to the ElevenLabs agent. Returns a
 * plain result — callers surface a soft notice, never a hard failure, since
 * the DB save has already succeeded. A missing API key or agent id is a
 * no-op "not connected yet", not an error.
 *
 * NOTE: uses the ElevenLabs Conversational AI "update agent" endpoint
 * (PATCH /v1/convai/agents/{id}, conversation_config.agent.prompt.prompt +
 * first_message). Confirm the exact field path against current ElevenLabs
 * docs when wiring the first live agent.
 */
export async function syncVoiceAgentKnowledge(
  agentId: string | null | undefined,
  businessName: string,
  fields: VoiceAgentFields
): Promise<{ synced: boolean; detail: string }> {
  // Trim: a trailing space or newline picked up when the key was pasted into
  // Vercel is invisible but makes ElevenLabs reject it with a 401
  // "invalid_api_key" — the single most common cause of "I redid the key and
  // it still won't authenticate".
  const apiKey = process.env.ELEVENLABS_API_KEY?.trim();
  if (!apiKey) return { synced: false, detail: "no ELEVENLABS_API_KEY configured" };
  if (!agentId) return { synced: false, detail: "no agent linked yet" };

  const body = {
    conversation_config: {
      agent: {
        first_message: fields.greeting.trim() || undefined,
        prompt: { prompt: composeVoiceAgentPrompt(businessName, fields) },
      },
    },
  };

  try {
    const res = await fetch(
      `https://api.elevenlabs.io/v1/convai/agents/${encodeURIComponent(agentId)}`,
      {
        method: "PATCH",
        headers: {
          "xi-api-key": apiKey,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(12_000),
      }
    );
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { synced: false, detail: `ElevenLabs ${res.status}: ${text.slice(0, 200)}` };
    }
    return { synced: true, detail: "agent updated" };
  } catch (err) {
    return {
      synced: false,
      detail: err instanceof Error ? err.message : "sync request failed",
    };
  }
}
