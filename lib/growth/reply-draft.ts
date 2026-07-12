import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { draftOutreach, type ProspectContext } from "@/lib/growth/ai";
import { loadGrowthSettings } from "@/lib/growth/auth";
import { sanitizeOutreachBody, draftLooksBroken } from "@/lib/growth/email";

/**
 * Best-effort auto-draft of a suggested reply to a prospect's inbound message.
 * Shared by BOTH reply-capture paths — the inbound-email webhook and the manual
 * "Log their reply" action — so a suggested response is waiting in the Studio
 * however the reply arrived, without depending on the email forwarder being set
 * up. Email only (that's where drafting adds the most; DMs are quick to answer).
 *
 * Contract (never violated):
 * - Produces a DRAFT only. Nothing is ever sent from here.
 * - Gated by the same draftLooksBroken check as every other draft path.
 * - Only ever one suggested reply per prospect at a time — a forwarder retry or
 *   a second inbound message never stacks drafts.
 * - Returns false and swallows on any failure; the captured reply is what
 *   matters, the draft is a bonus.
 */
export async function autoDraftReply(
  admin: SupabaseClient,
  prospect: ProspectContext & { id: string; campaign_id: string | null },
  inboundText: string,
  createdBy: string | null
): Promise<boolean> {
  try {
    const { data: pending } = await admin
      .from("ge_messages")
      .select("id")
      .eq("prospect_id", prospect.id)
      .eq("channel", "email")
      .eq("direction", "outbound")
      .eq("purpose", "reply")
      .eq("status", "draft")
      .limit(1)
      .maybeSingle();
    if (pending) return false;

    const settings = await loadGrowthSettings();
    const draft = await draftOutreach(
      {
        company: prospect.company,
        contact_name: prospect.contact_name,
        job_title: prospect.job_title,
        industry: prospect.industry,
        website: prospect.website,
        location: prospect.location,
        notes: prospect.notes,
      },
      {
        channel: "email",
        objective: "reply",
        tone: "professional",
        replyContext: inboundText.slice(0, 4000),
      },
      settings.bookingUrl
    );
    const clean = sanitizeOutreachBody(draft.body);
    if (draftLooksBroken(clean)) return false;

    await admin.from("ge_messages").insert({
      prospect_id: prospect.id,
      campaign_id: prospect.campaign_id,
      channel: "email",
      direction: "outbound",
      status: "draft",
      purpose: "reply",
      tone: "professional",
      subject: draft.subject,
      body: clean,
      created_by: createdBy,
    });
    await admin.from("ge_activities").insert({
      prospect_id: prospect.id,
      type: "system",
      content:
        "Jarvis: drafted a suggested reply to their message — ready to review and send in the inbox",
      created_by: createdBy,
    });
    return true;
  } catch {
    // Drafting is a bonus; the captured reply is what matters. Swallow.
    return false;
  }
}
