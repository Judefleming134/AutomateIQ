import Link from "next/link";
import { notFound } from "next/navigation";
import { requireGrowth } from "@/lib/growth/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { selectAllRows, selectAllRowsByIds } from "@/lib/growth/db";
import { ActionForm } from "@/components/admin/action-form";
import { SubmitButton } from "@/components/admin/submit-button";
import {
  CAMPAIGN_STATUSES,
  CAMPAIGN_STATUS_META,
  CHANNEL_META,
  CHANNELS,
  PROSPECT_STATUS_META,
  type CampaignStatus,
  type ProspectStatus,
} from "@/lib/growth/constants";
import { setCampaignStatus, updateCampaign, deleteCampaign } from "../actions";

export default async function CampaignDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { member } = await requireGrowth();
  const { id } = await params;
  const admin = createAdminClient();

  const { data: campaign } = await admin
    .from("ge_campaigns")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!campaign) notFound();

  // Page every query past PostgREST's 1,000-row cap so a big campaign's funnel
  // (drafts/queued/sent/replies) and prospect tallies count EVERY row — a
  // campaign with a few hundred prospects easily passes 1,000 messages once
  // first touches and follow-ups are drafted, silently truncating the numbers.
  const [prospects, messages] = await Promise.all([
    selectAllRows<{
      id: string;
      company: string;
      contact_name: string;
      status: string;
      lead_score: number;
      qualification_status: string;
    }>(() =>
      admin
        .from("ge_prospects")
        .select("id, company, contact_name, status, lead_score, qualification_status")
        .eq("campaign_id", id)
        .order("created_at", { ascending: false })
    ),
    selectAllRows<{ id: string; direction: string; status: string }>(() =>
      admin.from("ge_messages").select("id, direction, status").eq("campaign_id", id)
    ),
  ]);

  const prospectIds = (prospects ?? []).map((p) => p.id);
  // Meetings for THIS campaign's prospects only. ge_meetings has no campaign_id,
  // so scope by prospect_id rather than paging the entire meetings table on
  // every campaign view just to filter it down to a handful in memory.
  //
  // CHUNKED: every id goes into the request URL, at roughly 40 characters per
  // UUID. A campaign of a few hundred prospects — an ordinary size after one
  // import — pushed that URL past the server's limit, the request failed, and
  // because selectAllRows throws rather than truncating, the whole campaign
  // page 500'd. The bigger the campaign, the more certainly its own detail
  // page broke.
  const meetings = await selectAllRowsByIds<{
    id: string;
    prospect_id: string;
    status: string;
  }>(prospectIds, (chunk) =>
    admin
      .from("ge_meetings")
      .select("id, prospect_id, status")
      .neq("status", "cancelled")
      .in("prospect_id", chunk)
  );

  const outbound = (messages ?? []).filter((m) => m.direction === "outbound");
  const funnel = {
    drafts: outbound.filter((m) => m.status === "draft").length,
    queued: outbound.filter((m) => m.status === "queued").length,
    sent: outbound.filter((m) => m.status === "sent").length,
    replies: (messages ?? []).filter((m) => m.direction === "inbound").length,
    qualified: (prospects ?? []).filter((p) => p.qualification_status === "qualified").length,
    // Already scoped to this campaign's prospects by the query above.
    meetings: meetings.length,
  };

  const statusMeta = CAMPAIGN_STATUS_META[campaign.status as CampaignStatus];

  return (
    <>
      <div className="page-header">
        <div>
          <p style={{ margin: 0 }}>
            <Link href="/growth/campaigns">← Campaigns</Link>
          </p>
          <h1 style={{ marginTop: 4 }}>{campaign.name}</h1>
          <p>
            {[campaign.industry, campaign.service, campaign.location, campaign.target_audience]
              .filter(Boolean)
              .join(" · ") || "No targeting details yet."}
          </p>
        </div>
        <span className={`badge ${statusMeta?.badge ?? "badge-gray"}`}>
          {statusMeta?.label ?? campaign.status}
        </span>
      </div>

      <div className="stat-row" style={{ marginBottom: 20 }}>
        {(
          [
            ["Drafts", funnel.drafts],
            ["Queued", funnel.queued],
            ["Sent", funnel.sent],
            ["Replies", funnel.replies],
            ["Qualified", funnel.qualified],
            ["Meetings", funnel.meetings],
          ] as const
        ).map(([label, value]) => (
          <div className="stat-chip" key={label}>
            <span className="stat-chip-value">{value}</span>
            <span className="stat-chip-label">{label}</span>
          </div>
        ))}
      </div>

      <ActionForm
        action={setCampaignStatus}
        className="panel panel-block"
        style={{ display: "flex", gap: 10, alignItems: "end", flexWrap: "wrap", marginBottom: 16 }}
      >
        <input type="hidden" name="id" value={campaign.id} />
        <div>
          <label htmlFor="cs-status" style={{ fontSize: 12, color: "var(--faint)" }}>
            Campaign status
          </label>
          <select id="cs-status" name="status" defaultValue={campaign.status}>
            {CAMPAIGN_STATUSES.map((s) => (
              <option key={s} value={s}>
                {CAMPAIGN_STATUS_META[s].label}
              </option>
            ))}
          </select>
        </div>
        <SubmitButton className="btn btn-secondary btn-sm" pendingText="Saving…">
          Update
        </SubmitButton>
      </ActionForm>

      <section className="panel panel-block" aria-labelledby="cp-title">
        <h2 className="panel-title" id="cp-title">
          Prospects in this campaign ({(prospects ?? []).length}){" "}
          <Link href={`/growth/prospects?campaign=${campaign.id}`}>Filter view →</Link>
        </h2>
        {/* This used to say "assign prospects to this campaign from the
              Prospects screen", and you cannot. That screen has a campaign
              FILTER and a campaign field on the NEW-prospect form; there is no
              way to move an existing prospect into a campaign from it, and no
              bulk action for it either. So the one instruction on an empty
              campaign pointed at a screen where the thing it named isn't.

              The two routes that do exist, fastest first. */}
        {(prospects ?? []).length === 0 ? (
          <p className="empty-state">
            None yet. Two ways to fill it:{" "}
            <Link href="/growth/prospects">import a CSV</Link> with this campaign
            picked (fastest for a whole niche), or open any prospect and set{" "}
            <strong>Campaign</strong> on its <strong>Details</strong> tab. New
            prospects added by hand can be put straight into it as well.
          </p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Prospect</th>
                  <th>Status</th>
                  <th>Score</th>
                </tr>
              </thead>
              <tbody>
                {/* Preview the first 50 — a bulk-imported niche campaign can hold
                    hundreds of prospects, and rendering them all builds a giant
                    DOM that stutters. The funnel counts above still cover every
                    prospect; the full, paginated list is one tap away via
                    "Filter view →". */}
                {(prospects ?? []).slice(0, 50).map((p) => {
                  const meta = PROSPECT_STATUS_META[p.status as ProspectStatus];
                  return (
                    <tr key={p.id}>
                      <td>
                        <Link href={`/growth/prospects/${p.id}`}>
                          <strong>{p.company}</strong>
                        </Link>
                        <div style={{ color: "var(--faint)", fontSize: 12 }}>{p.contact_name}</div>
                      </td>
                      <td>
                        <span className={`badge ${meta?.badge ?? "badge-gray"}`}>
                          {meta?.label ?? p.status}
                        </span>
                      </td>
                      <td>{p.lead_score > 0 ? p.lead_score : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {(prospects ?? []).length > 50 && (
              <p style={{ fontSize: 12, color: "var(--faint)", marginTop: 8 }}>
                Showing the first 50 of {(prospects ?? []).length} —{" "}
                <Link href={`/growth/prospects?campaign=${campaign.id}`}>
                  open the full list →
                </Link>
              </p>
            )}
          </div>
        )}
      </section>

      <details className="panel panel-block" style={{ marginTop: 16 }}>
        <summary style={{ cursor: "pointer", fontWeight: 600 }}>Edit campaign</summary>
        <ActionForm action={updateCampaign} style={{ marginTop: 12 }}>
          <input type="hidden" name="id" value={campaign.id} />
          <div className="grid-2">
            <div>
              <label htmlFor="ec-name">Name *</label>
              <input id="ec-name" name="name" defaultValue={campaign.name} required maxLength={200} />
              <label htmlFor="ec-channel">Primary channel</label>
              <select id="ec-channel" name="channel" defaultValue={campaign.channel}>
                <option value="multi">Multi-channel</option>
                {CHANNELS.map((c) => (
                  <option key={c} value={c}>
                    {CHANNEL_META[c].label}
                  </option>
                ))}
              </select>
              <label htmlFor="ec-industry">Industry</label>
              <input id="ec-industry" name="industry" defaultValue={campaign.industry ?? ""} maxLength={200} />
              <label htmlFor="ec-service">Service</label>
              <input id="ec-service" name="service" defaultValue={campaign.service ?? ""} maxLength={200} />
            </div>
            <div>
              <label htmlFor="ec-location">Location</label>
              <input id="ec-location" name="location" defaultValue={campaign.location ?? ""} maxLength={200} />
              <label htmlFor="ec-audience">Target audience</label>
              <input id="ec-audience" name="target_audience" defaultValue={campaign.target_audience ?? ""} maxLength={500} />
              <label htmlFor="ec-description">Description</label>
              <textarea id="ec-description" name="description" rows={4} defaultValue={campaign.description ?? ""} maxLength={2000} />
            </div>
          </div>
          <div className="form-actions">
            <SubmitButton pendingText="Saving…">Save campaign</SubmitButton>
          </div>
        </ActionForm>
        {member.role === "owner" && (
          <ActionForm
            action={deleteCampaign}
            style={{ marginTop: 14 }}
            confirmText={`Delete the campaign "${campaign.name}"? Its prospects are kept, but the campaign and its grouping are gone for good.`}
          >
            <input type="hidden" name="id" value={campaign.id} />
            <SubmitButton className="btn btn-danger btn-sm" pendingText="Deleting…">
              Delete campaign (prospects are kept)
            </SubmitButton>
          </ActionForm>
        )}
      </details>
    </>
  );
}
