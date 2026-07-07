"use server";

import { requireGrowth } from "@/lib/growth/auth";
import { createAdminClient } from "@/lib/supabase/admin";
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
  await requireGrowth();
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
          "company, contact_name, status, industry, location, lead_score, pipeline_value, next_follow_up_at, last_contact_at, email, phone, notes"
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
        [p.email ? "email" : null, p.phone ? "phone" : null].filter(Boolean).join("+") || "no contact method",
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
    "- Money figures may ONLY come from the price book below. Never make up a price.",
    "- When asked what to do, give a concrete ordered action list referencing real prospects (who to call/DM/email and why), not generic advice.",
    "- Channels: email sends from the platform; Instagram/Facebook/LinkedIn DMs and phone calls are done by Jude personally — the engine preps drafts and call scripts. Never claim to have sent anything yourself.",
    "- You cannot change data. To act, point Jude at the right place: a prospect's workspace (Research/Studio/Proposal tabs), the Prospects list, or the Inbox.",
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
    "Answer as Jarvis. Plain text (no markdown headings), tight paragraphs or short dashed lists.",
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const answer = (await aiComplete(system, prompt, 1200, { effort: "low" })).trim();
    return { ok: true, answer };
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
