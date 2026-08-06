import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { selectAllRows } from "@/lib/growth/db";
import { isHumanReply } from "@/lib/growth/awaiting";

export type GrowthMetrics = {
  windowDays: number | null;
  leadsAdded: number;
  prospectsTotal: number;
  contacted: number;
  outreachSent: number;
  outreachByChannel: Record<string, number>;
  /** Replies from PEOPLE. Auto-responders and opt-outs are not counted here. */
  replies: number;
  /** Inbound in the window that was an auto-reply or an opt-out, not a person. */
  autoReplies: number;
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
  companiesResearched: number;
  proposalsSent: number;
  topCampaigns: CampaignPerf[];
  topIndustries: IndustryPerf[];
  /** How often each catalogue solution was recommended by research. */
  topSolutions: { name: string; count: number }[];
  /** Reply performance per outreach tone ("best performing style"). */
  toneStats: {
    tone: string;
    sent: number;
    replied: number;
    replyRate: number;
    /** Enough sends behind the rate to act on it (see TONE_MIN_SAMPLE). */
    reliable: boolean;
  }[];
};

/**
 * Sends behind a tone before its reply rate is worth ranking on. Below this a
 * single reply swings the rate by tens of points — 1/1 reads as a perfect
 * 100%. Defined once here so the analytics table, Jarvis and anything added
 * later agree on what "proven" means.
 */
export const TONE_MIN_SAMPLE = 10;

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
export type GrowthData = {
  prospects: {
    id: string;
    status: string;
    industry: string | null;
    campaign_id: string | null;
    pipeline_value: number | null;
    qualification_status: string | null;
    created_at: string;
  }[];
  messages: {
    prospect_id: string;
    campaign_id: string | null;
    channel: string;
    direction: string;
    status: string;
    sentiment: string | null;
    tone: string | null;
    created_at: string;
    sent_at: string | null;
  }[];
  /**
   * Inbound rows again, with the two columns the classifier needs.
   *
   * Fetched SEPARATELY rather than adding `subject`/`body` to `messages`
   * above: bodies run to 10,000 characters and `messages` is every row in the
   * table, so carrying them there would put tens of megabytes through the
   * dashboard, Jarvis and the 07:00 brief to classify the few per cent of rows
   * that are inbound. Filtered `direction = inbound` at the database, so this
   * is small by construction.
   */
  inboundDetail: {
    prospect_id: string;
    created_at: string;
    subject: string | null;
    body: string | null;
  }[];
  meetings: { prospect_id: string; status: string; created_at: string }[];
  campaigns: { id: string; name: string; status: string }[];
  research: { solutions: unknown; created_at: string }[];
  proposals: { status: string; updated_at: string }[];
};

// Load every Growth table once (paged past the 1,000-row cap). Kept separate
// from aggregation so several trailing windows (e.g. all-time + last 7 days)
// can be computed from ONE database load instead of re-scanning per window.
/**
 * `withSolutions: false` skips the `solutions` JSONB entirely and loads only
 * `created_at` from ge_research.
 *
 * That column holds the full recommendation array per prospect — key, name,
 * complexity, plus multi-sentence AI `why`/`benefits` text — and the ONLY thing
 * it feeds is `topSolutions`, which just tallies names. Analytics is the sole
 * screen that renders it, yet the dashboard, the morning brief and EVERY Jarvis
 * question were downloading and parsing the whole blob and throwing it away.
 *
 * Defaults to true, so every existing caller keeps identical behaviour; the hot
 * paths opt out. When opted out `topSolutions` is [] — correct for callers that
 * don't read it, and the reason this is an explicit flag rather than a silent
 * optimisation.
 */
/**
 * @param sinceIso When every requested window is bounded, the ISO timestamp of
 *   the earliest one — messages outside it (bar pending ones, and sends that
 *   went out inside it) are left in the database instead of paged into memory.
 *   Null whenever ANY caller wants all-time figures, because then every row is
 *   genuinely needed. Applied to the ge_messages select below; the other five
 *   tables are lifetime by construction (prospect totals, pipeline value, the
 *   won/qualified counts) and are deliberately not bounded.
 */
async function fetchGrowthData(
  admin: SupabaseClient,
  withSolutions = true,
  sinceIso: string | null = null
): Promise<GrowthData> {
  const [prospects, messages, inboundDetail, meetings, campaigns, research, proposals] =
    await Promise.all([
      selectAllRows<{
        id: string;
        status: string;
        industry: string | null;
        campaign_id: string | null;
        pipeline_value: number | null;
        qualification_status: string | null;
        created_at: string;
      }>(() =>
        admin
          .from("ge_prospects")
          .select("id, status, industry, campaign_id, pipeline_value, qualification_status, created_at")
      ),
      selectAllRows<{
        prospect_id: string;
        campaign_id: string | null;
        channel: string;
        direction: string;
        status: string;
        sentiment: string | null;
        tone: string | null;
        created_at: string;
        sent_at: string | null;
      }>(() => {
        const q = admin
          .from("ge_messages")
          .select("prospect_id, campaign_id, channel, direction, status, sentiment, tone, created_at, sent_at");
        // THE BOUND THIS FUNCTION ALREADY CLAIMED TO APPLY.
        //
        // `sinceIso` was computed by windowFloor(), passed in, documented in
        // detail — and then never used. Every "last 30 days" load paged the
        // ENTIRE message history into memory, including the engine's own home
        // page, which is the most-loaded screen there is.
        //
        // Three ways a row can still matter below the floor, all kept:
        //   · created_at inside it — ordinary recent activity, and the only
        //     instant `inbound` is filtered on.
        //   · sent_at inside it — a draft written before the window and sent
        //     inside it. `sent` filters on `sent_at ?? created_at`, so bounding
        //     on created_at alone would silently undercount the send that the
        //     overnight-draft + 07:00-cron split makes routine. Same reasoning
        //     as the floor in lib/growth/awaiting.ts.
        //   · still draft or queued — the backlog tiles are LIFETIME by
        //     construction ("whatever is sitting in the queue right now"), so a
        //     draft from six months ago must still be counted. This is the
        //     "(bar pending ones)" the docstring already promised.
        //
        // Null floor = a caller wanted all-time (Jarvis, the morning brief),
        // and nothing is bounded. windowFloor guards that; this respects it.
        return sinceIso
          ? q.or(
              `created_at.gte.${sinceIso},sent_at.gte.${sinceIso},status.in.(draft,queued)`
            )
          : q;
      }),
      // Inbound only, with subject + body, so a reply can be told from an
      // out-of-office. Same floor as the messages load — `inbound` is filtered
      // on created_at, so nothing below it can matter.
      selectAllRows<{
        prospect_id: string;
        created_at: string;
        subject: string | null;
        body: string | null;
      }>(() => {
        const q = admin
          .from("ge_messages")
          .select("prospect_id, created_at, subject, body")
          .eq("direction", "inbound");
        return sinceIso ? q.gte("created_at", sinceIso) : q;
      }),
      selectAllRows<{ prospect_id: string; status: string; created_at: string }>(
        () => admin.from("ge_meetings").select("prospect_id, status, created_at")
      ),
      selectAllRows<{ id: string; name: string; status: string }>(() =>
        admin.from("ge_campaigns").select("id, name, status")
      ),
      selectAllRows<{ solutions: unknown; created_at: string }>(() =>
        admin
          .from("ge_research")
          .select(withSolutions ? "solutions, created_at" : "created_at")
      ),
      selectAllRows<{ status: string; updated_at: string }>(() =>
        admin.from("ge_proposals").select("status, updated_at")
      ),
    ]);
  return { prospects, messages, inboundDetail, meetings, campaigns, research, proposals };
}

/**
 * Aggregate ONE trailing window from already-loaded data. Pure (no I/O).
 *
 * Exported so the row-bounding in fetchGrowthData can be proven harmless:
 * the test computes this over the full fixture and over the bounded subset and
 * requires the two to be identical. Nothing else calls it directly.
 */
export function computeGrowthMetrics(
  data: GrowthData,
  days: number | null
): GrowthMetrics {
  const since = days
    ? new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
    : null;
  const { prospects, messages, meetings, campaigns, research, proposals } = data;
  const allProspects = prospects;
  const allMessages = messages;
  const allMeetings = meetings.filter((m) => m.status !== "cancelled");

  const inWindow = (createdAt: string) => !since || createdAt >= since;

  const wMessages = allMessages.filter((m) => inWindow(m.created_at));
  const wMeetings = allMeetings.filter((m) => inWindow(m.created_at));

  // A send's window membership is when it ACTUALLY went out (sent_at), not when
  // the draft was written (created_at). With overnight drafting + the 7am send,
  // a draft can be created before the window but sent inside it — filtering by
  // created_at silently undercounts sends. Fall back to created_at for legacy
  // rows with no sent_at stamped.
  const sent = allMessages.filter(
    (m) =>
      m.direction === "outbound" &&
      m.status === "sent" &&
      inWindow(m.sent_at ?? m.created_at)
  );
  // AN OUT-OF-OFFICE IS NOT A REPLY.
  //
  // This was the last surface in the engine still counting one as a person.
  // The inbox (#592), the morning brief's reply list (#552), the awaiting count
  // (#548) and Jarvis's chat (#595) all classify inbound before counting it —
  // but they each do it locally, and THIS file is the shared source that feeds
  // the dashboard, analytics, campaigns, the CSV exports, Jarvis's stats and
  // the brief's stats. So "Reply rate" — the engine's headline metric — plus
  // every per-campaign, per-industry and per-tone reply rate under it were
  // computed over raw inbound.
  //
  // In an Irish August a dozen holiday auto-responders in a week is ordinary,
  // and they land on the leads that were emailed most recently — the ones a
  // tone or a campaign is being judged on. So the effect is not evenly spread
  // noise: it inflates exactly the row you are about to act on, and
  // "best performing style" gets copied into every future message.
  //
  // FAILS OPEN, deliberately. A row with no matching detail entry is treated
  // as human: if this extra load ever comes back short, the numbers degrade to
  // exactly what they are today rather than collapsing the engine's headline
  // metric to zero and looking like every prospect went quiet.
  const humanInboundKeys = new Set<string>();
  for (const d of data.inboundDetail) {
    if (isHumanReply(d)) humanInboundKeys.add(`${d.prospect_id} ${d.created_at}`);
  }
  const detailKeys = new Set(
    data.inboundDetail.map((d) => `${d.prospect_id} ${d.created_at}`)
  );
  const isHumanRow = (m: { prospect_id: string; created_at: string }) => {
    const key = `${m.prospect_id} ${m.created_at}`;
    return humanInboundKeys.has(key) || !detailKeys.has(key);
  };

  const allInbound = wMessages.filter((m) => m.direction === "inbound");
  const inbound = allInbound.filter(isHumanRow);
  const autoReplies = allInbound.length - inbound.length;

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
    .filter((p) =>
      ["qualified", "meeting_booked", "proposal_in_progress", "proposal_sent",
       "negotiation", "won"].includes(p.status)
    )
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

  // Most-recommended solutions across all research runs.
  const solutionCounts = new Map<string, number>();
  for (const r of research ?? []) {
    if (!Array.isArray(r.solutions)) continue;
    for (const s of r.solutions as { name?: string }[]) {
      if (!s?.name) continue;
      solutionCounts.set(s.name, (solutionCounts.get(s.name) ?? 0) + 1);
    }
  }

  // Best-performing outreach style: a tone's send "converted" if the
  // prospect sent anything back after that message went out.
  // Same rule here: a tone did not "convert" because an auto-responder fired
  // at the address it was sent to.
  const inboundByProspect = new Map<string, string[]>();
  for (const m of allMessages) {
    if (m.direction !== "inbound") continue;
    if (!isHumanRow(m)) continue;
    const list = inboundByProspect.get(m.prospect_id) ?? [];
    list.push(m.created_at);
    inboundByProspect.set(m.prospect_id, list);
  }
  const toneAgg = new Map<string, { sent: number; replied: number }>();
  for (const m of sent) {
    if (!m.tone) continue;
    const agg = toneAgg.get(m.tone) ?? { sent: 0, replied: 0 };
    agg.sent += 1;
    const sentAt = m.sent_at ?? m.created_at;
    if ((inboundByProspect.get(m.prospect_id) ?? []).some((at) => at > sentAt)) {
      agg.replied += 1;
    }
    toneAgg.set(m.tone, agg);
  }

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
    autoReplies,
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
    companiesResearched: (research ?? []).filter((r) => inWindow(r.created_at)).length,
    proposalsSent: (proposals ?? []).filter(
      (p) => p.status === "sent" && inWindow(p.updated_at)
    ).length,
    topCampaigns: rank([...perfByCampaign.values()].filter((c) => c.prospects > 0)),
    topIndustries: rank([...perfByIndustry.values()]),
    topSolutions: [...solutionCounts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10),
    // Proven tones first, THEN by rate. Sorting on rate alone put a 1-send /
    // 1-reply tone (100%) above a 50-send / 18-reply one — top of the
    // analytics table and first in the line Jarvis reads, which is how a
    // one-off fluke ends up being described as the best performing style and
    // gets copied into every message. Tones below the sample floor still
    // appear (they're the pipeline of what's being tried), just underneath.
    toneStats: [...toneAgg.entries()]
      .map(([tone, agg]) => ({
        tone,
        sent: agg.sent,
        replied: agg.replied,
        replyRate: pct(agg.replied, agg.sent),
        reliable: agg.sent >= TONE_MIN_SAMPLE,
      }))
      .sort(
        (a, b) =>
          Number(b.reliable) - Number(a.reliable) ||
          b.replyRate - a.replyRate ||
          b.sent - a.sent
      ),
  };
}

/**
 * One pass over the Growth Engine tables producing every number the
 * dashboard, analytics, campaign and report screens show — so "reply rate"
 * can never mean two different things on two different screens.
 *
 * `days` restricts activity (prospects added, messages, meetings created) to
 * a trailing window; null = all time.
 */
/**
 * The earliest instant any requested window needs, or null if ANY of them is
 * all-time. A single null makes the whole load unbounded — Jarvis asks for
 * [null, 7] and genuinely needs every row, so it must not be narrowed.
 */
function windowFloor(windows: (number | null)[]): string | null {
  if (windows.length === 0 || windows.some((w) => w === null || !Number.isFinite(w))) {
    return null;
  }
  const widest = Math.max(...(windows as number[]));
  if (widest <= 0) return null;
  // A day of slack past the boundary, so clock skew between this process and
  // Postgres can never drop a row the JS filter would have kept.
  return new Date(Date.now() - (widest + 1) * 24 * 60 * 60 * 1000).toISOString();
}

export async function loadGrowthMetrics(
  admin: SupabaseClient,
  days: number | null = null,
  opts: { withSolutions?: boolean } = {}
): Promise<GrowthMetrics> {
  return computeGrowthMetrics(
    await fetchGrowthData(admin, opts.withSolutions ?? true, windowFloor([days])),
    days
  );
}

/**
 * Same numbers as loadGrowthMetrics, but for several windows at once from a
 * SINGLE table load — e.g. the Jarvis page needs all-time + last-7-days and
 * would otherwise scan all six tables twice. Returns metrics in the same
 * order as the requested windows.
 */
export async function loadGrowthMetricsMulti(
  admin: SupabaseClient,
  windows: (number | null)[],
  opts: { withSolutions?: boolean } = {}
): Promise<GrowthMetrics[]> {
  const data = await fetchGrowthData(
    admin,
    opts.withSolutions ?? true,
    windowFloor(windows)
  );
  return windows.map((w) => computeGrowthMetrics(data, w));
}
