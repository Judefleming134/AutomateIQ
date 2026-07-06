import Link from "next/link";
import { Download, Sparkles } from "lucide-react";
import { requireGrowth } from "@/lib/growth/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { ActionForm } from "@/components/admin/action-form";
import { SubmitButton } from "@/components/admin/submit-button";
import {
  PROSPECT_STATUSES,
  PROSPECT_STATUS_META,
  type ProspectStatus,
} from "@/lib/growth/constants";
import { addProspect, importProspects, quickResearch } from "./actions";

// Quick research runs a full AI research pass inside this route's actions.
export const maxDuration = 60;

const CSV_HINT =
  "company,contact_name,job_title,industry,website,location,email,phone,linkedin_url,instagram_url,notes";

export default async function ProspectsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; industry?: string; campaign?: string }>;
}) {
  await requireGrowth();
  const params = await searchParams;
  const admin = createAdminClient();

  // PostgREST .or() filters are comma-delimited — strip characters that
  // would let a search term escape the ilike pattern into extra clauses.
  const q = (params.q ?? "").trim().replace(/[,()]/g, " ").slice(0, 100).trim();
  const status = (params.status ?? "").trim();
  const industry = (params.industry ?? "").trim();
  const campaign = (params.campaign ?? "").trim();

  let query = admin
    .from("ge_prospects")
    .select(
      "id, company, contact_name, job_title, industry, location, email, status, lead_score, qualification_status, last_contact_at, next_follow_up_at, campaign_id, assigned_to"
    )
    .order("created_at", { ascending: false })
    .limit(500);
  if (q) {
    query = query.or(
      `company.ilike.%${q}%,contact_name.ilike.%${q}%,email.ilike.%${q}%,job_title.ilike.%${q}%`
    );
  }
  if (status) query = query.eq("status", status);
  if (industry) query = query.ilike("industry", industry);
  if (campaign) query = query.eq("campaign_id", campaign);

  const [{ data: prospects }, { data: campaigns }, { data: industriesRaw }, { data: team }] =
    await Promise.all([
      query,
      admin.from("ge_campaigns").select("id, name").order("name"),
      admin.from("ge_prospects").select("industry").not("industry", "is", null),
      admin.from("ge_team_members").select("id, name"),
    ]);
  const teamById = new Map((team ?? []).map((t) => [t.id, t.name]));

  const industries = [
    ...new Set((industriesRaw ?? []).map((r) => r.industry?.trim()).filter(Boolean)),
  ].sort() as string[];

  const rows = prospects ?? [];

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Prospect database</h1>
          <p>
            {rows.length} prospect{rows.length === 1 ? "" : "s"}
            {q || status || industry || campaign ? " matching your filters" : ""} —
            search, filter, add manually or import in bulk.
          </p>
        </div>
        <a href="/growth/reports/export?type=prospects" className="btn btn-secondary">
          <Download size={14} /> Export CSV
        </a>
      </div>

      <details className="panel panel-block" style={{ marginBottom: 12 }} open={rows.length === 0}>
        <summary style={{ cursor: "pointer", fontWeight: 600 }}>
          ✦ Research a company (paste a website)
        </summary>
        <ActionForm action={quickResearch} style={{ marginTop: 10 }}>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <div style={{ flex: "2 1 240px" }}>
              <label htmlFor="pqr-website">Company website *</label>
              <input id="pqr-website" name="website" required placeholder="https://…" maxLength={300} style={{ width: "100%" }} />
            </div>
            <div style={{ flex: "1 1 170px" }}>
              <label htmlFor="pqr-company">Company (optional)</label>
              <input id="pqr-company" name="company" maxLength={200} style={{ width: "100%" }} />
            </div>
            <div style={{ flex: "1 1 170px" }}>
              <label htmlFor="pqr-contact">Contact (optional)</label>
              <input id="pqr-contact" name="contact_name" maxLength={200} style={{ width: "100%" }} />
            </div>
            <div style={{ flex: "1 1 170px" }}>
              <label htmlFor="pqr-email">Email (optional)</label>
              <input id="pqr-email" name="email" type="email" maxLength={300} style={{ width: "100%" }} />
            </div>
          </div>
          <div className="form-actions">
            <SubmitButton pendingText="Researching (30–60s)…">
              <Sparkles size={14} /> Create &amp; research
            </SubmitButton>
          </div>
        </ActionForm>
      </details>

      <form
        method="get"
        className="panel panel-block"
        style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "end", marginBottom: 16 }}
        aria-label="Filter prospects"
      >
        <div style={{ flex: "2 1 220px", minWidth: 180 }}>
          <label htmlFor="pf-q" style={{ fontSize: 12, color: "var(--faint)" }}>
            Search
          </label>
          <input
            id="pf-q"
            type="search"
            name="q"
            defaultValue={params.q ?? ""}
            placeholder="Company, contact, email…"
            style={{ width: "100%" }}
          />
        </div>
        <div style={{ flex: "1 1 140px" }}>
          <label htmlFor="pf-status" style={{ fontSize: 12, color: "var(--faint)" }}>
            Status
          </label>
          <select id="pf-status" name="status" defaultValue={status} style={{ width: "100%" }}>
            <option value="">All statuses</option>
            {PROSPECT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {PROSPECT_STATUS_META[s].label}
              </option>
            ))}
          </select>
        </div>
        <div style={{ flex: "1 1 140px" }}>
          <label htmlFor="pf-industry" style={{ fontSize: 12, color: "var(--faint)" }}>
            Industry
          </label>
          <select id="pf-industry" name="industry" defaultValue={industry} style={{ width: "100%" }}>
            <option value="">All industries</option>
            {industries.map((i) => (
              <option key={i} value={i}>
                {i}
              </option>
            ))}
          </select>
        </div>
        <div style={{ flex: "1 1 140px" }}>
          <label htmlFor="pf-campaign" style={{ fontSize: 12, color: "var(--faint)" }}>
            Campaign
          </label>
          <select id="pf-campaign" name="campaign" defaultValue={campaign} style={{ width: "100%" }}>
            <option value="">All campaigns</option>
            {(campaigns ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button type="submit" className="btn btn-secondary">
            Apply
          </button>
          <Link href="/growth/prospects" className="btn btn-ghost">
            Reset
          </Link>
        </div>
      </form>

      <details className="panel panel-block" style={{ marginBottom: 12 }}>
        <summary style={{ cursor: "pointer", fontWeight: 600 }}>+ Add a prospect</summary>
        <ActionForm action={addProspect} className="form-card" style={{ border: 0, background: "none", padding: "12px 0 0" }}>
          <div className="grid-2">
            <div>
              <label htmlFor="np-company">Company *</label>
              <input id="np-company" name="company" required maxLength={200} />
              <label htmlFor="np-contact">Contact name *</label>
              <input id="np-contact" name="contact_name" required maxLength={200} />
              <label htmlFor="np-title">Job title</label>
              <input id="np-title" name="job_title" maxLength={200} />
              <label htmlFor="np-industry">Industry</label>
              <input id="np-industry" name="industry" maxLength={200} list="industry-list" />
              <datalist id="industry-list">
                {industries.map((i) => (
                  <option key={i} value={i} />
                ))}
              </datalist>
              <label htmlFor="np-website">Website</label>
              <input id="np-website" name="website" maxLength={300} placeholder="https://…" />
              <label htmlFor="np-location">Location</label>
              <input id="np-location" name="location" maxLength={200} />
            </div>
            <div>
              <label htmlFor="np-email">Email</label>
              <input id="np-email" name="email" type="email" maxLength={300} />
              <label htmlFor="np-phone">Phone</label>
              <input id="np-phone" name="phone" maxLength={50} />
              <label htmlFor="np-linkedin">LinkedIn URL</label>
              <input id="np-linkedin" name="linkedin_url" maxLength={500} placeholder="https://linkedin.com/in/…" />
              <label htmlFor="np-instagram">Instagram URL</label>
              <input id="np-instagram" name="instagram_url" maxLength={500} placeholder="https://instagram.com/…" />
              <label htmlFor="np-campaign">Campaign</label>
              <select id="np-campaign" name="campaign_id" defaultValue="">
                <option value="">No campaign</option>
                {(campaigns ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <label htmlFor="np-notes">Notes</label>
              <textarea id="np-notes" name="notes" rows={3} maxLength={4000} />
            </div>
          </div>
          <div className="form-actions">
            <SubmitButton pendingText="Adding…">Add prospect</SubmitButton>
          </div>
        </ActionForm>
      </details>

      <details className="panel panel-block" style={{ marginBottom: 16 }}>
        <summary style={{ cursor: "pointer", fontWeight: 600 }}>⇪ Import from CSV</summary>
        <ActionForm action={importProspects} className="form-card" style={{ border: 0, background: "none", padding: "12px 0 0" }}>
          <p style={{ fontSize: 13, color: "var(--faint)", marginTop: 0 }}>
            Paste CSV with a header row. Recognised columns (any order):{" "}
            <code style={{ fontSize: 12 }}>{CSV_HINT}</code>. Rows with an email
            that already exists are skipped.
          </p>
          <label htmlFor="imp-csv">CSV data</label>
          <textarea
            id="imp-csv"
            name="csv"
            rows={6}
            required
            placeholder={`company,contact_name,email\nAcme Ltd,Jane Murphy,jane@acme.ie`}
          />
          <label htmlFor="imp-campaign">Assign all to campaign (optional)</label>
          <select id="imp-campaign" name="campaign_id" defaultValue="">
            <option value="">No campaign</option>
            {(campaigns ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <div className="form-actions">
            <SubmitButton pendingText="Importing…">Import prospects</SubmitButton>
          </div>
        </ActionForm>
      </details>

      {rows.length === 0 ? (
        <div className="panel panel-block">
          <p className="empty-state">
            No prospects found. Add one above or adjust the filters.
          </p>
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Prospect</th>
                <th>Title</th>
                <th>Industry</th>
                <th>Location</th>
                <th>Status</th>
                <th>Score</th>
                <th>Assigned</th>
                <th>Last contact</th>
                <th>Next follow-up</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const meta = PROSPECT_STATUS_META[p.status as ProspectStatus];
                return (
                  <tr key={p.id}>
                    <td>
                      <Link href={`/growth/prospects/${p.id}`}>
                        <strong>{p.company}</strong>
                      </Link>
                      <div style={{ color: "var(--faint)", fontSize: 12 }}>
                        {p.contact_name}
                        {p.email ? ` · ${p.email}` : ""}
                      </div>
                    </td>
                    <td>{p.job_title ?? "—"}</td>
                    <td>{p.industry ?? "—"}</td>
                    <td>{p.location ?? "—"}</td>
                    <td>
                      <span className={`badge ${meta?.badge ?? "badge-gray"}`}>
                        {meta?.label ?? p.status}
                      </span>
                    </td>
                    <td>{p.lead_score > 0 ? `${p.lead_score}` : "—"}</td>
                    <td>{p.assigned_to ? (teamById.get(p.assigned_to) ?? "—") : "—"}</td>
                    <td>{p.last_contact_at ? p.last_contact_at.slice(0, 10) : "—"}</td>
                    <td>{p.next_follow_up_at ?? "—"}</td>
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
