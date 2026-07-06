import Link from "next/link";
import { requireGrowth } from "@/lib/growth/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadGrowthMetrics } from "@/lib/growth/metrics";
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

  const [{ data: campaigns }, metrics] = await Promise.all([
    admin
      .from("ge_campaigns")
      .select("id, name, channel, industry, service, location, target_audience, status, created_at")
      .order("created_at", { ascending: false }),
    loadGrowthMetrics(admin),
  ]);

  const perfById = new Map(metrics.topCampaigns.map((c) => [c.id, c]));

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
              <input id="nc-service" name="service" maxLength={200} placeholder="e.g. Review Agent, AI Strategy Session" />
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
                    <td>{perf?.prospects ?? 0}</td>
                    <td>{perf?.sent ?? 0}</td>
                    <td>{perf?.replies ?? 0}</td>
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
