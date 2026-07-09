"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/require-session";
import { requireProductEnabled } from "@/lib/auth/require-product";
import { createClient } from "@/lib/supabase/server";
import { isMissingTableError } from "@/lib/db/errors";
import { syncVoiceAgentKnowledge } from "@/lib/growth/voice-agent";

const SETUP_PENDING =
  "Your Voice Agent is still being set up — please try again shortly.";

type ActionResult = { ok?: boolean; error?: string } | undefined;

const configSchema = z.object({
  greeting: z.string().trim().max(300).optional(),
  services: z.string().trim().max(2000).optional(),
  businessHours: z.string().trim().max(500).optional(),
  serviceArea: z.string().trim().max(500).optional(),
  knowledge: z.string().trim().max(8000).optional(),
});

/**
 * Saves the customer-editable knowledge base for their receptionist. The
 * status and phone number are set by AutomateIQ (admin/service-role) when
 * the line is provisioned — the customer edits only what the agent SAYS,
 * never whether it's live, so a bad edit can't take their line down.
 * Upserts because a business may open the page before its config row exists.
 */
export async function updateVoiceConfig(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const { profile } = await requireSession();
  // Belt-and-braces: the layout guards the page, but a Server Action is its
  // own entry point, so re-check entitlement before writing.
  if (!(await requireProductEnabled(profile.business_id!, "voice-agent"))) {
    return { error: "Voice Agent is not enabled on this account." };
  }

  const parsed = configSchema.safeParse({
    greeting: formData.get("greeting"),
    services: formData.get("services"),
    businessHours: formData.get("businessHours"),
    serviceArea: formData.get("serviceArea"),
    knowledge: formData.get("knowledge"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const supabase = await createClient();
  // RLS scopes this to the caller's own business; onConflict keeps it to a
  // single row per business (business_id is the primary key).
  const { error } = await supabase.from("va_config").upsert(
    {
      business_id: profile.business_id!,
      greeting: parsed.data.greeting ?? "",
      services: parsed.data.services ?? "",
      business_hours: parsed.data.businessHours ?? "",
      service_area: parsed.data.serviceArea ?? "",
      knowledge: parsed.data.knowledge ?? "",
      updated_at: new Date().toISOString(),
    },
    { onConflict: "business_id" }
  );
  if (error) {
    return { error: isMissingTableError(error) ? SETUP_PENDING : error.message };
  }

  // Push the edit to the live ElevenLabs agent so it takes effect on the next
  // call. Best-effort: the DB (our source of truth) is already saved, so a
  // sync hiccup never loses the change — it's logged, not surfaced as a
  // failure. A no-op when the agent isn't linked yet or no API key is set.
  const [{ data: biz }, { data: cfg }] = await Promise.all([
    supabase.from("businesses").select("name").eq("id", profile.business_id!).maybeSingle(),
    supabase
      .from("va_config")
      .select("elevenlabs_agent_id")
      .eq("business_id", profile.business_id!)
      .maybeSingle(),
  ]);
  const sync = await syncVoiceAgentKnowledge(cfg?.elevenlabs_agent_id, biz?.name ?? "", {
    greeting: parsed.data.greeting ?? "",
    services: parsed.data.services ?? "",
    businessHours: parsed.data.businessHours ?? "",
    serviceArea: parsed.data.serviceArea ?? "",
    knowledge: parsed.data.knowledge ?? "",
  });
  if (!sync.synced) {
    console.error("Voice Agent ElevenLabs sync skipped/failed:", sync.detail);
  }

  revalidatePath("/portal/voice-agent");
  return { ok: true };
}

const ticketSchema = z.object({
  subject: z.string().trim().min(3, "Give the problem a short title").max(140),
  detail: z.string().trim().max(2000).optional(),
});

/**
 * "Log a problem" — the customer raises a support ticket about their
 * receptionist. Insert-only for customers (RLS); AutomateIQ moves it
 * through open → in_progress → resolved from the admin side.
 */
export async function logVoiceTicket(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const { profile } = await requireSession();
  if (!(await requireProductEnabled(profile.business_id!, "voice-agent"))) {
    return { error: "Voice Agent is not enabled on this account." };
  }

  const parsed = ticketSchema.safeParse({
    subject: formData.get("subject"),
    detail: formData.get("detail"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("va_tickets").insert({
    business_id: profile.business_id!,
    subject: parsed.data.subject,
    detail: parsed.data.detail ?? "",
  });
  if (error) {
    return { error: isMissingTableError(error) ? SETUP_PENDING : error.message };
  }

  revalidatePath("/portal/voice-agent");
  return { ok: true };
}
