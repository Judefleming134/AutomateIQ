"use server";

import { revalidatePath } from "next/cache";
import { requireGrowth, loadGrowthSettings } from "@/lib/growth/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { draftOutreach, draftStudioMessage } from "@/lib/growth/ai";
import { sendOutreachEmail } from "@/lib/growth/email";
import { NO_PROVIDER_MESSAGE } from "@/lib/ai/config";
import type { ResearchReport } from "@/lib/growth/research";
import {
  CHANNELS,
  OBJECTIVES,
  PURPOSES,
  TONES,
  type Channel,
  type MessageObjective,
  type MessagePurpose,
  type StudioTransform,
  type Tone,
} from "@/lib/growth/constants";

type Result = { ok?: boolean; error?: string } | undefined;

function revalidateProspect(prospectId: string) {
  revalidatePath(`/growth/prospects/${prospectId}`);
  revalidatePath("/growth/inbox");
  revalidatePath("/growth/prospects");
}

async function loadProspect(prospectId: string) {
  const admin = createAdminClient();
  const { data } = await admin
    .from("ge_prospects")
    .select(
      "id, company, contact_name, job_title, industry, website, location, notes, email, status, campaign_id"
    )
    .eq("id", prospectId)
    .maybeSingle();
  return data;
}

/**
 * Marks outreach as having gone out: message row + prospect bookkeeping +
 * the automatic follow-up. Sending moves new/researched prospects to
 * "Contacted" and schedules a follow-up reminder 3 days out, so the
 * dashboard chases the reply without anyone having to remember to.
 */
async function recordOutreachSent(
  prospect: { id: string; status: string },
  messageId: string,
  channel: string,
  memberName: string,
  memberId: string,
  purpose?: string | null
) {
  const admin = createAdminClient();
  await admin
    .from("ge_messages")
    .update({ status: "sent", sent_at: new Date().toISOString() })
    .eq("id", messageId);
  const bump: Record<string, unknown> = {
    last_contact_at: new Date().toISOString(),
    next_follow_up_at: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10),
  };
  // First outreach → Contacted; chasing an unanswered prospect (or sending
  // an explicit follow-up draft) → Follow-up sent. Later stages (replied,
  // qualified, …) are never regressed by sending another message.
  if (
    ["new", "researching", "research_complete", "outreach_ready"].includes(
      prospect.status
    )
  ) {
    bump.status = "contacted";
  } else if (
    ["contacted", "follow_up_sent"].includes(prospect.status) ||
    (purpose && ["follow_up", "second_follow_up"].includes(purpose) &&
      !["replied", "qualified", "meeting_booked", "proposal_in_progress",
        "proposal_sent", "negotiation", "won"].includes(prospect.status))
  ) {
    bump.status = "follow_up_sent";
  }
  await admin.from("ge_prospects").update(bump).eq("id", prospect.id);
  await admin.from("ge_activities").insert({
    prospect_id: prospect.id,
    type: channel,
    content:
      channel === "call"
        ? `Call made by ${memberName} — follow-up scheduled in 3 days`
        : `Outreach sent via ${channel} by ${memberName} — follow-up scheduled in 3 days`,
    created_by: memberId,
  });
}

/**
 * AI drafting for the composer — returns the draft for the user to review
 * and edit. Nothing is stored or sent here.
 */
export async function draftGrowthMessage(input: {
  prospectId: string;
  channel: Channel;
  objective: MessageObjective;
  tone: Tone;
  instructions?: string;
  replyContext?: string;
}): Promise<
  | { ok: true; subject: string | null; body: string }
  | { ok: false; error: string }
> {
  await requireGrowth();
  if (
    !CHANNELS.includes(input.channel) ||
    !OBJECTIVES.includes(input.objective) ||
    !TONES.includes(input.tone)
  ) {
    return { ok: false, error: "Invalid draft options." };
  }

  const prospect = await loadProspect(input.prospectId);
  if (!prospect) return { ok: false, error: "Prospect not found." };

  const settings = await loadGrowthSettings();
  try {
    const draft = await draftOutreach(
      prospect,
      {
        channel: input.channel,
        objective: input.objective,
        tone: input.tone,
        instructions: input.instructions?.slice(0, 1000),
        replyContext: input.replyContext?.slice(0, 4000),
      },
      settings.bookingUrl
    );
    return { ok: true, ...draft };
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    if (message === "NO_PROVIDER") return { ok: false, error: NO_PROVIDER_MESSAGE };
    return { ok: false, error: "Drafting failed — try again in a moment." };
  }
}

/**
 * The composer's single dispatch point. Every message is human-reviewed
 * text from the composer textarea — the AI never sends anything itself.
 *   draft      → saved for later
 *   queue      → in the outreach queue (optionally scheduled)
 *   send_email → sent NOW through Resend (email channel only)
 *   mark_sent  → recorded as sent manually in LinkedIn/Instagram/SMS
 */
export async function composeMessage(input: {
  prospectId: string;
  channel: Channel;
  subject?: string | null;
  body: string;
  mode: "draft" | "queue" | "send_email" | "mark_sent";
  scheduledAt?: string | null;
  purpose?: MessagePurpose;
  tone?: Tone;
  /** Update this existing draft row instead of creating a new message. */
  messageId?: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const { member } = await requireGrowth();
  if (!CHANNELS.includes(input.channel)) {
    return { ok: false, error: "Invalid channel." };
  }
  const body = input.body.trim();
  if (!body) return { ok: false, error: "The message is empty." };

  const prospect = await loadProspect(input.prospectId);
  if (!prospect) return { ok: false, error: "Prospect not found." };
  if (input.mode === "send_email") {
    if (input.channel !== "email") {
      return { ok: false, error: "Direct sending is only available for email." };
    }
    if (!prospect.email) {
      return { ok: false, error: "This prospect has no email address on file." };
    }
  }

  const admin = createAdminClient();
  const subject =
    input.channel === "email"
      ? (input.subject ?? "").trim() || `A quick idea for ${prospect.company}`
      : null;

  const row = {
    prospect_id: prospect.id,
    campaign_id: prospect.campaign_id,
    channel: input.channel,
    direction: "outbound" as const,
    status: input.mode === "queue" ? "queued" : "draft",
    subject,
    body: body.slice(0, 10000),
    scheduled_at: input.mode === "queue" ? input.scheduledAt || null : null,
    purpose: input.purpose && PURPOSES.includes(input.purpose) ? input.purpose : null,
    tone: input.tone && TONES.includes(input.tone) ? input.tone : null,
    created_by: member.id,
  };

  let message: { id: string };
  if (input.messageId) {
    // Studio flow: the row already exists as a draft — update it in place so
    // the same draft doesn't multiply every time it's edited or sent.
    const { data: existing } = await admin
      .from("ge_messages")
      .select("id, status, direction")
      .eq("id", input.messageId)
      .eq("prospect_id", prospect.id)
      .maybeSingle();
    if (!existing || existing.direction !== "outbound") {
      return { ok: false, error: "Draft not found." };
    }
    if (!["draft", "queued", "failed"].includes(existing.status)) {
      return { ok: false, error: "That message was already sent." };
    }
    const { error } = await admin
      .from("ge_messages")
      .update(row)
      .eq("id", input.messageId);
    if (error) return { ok: false, error: error.message };
    message = { id: input.messageId };
  } else {
    const { data: created, error } = await admin
      .from("ge_messages")
      .insert(row)
      .select("id")
      .single();
    if (error) return { ok: false, error: error.message };
    message = created;
  }

  if (input.mode === "send_email") {
    const sent = await sendOutreachEmail({
      to: prospect.email!,
      subject: subject!,
      body,
    });
    if (!sent.ok) {
      await admin.from("ge_messages").update({ status: "failed" }).eq("id", message.id);
      revalidateProspect(prospect.id);
      return { ok: false, error: `Email failed: ${sent.error}` };
    }
    await recordOutreachSent(prospect, message.id, "email", member.name, member.id, input.purpose);
  } else if (input.mode === "mark_sent") {
    await recordOutreachSent(prospect, message.id, input.channel, member.name, member.id, input.purpose);
  }

  revalidateProspect(prospect.id);
  return { ok: true };
}

/** Sends a queued/draft EMAIL message from the queue view. */
export async function sendQueuedEmail(_prev: Result, formData: FormData): Promise<Result> {
  const { member } = await requireGrowth();
  const id = String(formData.get("message_id") ?? "");
  const admin = createAdminClient();

  const { data: message } = await admin
    .from("ge_messages")
    .select("id, prospect_id, channel, subject, body, status, direction, purpose")
    .eq("id", id)
    .maybeSingle();
  if (!message || message.direction !== "outbound") return { error: "Message not found." };
  if (!["draft", "queued", "failed"].includes(message.status)) {
    return { error: "Already sent." };
  }
  if (message.channel !== "email") {
    return { error: "Only email can be sent directly — copy the text and mark as sent instead." };
  }

  const prospect = await loadProspect(message.prospect_id);
  if (!prospect?.email) return { error: "This prospect has no email address on file." };

  const sent = await sendOutreachEmail({
    to: prospect.email,
    subject: message.subject || `A quick idea for ${prospect.company}`,
    body: message.body,
  });
  if (!sent.ok) {
    await admin.from("ge_messages").update({ status: "failed" }).eq("id", id);
    revalidateProspect(prospect.id);
    return { error: `Email failed: ${sent.error}` };
  }

  await recordOutreachSent(prospect, id, "email", member.name, member.id, message.purpose);
  revalidateProspect(prospect.id);
  return { ok: true };
}

/** LinkedIn / Instagram / SMS: sent manually in the platform, recorded here. */
export async function markMessageSent(_prev: Result, formData: FormData): Promise<Result> {
  const { member } = await requireGrowth();
  const id = String(formData.get("message_id") ?? "");
  const admin = createAdminClient();

  const { data: message } = await admin
    .from("ge_messages")
    .select("id, prospect_id, channel, status, direction, purpose")
    .eq("id", id)
    .maybeSingle();
  if (!message || message.direction !== "outbound") return { error: "Message not found." };
  if (!["draft", "queued", "failed"].includes(message.status)) {
    return { error: "Already sent." };
  }

  const prospect = await loadProspect(message.prospect_id);
  if (!prospect) return { error: "Prospect not found." };

  await recordOutreachSent(prospect, id, message.channel, member.name, member.id, message.purpose);
  revalidateProspect(prospect.id);
  return { ok: true };
}

export async function deleteMessage(_prev: Result, formData: FormData): Promise<Result> {
  await requireGrowth();
  const id = String(formData.get("message_id") ?? "");
  const admin = createAdminClient();

  const { data: message } = await admin
    .from("ge_messages")
    .select("id, prospect_id, status")
    .eq("id", id)
    .maybeSingle();
  if (!message) return { error: "Message not found." };
  if (!["draft", "queued", "failed"].includes(message.status)) {
    return { error: "Sent and received messages are the conversation record — they can't be deleted." };
  }

  await admin.from("ge_messages").delete().eq("id", id);
  revalidateProspect(message.prospect_id);
  return { ok: true };
}

/**
 * Message Studio drafting: generates or transforms (improve / rewrite /
 * shorten / expand) a draft grounded in the saved company research. Returns
 * text for the editable studio box — stores and sends nothing itself.
 */
export async function studioDraft(input: {
  prospectId: string;
  channel: Channel;
  purpose: MessagePurpose;
  tone: Tone;
  currentText?: string;
  transform?: StudioTransform;
}): Promise<
  | { ok: true; subject: string | null; body: string }
  | { ok: false; error: string }
> {
  await requireGrowth();
  if (
    !CHANNELS.includes(input.channel) ||
    !PURPOSES.includes(input.purpose) ||
    !TONES.includes(input.tone) ||
    (input.transform &&
      !["improve", "rewrite", "shorten", "expand"].includes(input.transform))
  ) {
    return { ok: false, error: "Invalid draft options." };
  }
  if (input.transform && !input.currentText?.trim()) {
    return { ok: false, error: "Write or generate a draft first." };
  }

  const prospect = await loadProspect(input.prospectId);
  if (!prospect) return { ok: false, error: "Prospect not found." };

  const admin = createAdminClient();
  const { data: research } = await admin
    .from("ge_research")
    .select("report")
    .eq("prospect_id", input.prospectId)
    .maybeSingle();

  const settings = await loadGrowthSettings();
  try {
    const draft = await draftStudioMessage(
      prospect,
      (research?.report as ResearchReport | undefined) ?? null,
      {
        channel: input.channel,
        purpose: input.purpose,
        tone: input.tone,
        currentText: input.currentText?.slice(0, 6000),
        transform: input.transform,
      },
      settings.bookingUrl
    );
    return { ok: true, ...draft };
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    if (message === "NO_PROVIDER") return { ok: false, error: NO_PROVIDER_MESSAGE };
    return { ok: false, error: "Drafting failed — try again in a moment." };
  }
}

/** Saves the current studio draft as a reusable template (Settings → Templates). */
export async function saveStudioTemplate(input: {
  name: string;
  channel: Channel;
  purpose: MessagePurpose;
  subject?: string | null;
  body: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireGrowth();
  const name = input.name.trim().slice(0, 200);
  const body = input.body.trim().slice(0, 10000);
  if (!name || !body) return { ok: false, error: "Template needs a name and a body." };
  if (!CHANNELS.includes(input.channel) || !PURPOSES.includes(input.purpose)) {
    return { ok: false, error: "Invalid template options." };
  }

  // Studio purposes → the template categories the DB already knows.
  const category: Record<MessagePurpose, string> = {
    first: "initial",
    follow_up: "follow_up",
    second_follow_up: "follow_up",
    meeting_confirmation: "confirmation",
    thank_you: "reply",
  };

  const admin = createAdminClient();
  const { error } = await admin.from("ge_templates").insert({
    name,
    channel: input.channel,
    category: category[input.purpose],
    subject: input.subject?.trim().slice(0, 300) || null,
    body,
  });
  if (error) {
    return {
      ok: false,
      error: error.message.includes("duplicate")
        ? "A template with that name already exists."
        : error.message,
    };
  }
  revalidatePath("/growth/settings");
  return { ok: true };
}

/** Logs a reply the prospect sent us on any channel, with a sentiment tag. */
export async function logInboundMessage(_prev: Result, formData: FormData): Promise<Result> {
  const { member } = await requireGrowth();
  const prospectId = String(formData.get("prospect_id") ?? "");
  const channel = String(formData.get("channel") ?? "");
  const sentiment = String(formData.get("sentiment") ?? "neutral");
  const body = String(formData.get("body") ?? "").trim();

  if (!body) return { error: "Paste their message first." };
  if (!(CHANNELS as string[]).includes(channel)) return { error: "Invalid channel." };
  if (!["positive", "neutral", "negative"].includes(sentiment)) {
    return { error: "Invalid sentiment." };
  }

  const prospect = await loadProspect(prospectId);
  if (!prospect) return { error: "Prospect not found." };

  const admin = createAdminClient();
  const { error } = await admin.from("ge_messages").insert({
    prospect_id: prospect.id,
    campaign_id: prospect.campaign_id,
    channel,
    direction: "inbound",
    status: "received",
    body: body.slice(0, 10000),
    sentiment,
    created_by: member.id,
  });
  if (error) return { error: error.message };

  if (
    ["new", "researching", "research_complete", "outreach_ready",
     "contacted", "follow_up_sent"].includes(prospect.status)
  ) {
    await admin.from("ge_prospects").update({ status: "replied" }).eq("id", prospect.id);
  }

  revalidateProspect(prospect.id);
  return { ok: true };
}
