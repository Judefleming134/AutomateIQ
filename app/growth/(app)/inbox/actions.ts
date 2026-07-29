"use server";

import { revalidatePath } from "next/cache";
import { requireGrowth, loadGrowthSettings } from "@/lib/growth/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { draftOutreach, draftStudioMessage } from "@/lib/growth/ai";
import { sendOutreachEmail, sanitizeOutreachBody, draftLooksBroken } from "@/lib/growth/email";
import { recordOutreachSent, outreachHistoryLines } from "@/lib/growth/outreach";
import { COLD_PURPOSES, PRE_REPLY_STATUSES } from "@/lib/growth/autopilot";
import { autoDraftReply } from "@/lib/growth/reply-draft";
import { dublinDate } from "@/lib/growth/dates";
import { pricingLines } from "@/lib/growth/pricing";
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
  // Keep the DM worklist fresh — a sent message drops that prospect off it.
  revalidatePath("/growth/dms");
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

  // Ground the draft in the saved research, same as the Studio — without it
  // the composer wrote generic messages for fully-researched prospects.
  const { data: research } = await createAdminClient()
    .from("ge_research")
    .select("report")
    .eq("prospect_id", prospect.id)
    .maybeSingle();

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
      settings.bookingUrl,
      (research?.report as ResearchReport | undefined) ?? null
    );
    return { ok: true, ...draft };
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    if (message === "NO_PROVIDER") return { ok: false, error: NO_PROVIDER_MESSAGE };
    if (message.startsWith("HTTP 429")) {
      return { ok: false, error: "AI rate limit — wait a minute and try again." };
    }
    if (/^HTTP 5\d\d/.test(message)) {
      return { ok: false, error: "AI service briefly overloaded — try again in a minute." };
    }
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
}): Promise<{ ok: true; messageId: string } | { ok: false; error: string }> {
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
      ? (input.subject ?? "").trim() || `question about ${prospect.company}`
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
    // Same hard broken-draft guard the autopilot and queue Send button run:
    // a leftover [placeholder], invented sender name or made-up job title must
    // never reach a real prospect. The row stays a draft, ready to fix.
    const broken = draftLooksBroken(sanitizeOutreachBody(body));
    if (broken) {
      revalidateProspect(prospect.id);
      return { ok: false, error: `Not sent — ${broken}. Regenerate the draft first.` };
    }
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
  // Return the row id so the composer can keep editing the SAME draft instead
  // of creating a duplicate on the next save.
  return { ok: true, messageId: message.id };
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

  // Same reply-race gate as the 8am autopilot: if they replied (or booked,
  // opted out…) AFTER this cold touch was queued, sending it now reads as
  // ignoring what they wrote. Deliberate sends (replies, confirmations) pass.
  if (
    COLD_PURPOSES.includes(message.purpose as string | null) &&
    !PRE_REPLY_STATUSES.includes(prospect.status)
  ) {
    return {
      error: `Held — ${prospect.company} is now '${prospect.status}', so this queued cold touch looks stale. Check the conversation first; reply from there instead.`,
    };
  }

  // Same hard broken-draft guard the 8am autopilot runs: a leftover
  // [placeholder], an invented sender name or a made-up job title must never
  // reach a real prospect — even via the manual Send button. Regenerate in
  // the Studio to clear it. (Length/subject nits are left to the sender's
  // judgement here; this only blocks the unambiguously-broken.)
  // SEND THE TEXT THE GATE CHECKED: the broken-check runs on the sanitized
  // body, so sending the raw one could deliver the very placeholder the
  // sanitizer quietly fixed. Store it too, so history shows what went out.
  const cleanBody = sanitizeOutreachBody(message.body);
  const broken = draftLooksBroken(cleanBody);
  if (broken) {
    return { error: `Not sent — ${broken}. Regenerate the draft in the Studio first.` };
  }
  if (cleanBody !== message.body) {
    await admin.from("ge_messages").update({ body: cleanBody }).eq("id", id);
  }

  const sent = await sendOutreachEmail({
    to: prospect.email,
    subject: message.subject || `question about ${prospect.company}`,
    body: cleanBody,
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
    .select("id, prospect_id, channel, status, direction, purpose, body")
    .eq("id", id)
    .maybeSingle();
  if (!message || message.direction !== "outbound") return { error: "Message not found." };
  if (!["draft", "queued", "failed"].includes(message.status)) {
    return { error: "Already sent." };
  }

  const prospect = await loadProspect(message.prospect_id);
  if (!prospect) return { error: "Prospect not found." };

  // The DM list copies the SANITIZED text (placeholders quietly fixed) — store
  // that same text as the sent record, so the conversation history shows what
  // was actually pasted, not the raw draft.
  const clean = sanitizeOutreachBody(String(message.body ?? ""));
  if (clean !== message.body) {
    await admin.from("ge_messages").update({ body: clean }).eq("id", id);
  }

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
  const [{ data: research }, history] = await Promise.all([
    admin
      .from("ge_research")
      .select("report, solutions")
      .eq("prospect_id", input.prospectId)
      .maybeSingle(),
    // The REAL sent messages — so a call script's opener or a chase can
    // reference the actual email/DM that went out, not an invented touch.
    outreachHistoryLines(admin, input.prospectId),
  ]);

  const settings = await loadGrowthSettings();
  const solutionKeys = Array.isArray(research?.solutions)
    ? (research!.solutions as { key?: string }[])
        .map((s) => s.key)
        .filter((k): k is string => Boolean(k))
    : [];
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
      settings.bookingUrl,
      pricingLines(solutionKeys),
      history
    );
    return { ok: true, ...draft };
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    if (message === "NO_PROVIDER") return { ok: false, error: NO_PROVIDER_MESSAGE };
    if (message.startsWith("HTTP 429")) {
      return { ok: false, error: "AI rate limit — wait a minute and try again." };
    }
    if (/^HTTP 5\d\d/.test(message)) {
      return { ok: false, error: "AI service briefly overloaded — try again in a minute." };
    }
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
    reply: "reply",
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

  // The SHARED pre-reply list, not a hand-rolled copy. The inbound-email
  // webhook was moved onto PRE_REPLY_STATUSES because its own copy of this
  // list was missing research_failed; this path — Jude pasting in a DM or text
  // reply by hand — kept the stale copy and the same hole. A prospect parked in
  // the Research-failed group who then REPLIED stayed parked: never advanced to
  // "replied", so they kept counting as "needs a research retry" instead of
  // "they answered you", and the conversation didn't surface as one.
  if (PRE_REPLY_STATUSES.includes(prospect.status)) {
    // A reply resets the clock: answer within a day, not on the old +3-day
    // chase schedule. But a NEGATIVE reply ("not interested", "remove me")
    // must NOT schedule an automatic chase — clear the follow-up so the
    // engine never nudges Jude to pester someone who just declined. It still
    // moves to "replied" so the conversation stays visible in the inbox.
    await admin
      .from("ge_prospects")
      .update({
        status: "replied",
        next_follow_up_at: sentiment === "negative" ? null : dublinDate(1),
      })
      .eq("id", prospect.id);
  }

  // Same courtesy as the auto-capture webhook: leave a suggested email reply
  // waiting in the Studio. Email only — DMs are quick enough to answer live.
  if (channel === "email") {
    await autoDraftReply(admin, prospect, body, member.id);
  }

  revalidateProspect(prospect.id);
  return { ok: true };
}
