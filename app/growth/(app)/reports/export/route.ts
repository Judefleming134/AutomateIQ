import { requireGrowth } from "@/lib/growth/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadGrowthMetrics } from "@/lib/growth/metrics";
import { escapeLike, selectAllRows } from "@/lib/growth/db";
import {
  applyDueBucket,
  resolveDueBucket,
  applyStageBucket,
  applySocialOnly,
  resolveStageBucket,
} from "@/lib/growth/prospect-query";
import { PROSPECT_SORTS } from "@/lib/growth/constants";
import { dublinDate } from "@/lib/growth/dates";
import { toCsv } from "@/lib/growth/csv";

/**
 * CSV downloads for the Reporting screen. requireGrowth() is the boundary —
 * anyone else is redirected before a byte of data is read.
 */
export async function GET(request: Request) {
  await requireGrowth();
  const admin = createAdminClient();

  const url = new URL(request.url);
  const type = url.searchParams.get("type") ?? "summary";
  const days = [7, 30, 90].includes(Number(url.searchParams.get("days")))
    ? Number(url.searchParams.get("days"))
    : 30;
  const sinceIso = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  let rows: (string | number | null)[][];
  let name: string;

  if (type === "prospects") {
    // Honour the same filters as the prospects table, so "filter → Export"
    // gives exactly the list on screen (e.g. Has-phone + a status = a dial
    // sheet). No filter params = the whole database, as before. Same
    // sanitisation as the page: strip PostgREST .or() syntax chars from q.
    const q = (url.searchParams.get("q") ?? "")
      .trim()
      .replace(/[,()]/g, " ")
      .slice(0, 100)
      .trim();
    const status = (url.searchParams.get("status") ?? "").trim();
    const industry = (url.searchParams.get("industry") ?? "").trim();
    const campaign = (url.searchParams.get("campaign") ?? "").trim();
    const phoneOnly = url.searchParams.get("phone") === "1";
    const socialOnly = url.searchParams.get("social") === "1";
    const sortParam = url.searchParams.get("sort") ?? undefined;
    // Same follow-up buckets the Prospects page offers. Without this, exporting
    // from a "Gone cold" view would quietly hand back the whole database — the
    // exact promise #419 fixed for ordering, broken again by a new filter.
    const dueParam = url.searchParams.get("due") ?? "";
    const stageParam = url.searchParams.get("stage") ?? "";
    const filtered = Boolean(q || status || industry || campaign || phoneOnly || socialOnly || dueParam || stageParam);

    // Page past the 1,000-row cap so the export is the WHOLE result set, not a
    // truncated first slice — an incomplete export is a silent data-loss trap.
    const data = await selectAllRows<Record<string, string | number | null>>(
      () => {
        // Order the CSV the way the SCREEN is ordered. This was hardwired to
        // created_at desc, so filtering to "Has phone" (which sorts best-score
        // first on the page) exported a dial sheet in creation order — the top
        // of the file wasn't the best leads, which is the one thing that list
        // is for. The Prospects page now sends its RESOLVED sort key, and the
        // same shared table maps it here so the two cannot drift.
        //
        // No sort param at all = the Reporting screen's plain "export
        // prospects" link, which has no list on screen to match. That keeps
        // its long-standing newest-first order exactly as it was.
        // nullsFirst:false so unscored leads don't outrank scored ones on DESC.
        const sort = (sortParam && PROSPECT_SORTS[sortParam]) || {
          column: "created_at",
          ascending: false,
        };
        let query = admin
          .from("ge_prospects")
          .select(
            "company, contact_name, job_title, industry, website, location, email, phone, linkedin_url, instagram_url, facebook_url, status, lead_score, qualification_status, pipeline_value, source, last_contact_at, next_follow_up_at, created_at"
          )
          .order(sort.column, { ascending: sort.ascending, nullsFirst: false })
          // Unique tiebreak keeps paged reads exact when rows share a value.
          .order("id", { ascending: true });
        if (q) {
          // Same LIKE-wildcard escaping as the page, so the CSV matches the
          // list on screen even when the search contains _ or %.
          const like = escapeLike(q);
          query = query.or(
            `company.ilike.%${like}%,contact_name.ilike.%${like}%,email.ilike.%${like}%,job_title.ilike.%${like}%`
          );
        }
        if (status) query = query.eq("status", status);
        if (industry) query = query.ilike("industry", escapeLike(industry));
        if (campaign) query = query.eq("campaign_id", campaign);
        if (phoneOnly) query = query.not("phone", "is", null);
        query = applySocialOnly(query, socialOnly);
        // The SAME definition the Prospects page narrows with. This branch
        // used to list the buckets by hand and had never been taught about
        // `unscheduled` — the fifth one, which the dashboard links straight
        // to. It fell through every case, so exporting from that view handed
        // back the whole database in a file named "…-filtered".
        query = applyDueBucket(query, resolveDueBucket(dueParam), dublinDate());
        query = applyStageBucket(query, resolveStageBucket(stageParam));
        return query;
      }
    );
    rows = [
      [
        "company", "contact_name", "job_title", "industry", "website", "location",
        "email", "phone", "linkedin_url", "instagram_url", "facebook_url", "status",
        "lead_score", "qualification_status", "pipeline_value", "source",
        "last_contact_at", "next_follow_up_at", "created_at",
      ],
      ...(data ?? []).map((p) => [
        p.company, p.contact_name, p.job_title, p.industry, p.website, p.location,
        p.email, p.phone, p.linkedin_url, p.instagram_url, p.facebook_url, p.status,
        p.lead_score, p.qualification_status, p.pipeline_value, p.source,
        p.last_contact_at, p.next_follow_up_at, p.created_at,
      ]),
    ];
    name = filtered ? "growth-prospects-filtered" : "growth-prospects";
  } else if (type === "messages") {
    const data = await selectAllRows<{
      created_at: string;
      sent_at: string | null;
      channel: string;
      direction: string;
      status: string;
      sentiment: string | null;
      subject: string | null;
      body: string | null;
      ge_prospects: unknown;
    }>(() =>
      admin
        .from("ge_messages")
        .select(
          "created_at, sent_at, channel, direction, status, sentiment, subject, body, ge_prospects(company, contact_name)"
        )
        .gte("created_at", sinceIso)
        .order("created_at", { ascending: false })
        // Same unique tiebreak as the prospects export: rows sharing a
        // timestamp must not be skipped/duplicated across page boundaries.
        .order("id", { ascending: true })
    );
    rows = [
      ["created_at", "sent_at", "company", "contact", "channel", "direction", "status", "sentiment", "subject", "body"],
      ...(data ?? []).map((m) => {
        const p = m.ge_prospects as unknown as { company: string; contact_name: string } | null;
        return [
          m.created_at, m.sent_at, p?.company ?? "", p?.contact_name ?? "",
          m.channel, m.direction, m.status, m.sentiment, m.subject, m.body,
        ];
      }),
    ];
    name = `growth-messages-${days}d`;
  } else if (type === "meetings") {
    const data = await selectAllRows<{
      scheduled_at: string;
      status: string;
      notes: string | null;
      created_at: string;
      ge_prospects: unknown;
    }>(() =>
      admin
        .from("ge_meetings")
        .select("scheduled_at, status, notes, created_at, ge_prospects(company, contact_name, email)")
        .gte("created_at", sinceIso)
        .order("scheduled_at", { ascending: false })
        .order("id", { ascending: true })
    );
    rows = [
      ["scheduled_at", "status", "company", "contact", "email", "notes", "recorded_at"],
      ...(data ?? []).map((m) => {
        const p = m.ge_prospects as unknown as {
          company: string;
          contact_name: string;
          email: string | null;
        } | null;
        return [
          m.scheduled_at, m.status, p?.company ?? "", p?.contact_name ?? "",
          p?.email ?? "", m.notes, m.created_at,
        ];
      }),
    ];
    name = `growth-meetings-${days}d`;
  } else {
    const metrics = await loadGrowthMetrics(admin, days);
    rows = [
      ["metric", "value"],
      [`window_days`, days],
      ["leads_added", metrics.leadsAdded],
      ["prospects_total", metrics.prospectsTotal],
      ["outreach_sent", metrics.outreachSent],
      ["prospects_contacted", metrics.contacted],
      ["replies", metrics.replies],
      ["reply_rate_pct", metrics.replyRate],
      ["positive_response_rate_pct", metrics.positiveRate],
      ["meetings_booked", metrics.meetingsBooked],
      ["companies_researched", metrics.companiesResearched],
      ["proposals_sent", metrics.proposalsSent],
      ["conversion_rate_pct", metrics.conversionRate],
      ["qualified_leads", metrics.qualified],
      ["deals_won", metrics.won],
      ["pipeline_value_eur", Math.round(metrics.pipelineValue)],
      ["outreach_queued", metrics.queuedOutreach],
      ["outreach_drafts", metrics.draftOutreach],
    ];
    name = `growth-summary-${days}d`;
  }

  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(toCsv(rows), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${name}-${stamp}.csv"`,
    },
  });
}
