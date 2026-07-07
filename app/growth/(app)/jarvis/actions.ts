"use server";

import { revalidatePath } from "next/cache";
import { requireGrowth } from "@/lib/growth/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendAutopilotEmail } from "@/lib/growth/autopilot";
import { sanitizeOutreachBody, draftLooksBroken } from "@/lib/growth/email";
import { studioDraft } from "../inbox/actions";
import { aiComplete } from "@/lib/ai/complete";
import { NO_PROVIDER_MESSAGE } from "@/lib/ai/config";
import { loadGrowthMetrics } from "@/lib/growth/metrics";
import { pricingLines } from "@/lib/growth/pricing";
import { SOLUTION_CATALOG } from "@/lib/growth/solutions";
import { dublinDate } from "@/lib/growth/dates";
import {
  PROSPECT_STATUS_META,
  type ProspectStatus,
} from "@/lib/growth/constants";

export type JarvisTurn = { role: "user" | "jarvis"; text: string };

type ActionResult = { ok?: boolean; error?: string } | undefined;

/** Structured response Jarvis returns: what to say + what to do. */
const JARVIS_SCHEMA = {
  type: "object",
  properties: {
    reply: { type: "string" },
    actions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          type: { type: "string" },
          company: { type: "string" },
          value: { type: "string" },
        },
        required: ["type", "company", "value"],
        additionalProperties: false,
      },
    },
  },
  required: ["reply", "actions"],
  additionalProperties: false,
} as const;

type JarvisAction = { type: string; company: string; value: string };

/** Finds the latest re-usable outbound email draft for a prospect. */
async function latestEmailDraft(
  admin: ReturnType<typeof createAdminClient>,
  prospectId: string
) {
  const { data } = await admin
    .from("ge_messages")
    .select("id, status, body")
    .eq("prospect_id", prospectId)
    .eq("channel", "email")
    .eq("direction", "outbound")
    .in("status", ["draft", "queued", "failed"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}

/**
 * Executes ONE whitelisted Jarvis action and returns a human-readable
 * result line. Deliberately narrow: Jarvis can prep and organise (rewrite
 * drafts, queue for the 8am run, notes, follow-up dates) but actual
 * sending stays with the autopilot's human-visible triggers.
 */
async function runJarvisAction(
  admin: ReturnType<typeof createAdminClient>,
  memberId: string,
  a: JarvisAction
): Promise<string> {
  const companyQuery = a.company.trim().replace(/[%_]/g, "");
  if (!companyQuery) return `✗ ${a.type}: no company given`;
  const { data: prospect } = await admin
    .from("ge_prospects")
    .select("id, company, notes")
    .ilike("company", companyQuery)
    .limit(1)
    .maybeSingle();
  if (!prospect) return `✗ ${a.company}: not found in the CRM`;

  switch (a.type) {
    case "regenerate_email": {
      const draft = await latestEmailDraft(admin, prospect.id);
      if (!draft) return `✗ ${prospect.company}: no email draft to rewrite`;
      const res = await studioDraft({
        prospectId: prospect.id,
        channel: "email",
        purpose: "first",
        tone: "professional",
      });
      if (!res.ok) return `✗ ${prospect.company}: ${res.error}`;
      const clean = sanitizeOutreachBody(res.body);
      const broken = draftLooksBroken(clean);
      if (broken) return `✗ ${prospect.company}: rewrite still ${broken} — needs the Studio`;
      await admin
        .from("ge_messages")
        .update({
          subject: res.subject,
          body: clean,
          tone: "professional",
          ...(draft.status === "failed" ? { status: "draft" } : {}),
        })
        .eq("id", draft.id);
      return `✓ ${prospect.company}: email draft rewritten`;
    }
    case "queue_email": {
      const draft = await latestEmailDraft(admin, prospect.id);
      if (!draft) return `✗ ${prospect.company}: no email draft to queue`;
      const broken = draftLooksBroken(sanitizeOutreachBody(draft.body));
      if (broken) return `✗ ${prospect.company}: draft is ${broken} — regenerate first`;
      await admin.from("ge_messages").update({ status: "queued" }).eq("id", draft.id);
      return `✓ ${prospect.company}: queued for the 8am send`;
    }
    case "add_note": {
      const note = a.value.trim().slice(0, 1000);
      if (!note) return `✗ ${prospect.company}: empty note`;
      const merged = prospect.notes ? `${prospect.notes}\n${note}` : note;
      await admin
        .from("ge_prospects")
        .update({ notes: merged.slice(0, 4000) })
        .eq("id", prospect.id);
      await admin.from("ge_activities").insert({
        prospect_id: prospect.id,
        type: "system",
        content: `Note added via Jarvis: ${note}`,
        created_by: memberId,
      });
      return `✓ ${prospect.company}: note saved`;
    }
    case "set_follow_up": {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(a.value)) {
        return `✗ ${prospect.company}: follow-up date must be YYYY-MM-DD`;
      }
      await admin
        .from("ge_prospects")
        .update({ next_follow_up_at: a.value })
        .eq("id", prospect.id);
      return `✓ ${prospect.company}: follow-up set for ${a.value}`;
    }
    default:
      return `✗ ${a.type}: not something I can do`;
  }
}

/**
 * Jarvis fixes its own flagged drafts: rewrites each old placeholder /
 * invented-name email with the Studio drafting pipeline (current identity
 * rules, catchy-subject rules, price book) and updates the draft in place.
 * Anything that still fails the safety check after regeneration is reported
 * for a manual pass — never silently sent.
 */
export async function regenerateFlaggedDrafts(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  await requireGrowth();
  const ids = formData
    .getAll("message_id")
    .map(String)
    .filter(Boolean)
    .slice(0, 12);
  if (ids.length === 0) return { error: "No flagged drafts to regenerate." };

  const admin = createAdminClient();
  let fixed = 0;
  const failures: string[] = [];
  for (const id of ids) {
    const { data: msg } = await admin
      .from("ge_messages")
      .select("id, prospect_id, status, direction, channel, ge_prospects(company)")
      .eq("id", id)
      .maybeSingle();
    if (
      !msg ||
      msg.direction !== "outbound" ||
      msg.channel !== "email" ||
      !["draft", "queued", "failed"].includes(msg.status)
    ) {
      continue;
    }
    const company =
      (msg.ge_prospects as { company?: string } | null)?.company ?? "unknown";
    const res = await studioDraft({
      prospectId: msg.prospect_id,
      channel: "email",
      purpose: "first",
      tone: "professional",
    });
    if (!res.ok) {
      failures.push(`${company}: ${res.error}`);
      continue;
    }
    const clean = sanitizeOutreachBody(res.body);
    const stillBroken = draftLooksBroken(clean);
    if (stillBroken) {
      failures.push(`${company}: rewrite still ${stillBroken} — do this one in the Studio`);
      continue;
    }
    await admin
      .from("ge_messages")
      .update({
        subject: res.subject,
        body: clean,
        tone: "professional",
        ...(msg.status === "failed" ? { status: "draft" } : {}),
      })
      .eq("id", id);
    fixed += 1;
  }

  revalidatePath("/growth/jarvis");
  revalidatePath("/growth/inbox");
  if (failures.length > 0) {
    return {
      error: `Rewrote ${fixed}/${ids.length}. Still needs you: ${failures.join("; ").slice(0, 350)}`,
    };
  }
  return { ok: true };
}

/**
 * Email autopilot controls. Two intents from the panel's submit buttons:
 *   send_now — fire the ticked emails immediately, one by one, with the
 *              same CRM bookkeeping as a manual send;
 *   queue    — park the ticked drafts as 'queued'; the daily 8am cron run
 *              sends them automatically.
 */
export async function autopilotAction(
  _prev: ActionResult,
  formData: FormData
): Promise<ActionResult> {
  const { member } = await requireGrowth();
  const intent = String(formData.get("intent") ?? "");
  const ids = formData
    .getAll("message_id")
    .map(String)
    .filter(Boolean)
    .slice(0, 25);
  if (ids.length === 0) return { error: "Tick at least one email first." };

  const admin = createAdminClient();

  if (intent === "queue") {
    const { error } = await admin
      .from("ge_messages")
      .update({ status: "queued" })
      .in("id", ids)
      .eq("channel", "email")
      .eq("direction", "outbound")
      .eq("status", "draft");
    if (error) return { error: error.message };
    revalidatePath("/growth/jarvis");
    revalidatePath("/growth/inbox");
    return { ok: true };
  }

  if (intent !== "send_now") return { error: "Unknown action." };

  let sent = 0;
  const failures: string[] = [];
  for (const id of ids) {
    const res = await sendAutopilotEmail({
      messageId: id,
      senderName: member.name,
      senderId: member.id,
    });
    if (res.ok) sent += 1;
    else failures.push(`${res.company} (${res.error})`);
    // Pace sends to stay inside the email provider's rate limit.
    await new Promise((r) => setTimeout(r, 600));
  }

  revalidatePath("/growth/jarvis");
  revalidatePath("/growth/prospects");
  revalidatePath("/growth/inbox");
  revalidatePath("/growth");

  if (failures.length > 0) {
    return {
      error: `Sent ${sent} of ${ids.length}. Failed: ${failures.join("; ").slice(0, 400)}`,
    };
  }
  return { ok: true };
}

export type JarvisResult =
  | { ok: true; answer: string }
  | { ok: false; error: string };

/**
 * Jarvis: a conversational operator over the LIVE pipeline. Every question
 * rebuilds a fresh snapshot server-side (prospects, funnel metrics, recent
 * replies, upcoming meetings) so the answer always reflects the CRM as it is
 * right now — nothing is cached, nothing is invented.
 */
export async function askJarvis(
  history: JarvisTurn[],
  question: string
): Promise<JarvisResult> {
  const { member } = await requireGrowth();
  const q = (question ?? "").trim().slice(0, 2000);
  if (!q) return { ok: false, error: "Ask me something." };

  const admin = createAdminClient();
  const today = dublinDate();

  const [metrics, week, { data: prospects }, { data: inbound }, { data: meetings }] =
    await Promise.all([
      loadGrowthMetrics(admin, null),
      loadGrowthMetrics(admin, 7),
      admin
        .from("ge_prospects")
        .select(
          "company, contact_name, status, industry, location, lead_score, pipeline_value, next_follow_up_at, last_contact_at, email, phone, instagram_url, facebook_url, linkedin_url, notes"
        )
        .order("lead_score", { ascending: false, nullsFirst: false })
        .limit(150),
      admin
        .from("ge_messages")
        .select("prospect_id, channel, body, sentiment, created_at, ge_prospects(company)")
        .eq("direction", "inbound")
        .order("created_at", { ascending: false })
        .limit(12),
      admin
        .from("ge_meetings")
        .select("scheduled_at, status, ge_prospects(company)")
        .eq("status", "booked")
        .gte("scheduled_at", new Date().toISOString())
        .order("scheduled_at")
        .limit(10),
    ]);

  const statusLabel = (s: string) =>
    PROSPECT_STATUS_META[s as ProspectStatus]?.label ?? s;

  const prospectLines = (prospects ?? [])
    .map((p) => {
      const bits = [
        p.company,
        statusLabel(p.status),
        `score ${p.lead_score ?? 0}`,
        p.industry || "industry?",
        p.location || null,
        p.next_follow_up_at ? `follow-up ${p.next_follow_up_at}` : null,
        p.last_contact_at ? `last contact ${p.last_contact_at.slice(0, 10)}` : "never contacted",
        Number(p.pipeline_value) > 0 ? `value €${p.pipeline_value}` : null,
        p.phone ? `☎ ${p.phone}` : null,
        p.email ? `✉ ${p.email}` : null,
        p.instagram_url ? `IG ${p.instagram_url}` : null,
        p.facebook_url ? `FB ${p.facebook_url}` : null,
        p.linkedin_url ? `LI ${p.linkedin_url}` : null,
        !p.phone && !p.email && !p.instagram_url && !p.facebook_url && !p.linkedin_url
          ? "no contact method on file"
          : null,
        p.notes ? `notes: ${String(p.notes).slice(0, 120)}` : null,
      ].filter(Boolean);
      return `- ${bits.join(" | ")}`;
    })
    .join("\n");

  const replyLines = (inbound ?? [])
    .map((m) => {
      const company =
        (m.ge_prospects as { company?: string } | null)?.company ?? "unknown";
      return `- ${m.created_at.slice(0, 10)} · ${company} via ${m.channel}${m.sentiment ? ` (${m.sentiment})` : ""}: "${String(m.body ?? "").slice(0, 200)}"`;
    })
    .join("\n");

  const meetingLines = (meetings ?? [])
    .map((m) => {
      const company =
        (m.ge_prospects as { company?: string } | null)?.company ?? "unknown";
      return `- ${m.scheduled_at} — ${company}`;
    })
    .join("\n");

  const system = [
    "You are Jarvis, the sales-operations copilot inside the AutomateIQ Growth Engine. Your one job: get Jude (solo founder of AutomateIQ, an Irish AI-automation agency, automateiq.ie) his next paying customer.",
    "Personality: sharp, direct, a little dry — an operator, not a cheerleader. Answer first, reasoning second. Short answers unless asked to go deep.",
    "HARD RULES:",
    "- Ground every claim in the DATA SNAPSHOT provided. Name real companies from it. If the data doesn't answer the question, say exactly what's missing — never invent prospects, numbers or replies.",
    "- Money figures may ONLY come from the price book below. Never make up a price. When asked what to quote a company, package its top 1-2 recommended solutions: setup total + monthly total, framed as the founding offer (first 10 customers only, then rates rise).",
    "- When asked what to do, give a concrete ordered action list referencing real prospects (who to call/DM/email and why), not generic advice. Include the actual phone number / email / social link from the snapshot next to each name so Jude can act without opening another screen.",
    "- Channels: email sends from the platform; Instagram/Facebook/LinkedIn DMs and phone calls are done by Jude personally — the engine preps drafts and call scripts. Never claim to have sent anything yourself.",
    "- YOU CAN ACT. When Jude asks you to do something, put it in the `actions` array (empty array when he's only asking a question). Action types, exactly these strings:",
    "  · regenerate_email — rewrite that prospect's email draft under current rules (value: empty string)",
    "  · queue_email — queue that prospect's clean email draft for the 8am autopilot send (value: empty string)",
    "  · add_note — save a note on the prospect (value: the note text)",
    "  · set_follow_up — set the follow-up date (value: YYYY-MM-DD)",
    "- Action rules: `company` must be copied EXACTLY from the snapshot; maximum 8 actions per turn; in `reply`, say plainly what you're doing. Actual sending is never yours — queueing is as far as you go; DMs/calls/mark-sent stay with Jude in the app.",
    "- LINKEDIN LOOKUPS: when asked who is on LinkedIn, first list prospects whose snapshot has an LI link (give the link). For promising prospects WITHOUT one, give a ready-made search link in the form https://www.linkedin.com/search/results/companies/?keywords=COMPANY%20Dublin (URL-encode spaces as %20) so Jude can check each with one tap — and say plainly that those are searches, not confirmed profiles.",
    "",
    "PRICE BOOK (founding-customer rates — the only figures permitted):",
    ...pricingLines(SOLUTION_CATALOG.map((s) => s.key)),
  ].join("\n");

  const convo = history
    .slice(-8)
    .map((t) => `${t.role === "user" ? "JUDE" : "JARVIS"}: ${String(t.text).slice(0, 1500)}`)
    .join("\n");

  const prompt = [
    `TODAY (Ireland): ${today}`,
    "",
    "DATA SNAPSHOT (live, just queried):",
    "",
    "ALL-TIME FUNNEL:",
    `prospects ${metrics.prospectsTotal} · researched ${metrics.companiesResearched} · contacted ${metrics.contacted} · outreach sent ${metrics.outreachSent} · replies ${metrics.replies} (${metrics.replyRate}% of contacted) · meetings ${metrics.meetingsBooked} · qualified ${metrics.qualified} · proposals sent ${metrics.proposalsSent} · won ${metrics.won} · pipeline value €${metrics.pipelineValue}`,
    "",
    "LAST 7 DAYS:",
    `leads added ${week.leadsAdded} · sent ${week.outreachSent} · replies ${week.replies} · meetings ${week.meetingsBooked}`,
    `sent by channel: ${Object.entries(week.outreachByChannel).map(([c, n]) => `${c} ${n}`).join(", ") || "none yet"}`,
    week.toneStats.length
      ? `tone performance: ${week.toneStats.map((t) => `${t.tone} ${t.replyRate}% (${t.replied}/${t.sent})`).join(", ")}`
      : "",
    "",
    `PROSPECTS (top ${(prospects ?? []).length} by score):`,
    prospectLines || "(none yet)",
    "",
    "RECENT INBOUND REPLIES:",
    replyLines || "(none yet)",
    "",
    "UPCOMING MEETINGS:",
    meetingLines || "(none booked)",
    "",
    convo ? `CONVERSATION SO FAR:\n${convo}\n` : "",
    `JUDE'S QUESTION: ${q}`,
    "",
    "Respond as JSON: {\"reply\": \"...\", \"actions\": [...]}. The reply is plain text (no markdown headings), tight paragraphs or short dashed lists.",
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const raw = (
      await aiComplete(system, prompt, 1500, {
        json: true,
        effort: "low",
        schema: JARVIS_SCHEMA as unknown as Record<string, unknown>,
      })
    ).trim();

    // Parse the structured response; if parsing fails, treat the whole
    // output as a plain reply so the chat degrades gracefully.
    let reply = raw;
    let actions: JarvisAction[] = [];
    try {
      const stripped = raw.replace(/```json|```/g, "").trim();
      const start = stripped.indexOf("{");
      const end = stripped.lastIndexOf("}");
      const parsed = JSON.parse(stripped.slice(start, end + 1)) as {
        reply?: string;
        actions?: JarvisAction[];
      };
      if (typeof parsed.reply === "string" && parsed.reply.trim()) {
        reply = parsed.reply.trim();
        actions = Array.isArray(parsed.actions) ? parsed.actions.slice(0, 8) : [];
      }
    } catch {
      // keep raw as reply
    }

    if (actions.length > 0) {
      const results: string[] = [];
      for (const a of actions) {
        results.push(await runJarvisAction(admin, member.id, a));
      }
      revalidatePath("/growth/jarvis");
      revalidatePath("/growth/prospects");
      revalidatePath("/growth/inbox");
      reply = `${reply}\n\n⚙️ ${results.join("\n")}`;
    }

    return { ok: true, answer: reply };
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    if (message === "NO_PROVIDER") return { ok: false, error: NO_PROVIDER_MESSAGE };
    if (message.startsWith("HTTP 429"))
      return { ok: false, error: "Hitting the AI rate limit — give it ~30 seconds and ask again." };
    if (/^HTTP 5\d\d/.test(message))
      return { ok: false, error: "The AI service is briefly overloaded — try again in a minute." };
    return { ok: false, error: "Something went wrong answering that — ask again." };
  }
}
