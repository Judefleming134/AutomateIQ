import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

export type GrowthMetrics = {
  windowDays: number | null;
  leadsAdded: number;
  prospectsTotal: number;
  contacted: number;
  outreachSent: number;
  outreachByChannel: Record<string, number>;
  replies: number;
  repliedProspects: number;
  replyRate: number; // % of contacted prospects that replied
  positiveReplies: number;
  positiveRate: number; // % of tagged inbound replies that are positive
  meetingsBooked: number;
  conversionRate: number; // % of contacted prospects with a meeting
  pipelineValue: number;
  qualified: number;
  won: number;
  queuedOutreach: number;
  draftOutreach: number;
  topCampaigns: CampaignPerf[];
  topIndustries: IndustryPerf[];
};

export type CampaignPerf = {
  id: string;
  name: string;
  status: string;
  prospects: number;
  sent: number;
  replies: number;
  meetings: number;
  qualified: number;
};

export type IndustryPerf = {
  industry: string;
  prospects: number;
  sent: number;
  replies: number;
  meetings: number;
};

function pct(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 100) : 0;
}

/**
 * One pass over the Growth Engine tables producing every number the
 * dashboard, analytics, campaign and report screens show — so "reply rate"
 * can never mean two different things on two different screens.
 *
 * `days` restricts activity (prospects added, messages, meetings created) to
 * a trailing window; null = all time. Internal-scale data (thousands of
 * rows, one team) — aggregating in JS keeps the queries trivial.
 */
export async function loadGrowthMetrics(
  admin: SupabaseClient,
  days: number | null = null
): Promise<GrowthMetrics> {
  const since = days
    ? new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
    : null;

  const [{ data: prospects }, { data: messages }, { data: meetings }, { data: campaigns }] =
    await Promise.all([
      admin
        .from("ge_prospects")
        .select("id, status, industry, campaign_id, pipeline_value, qualification_status, created_at"),
      admin
        .from("ge_messages")
        .select("prospect_id, campaign_id, channel, direction, status, sentiment, created_at"),
      admin.from("ge_meetings").select("prospect_id, status, created_at"),
      admin.from("ge_campaigns").select("id, name, status"),
    ]);

  const allProspects = prospects ?? [];
  const allMessages = messages ?? [];
  const allMeetings = (meetings ?? []).filter((m) => m.status !== "cancelled");

  const inWindow = (createdAt: string) => !since || createdAt >= since;

  const wMessages = allMessages.filter((m) => inWindow(m.created_at));
  const wMeetings = allMeetings.filter((m) => inWindow(m.created_at));

  const sent = wMessages.filter((m) => m.direction === "outbound" && m.status === "sent");
  const inbound = wMessages.filter((m) => m.direction === "inbound");

  const prospectById = new Map(allProspects.map((p) => [p.id, p]));
  const contactedIds = new Set(sent.map((m) => m.prospect_id));
  const repliedIds = new Set(inbound.map((m) => m.prospect_id));
  const meetingIds = new Set(wMeetings.map((m) => m.prospect_id));

  const outreachByChannel: Record<string, number> = {};
  for (const m of sent) {
    outreachByChannel[m.channel] = (outreachByChannel[m.channel] ?? 0) + 1;
  }

  const taggedInbound = inbound.filter((m) => m.sentiment);
  const positiveReplies = taggedInbound.filter((m) => m.sentiment === "positive").length;

  const pipelineValue = allProspects
    .filter((p) => ["qualified", "meeting_booked", "won"].includes(p.status))
    .reduce((sum, p) => sum + Number(p.pipeline_value ?? 0), 0);

  // Per-campaign funnel.
  const perfByCampaign = new Map<string, CampaignPerf>();
  for (const c of campaigns ?? []) {
    perfByCampaign.set(c.id, {
      id: c.id,
      name: c.name,
      status: c.status,
      prospects: 0,
      sent: 0,
      replies: 0,
      meetings: 0,
      qualified: 0,
    });
  }
  for (const p of allProspects) {
    const perf = p.campaign_id ? perfByCampaign.get(p.campaign_id) : undefined;
    if (!perf) continue;
    perf.prospects += 1;
    if (p.qualification_status === "qualified") perf.qualified += 1;
  }
  for (const m of sent) {
    const perf = m.campaign_id ? perfByCampaign.get(m.campaign_id) : undefined;
    if (perf) perf.sent += 1;
  }
  for (const m of inbound) {
    const perf = m.campaign_id ? perfByCampaign.get(m.campaign_id) : undefined;
    if (perf) perf.replies += 1;
  }
  for (const m of wMeetings) {
    const campaignId = prospectById.get(m.prospect_id)?.campaign_id;
    const perf = campaignId ? perfByCampaign.get(campaignId) : undefined;
    if (perf) perf.meetings += 1;
  }

  // Per-industry funnel.
  const perfByIndustry = new Map<string, IndustryPerf>();
  const industryOf = (prospectId: string) =>
    prospectById.get(prospectId)?.industry?.trim() || "Uncategorised";
  const industryPerf = (industry: string) => {
    let perf = perfByIndustry.get(industry);
    if (!perf) {
      perf = { industry, prospects: 0, sent: 0, replies: 0, meetings: 0 };
      perfByIndustry.set(industry, perf);
    }
    return perf;
  };
  for (const p of allProspects) {
    industryPerf(p.industry?.trim() || "Uncategorised").prospects += 1;
  }
  for (const m of sent) industryPerf(industryOf(m.prospect_id)).sent += 1;
  for (const m of inbound) industryPerf(industryOf(m.prospect_id)).replies += 1;
  for (const m of wMeetings) industryPerf(industryOf(m.prospect_id)).meetings += 1;

  const rank = <T extends { meetings: number; replies: number; sent: number }>(
    items: T[]
  ) =>
    items.sort(
      (a, b) =>
        b.meetings - a.meetings || b.replies - a.replies || b.sent - a.sent
    );

  return {
    windowDays: days,
    leadsAdded: allProspects.filter((p) => inWindow(p.created_at)).length,
    prospectsTotal: allProspects.length,
    contacted: contactedIds.size,
    outreachSent: sent.length,
    outreachByChannel,
    replies: inbound.length,
    repliedProspects: repliedIds.size,
    replyRate: pct(
      [...repliedIds].filter((id) => contactedIds.has(id)).length,
      contactedIds.size
    ),
    positiveReplies,
    positiveRate: pct(positiveReplies, taggedInbound.length),
    meetingsBooked: wMeetings.length,
    conversionRate: pct(
      [...meetingIds].filter((id) => contactedIds.has(id)).length,
      contactedIds.size
    ),
    pipelineValue,
    qualified: allProspects.filter((p) => p.qualification_status === "qualified").length,
    won: allProspects.filter((p) => p.status === "won").length,
    queuedOutreach: allMessages.filter(
      (m) => m.direction === "outbound" && m.status === "queued"
    ).length,
    draftOutreach: allMessages.filter(
      (m) => m.direction === "outbound" && m.status === "draft"
    ).length,
    topCampaigns: rank([...perfByCampaign.values()].filter((c) => c.prospects > 0)),
    topIndustries: rank([...perfByIndustry.values()]),
  };
}
