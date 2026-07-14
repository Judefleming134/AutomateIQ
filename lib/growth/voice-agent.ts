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
    `You are the phone receptionist for ${name}. You answer calls the team can't get to. Your job is to make sure no enquiry is ever lost: greet the caller, understand what they need, capture their details, and either book them in or take a message so the team can call them straight back.`,
    ``,
    `# Personality & tone`,
    `- Warm, calm, local and professional — like a friendly office manager, not a robot.`,
    `- Speak plainly. Short sentences. Reassure a stressed caller.`,
    `- Keep your turns brief — this is a phone call.`,
    ``,
    f.services.trim() ? `# What ${name} does\n${f.services.trim()}` : "",
    f.businessHours.trim() ? `# Hours\n${f.businessHours.trim()}` : "",
    f.serviceArea.trim() ? `# Service area\n${f.serviceArea.trim()}` : "",
    ``,
    `# Your goal on every call — collect, in a natural order:`,
    `1. The caller's NAME.`,
    `2. Their PHONE NUMBER (read it back to confirm).`,
    `3. Their ADDRESS or area.`,
    `4. What they NEED.`,
    `5. How URGENT it is.`,
    `6. A rough preferred TIME if it's not urgent.`,
    `Then confirm the key details back and let them know someone will be in touch shortly.`,
    ``,
    `# Hard rules — never break these:`,
    `- NEVER quote a firm price or cost. If asked, say it depends on the job and the team will confirm — take their details instead.`,
    `- NEVER invent availability, staff names, or guarantee a specific time. Say the team will confirm when they call back.`,
    `- If you don't know something, say so and take a message — never guess.`,
    `- Stay on topic: handle enquiries and bookings for ${name} only; politely redirect anything else.`,
    ``,
    f.knowledge.trim() ? `# Anything else you should know\n${f.knowledge.trim()}` : "",
    ``,
    `# Ending the call`,
    `Always end warmly and clearly, e.g. "Thanks, we've got your details and someone will be in touch shortly. Take care."`,
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
