import React from "react";
import Link from "next/link";
import { requireGrowth } from "@/lib/growth/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadGrowthMetrics } from "@/lib/growth/metrics";
import { selectAllRows } from "@/lib/growth/db";
import { ActionForm } from "@/components/admin/action-form";
import { SubmitButton } from "@/components/admin/submit-button";
import {
  CAMPAIGN_STATUS_META,
  CHANNEL_META,
  CHANNELS,
  type CampaignStatus,
} from "@/lib/growth/constants";
import { createCampaign } from "./actions";

export default async function CampaignsPage() {
  await requireGrowth();
  const admin = createAdminClient();

  const [{ data: campaigns }, metrics, statusRows] = await Promise.all([
    admin
      .from("ge_campaigns")
      .select("id, name, channel, industry, service, location, target_audience, status, created_at")
      .order("created_at", { ascending: false }),
    loadGrowthMetrics(admin),
    // Page past the 1,000-row cap so the per-campaign ready/to-research
    // tallies count every prospect, not just the first 1,000.
    selectAllRows<{ campaign_id: string | null; status: string }>(() =>
      admin.from("ge_prospects").select("campaign_id, status")
    ),
  ]);

  const perfById = new Map(metrics.topCampaigns.map((c) => [c.id, c]));

  // Per-campaign "what needs doing": researched-and-ready-to-contact vs
  // still-to-research — so at a glance Jude sees which niche to work next.
  // ready/approved are tracked SEPARATELY because each is a click-through to
  // a single-status filter — the number shown must equal the rows the click
  // lands on, or the page looks broken ("12 ready" → 9 rows).
  const TO_RESEARCH = new Set(["new", "researching"]);
  const todo = new Map<
    string,
    { ready: number; approved: number; toResearch: number; failed: number }
  >();
  for (const p of statusRows) {
    if (!p.campaign_id) continue;
    const t =
      todo.get(p.campaign_id) ?? { ready: 0, approved: 0, toResearch: 0, failed: 0 };
    if (p.status === "research_complete") t.ready += 1;
    else if (p.status === "outreach_ready") t.approved += 1;
    else if (TO_RESEARCH.has(p.status)) t.toResearch += 1;
    // Parked after failed research: without this tally a campaign full of
    // failures showed "—" as if there were nothing to do, hiding the leads.
    else if (p.status === "research_failed") t.failed += 1;
    todo.set(p.campaign_id, t);
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Campaign manager</h1>
          <p>
            Organise outreach by industry, service, location and audience —
            each campaign tracks its own funnel from draft to booked meeting.
          </p>
        </div>
      </div>

      <details className="panel panel-block" style={{ marginBottom: 16 }}>
        <summary style={{ cursor: "pointer", fontWeight: 600 }}>+ New campaign</summary>
        <ActionForm action={createCampaign} style={{ marginTop: 12 }}>
          <div className="grid-2">
            <div>
              <label htmlFor="nc-name">Name *</label>
              <input id="nc-name" name="name" required maxLength={200} placeholder="e.g. Cork trades — Q3 email push" />
              <label htmlFor="nc-channel">Primary channel</label>
              <select id="nc-channel" name="channel" defaultValue="multi">
                <option value="multi">Multi-channel</option>
                {CHANNELS.map((c) => (
                  <option key={c} value={c}>
                    {CHANNEL_META[c].label}
                  </option>
                ))}
              </select>
              <label htmlFor="nc-industry">Industry</label>
              <input id="nc-industry" name="industry" maxLength={200} />
              <label htmlFor="nc-service">Service being sold</label>
              <input id="nc-service" name="service" maxLength={200} placeholder="e.g. ReputationIQ, AI Strategy Session" />
            </div>
            <div>
              <label htmlFor="nc-location">Location</label>
              <input id="nc-location" name="location" maxLength={200} />
              <label htmlFor="nc-audience">Target audience</label>
              <input id="nc-audience" name="target_audience" maxLength={500} placeholder="e.g. owner-managers, 5–50 staff" />
              <label htmlFor="nc-description">Description</label>
              <textarea id="nc-description" name="description" rows={4} maxLength={2000} />
            </div>
          </div>
          <div className="form-actions">
            <SubmitButton pendingText="Creating…">Create campaign</SubmitButton>
          </div>
        </ActionForm>
      </details>

      {(campaigns ?? []).length === 0 ? (
        <div className="panel panel-block">
          <p className="empty-state">No campaigns yet — create the first one above.</p>
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Campaign</th>
                <th>Channel</th>
                <th>Status</th>
                <th>To do</th>
                <th>Prospects</th>
                <th>Sent</th>
                <th>Replies</th>
                <th>Qualified</th>
                <th>Meetings</th>
              </tr>
            </thead>
            <tbody>
              {(campaigns ?? []).map((c) => {
                const meta = CAMPAIGN_STATUS_META[c.status as CampaignStatus];
                const perf = perfById.get(c.id);
                return (
                  <tr key={c.id}>
                    <td>
                      <Link href={`/growth/campaigns/${c.id}`}>
                        <strong>{c.name}</strong>
                      </Link>
                      <div style={{ color: "var(--faint)", fontSize: 12 }}>
                        {[c.industry, c.location, c.target_audience].filter(Boolean).join(" · ") || "—"}
                      </div>
                    </td>
                    <td>
                      {c.channel === "multi"
                        ? "Multi"
                        : CHANNEL_META[c.channel as keyof typeof CHANNEL_META]?.label}
                    </td>
                    <td>
                      <span className={`badge ${meta?.badge ?? "badge-gray"}`}>
                        {meta?.label ?? c.status}
                      </span>
                    </td>
                    <td style={{ fontSize: 12, whiteSpace: "nowrap" }}>
                      {(() => {
                        const t = todo.get(c.id);
                        if (
                          !t ||
                          (t.ready === 0 &&
                            t.approved === 0 &&
                            t.toResearch === 0 &&
                            t.failed === 0)
                        )
                          return "—";
                        const parts: React.ReactNode[] = [];
                        if (t.ready > 0) {
                          parts.push(
                            <Link
                              key="r"
                              href={`/growth/prospects?campaign=${c.id}&status=research_complete`}
                              style={{ color: "var(--green, #34d399)" }}
                            >
                              {t.ready} ready
                            </Link>
                          );
                        }
                        if (t.approved > 0) {
                          parts.push(
                            <Link
                              key="a"
                              href={`/growth/prospects?campaign=${c.id}&status=outreach_ready`}
                              style={{ color: "var(--green, #34d399)" }}
                            >
                              {t.approved} approved
                            </Link>
                          );
                        }
                        if (t.toResearch > 0) {
                          parts.push(
                            <span key="t" style={{ color: "var(--faint)" }}>
                              {t.toResearch} to research
                            </span>
                          );
                        }
                        if (t.failed > 0) {
                          parts.push(
                            <Link
                              key="f"
                              href={`/growth/prospects?campaign=${c.id}&status=research_failed`}
                              style={{ color: "var(--orange, #fb923c)" }}
                            >
                              {t.failed} failed research
                            </Link>
                          );
                        }
                        return parts.map((el, i) => (
                          <React.Fragment key={i}>
                            {i > 0 ? " · " : ""}
                            {el}
                          </React.Fragment>
                        ));
                      })()}
                    </td>
                    <td>{perf?.prospects ?? 0}</td>
                    <td>{perf?.sent ?? 0}</td>
                    <td style={{ whiteSpace: "nowrap" }}>
                      {perf?.replies ?? 0}
                      {/* Reply rate is the real signal of which niche responds —
                          show it inline (only once something's been sent) so Jude
                          doesn't have to do replies÷sent in his head. */}
                      {(perf?.sent ?? 0) > 0 && (
                        <span style={{ color: "var(--faint)", fontSize: 11 }}>
                          {" "}
                          ({Math.round(((perf?.replies ?? 0) / (perf!.sent || 1)) * 100)}%)
                        </span>
                      )}
                    </td>
                    <td>{perf?.qualified ?? 0}</td>
                    <td>{perf?.meetings ?? 0}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
