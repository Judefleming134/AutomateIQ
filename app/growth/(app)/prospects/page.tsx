import Link from "next/link";
import { Download, Search as SearchIcon, Sparkles } from "lucide-react";
import { requireGrowth } from "@/lib/growth/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { ActionForm } from "@/components/admin/action-form";
import { SubmitButton } from "@/components/admin/submit-button";
import {
  PROSPECT_STATUSES,
  PROSPECT_STATUS_META,
  type ProspectStatus,
} from "@/lib/growth/constants";
import { ResearchQueue } from "@/components/growth/research-queue";
import { ContactHarvest } from "@/components/growth/contact-harvest";
import { CsvFileField } from "@/components/growth/csv-file-field";
import { BulkActions, SelectAll } from "@/components/growth/bulk-actions";
import { addProspect, importProspects, quickResearch } from "./actions";

// Quick research runs a full AI research pass inside this route's actions.
export const maxDuration = 60;

const CSV_HINT =
  "company,contact_name,job_title,industry,website,location,email,phone,linkedin_url,instagram_url,facebook_url,notes";

const SORTS: Record<string, { column: string; ascending: boolean; nulls?: "last" }> = {
  newest: { column: "created_at", ascending: false },
  score: { column: "lead_score", ascending: false },
  follow_up: { column: "next_follow_up_at", ascending: true, nulls: "last" },
  company: { column: "company", ascending: true },
};

export default async function ProspectsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; industry?: string; campaign?: string; sort?: string; page?: string }>;
}) {
  const { member } = await requireGrowth();
  const params = await searchParams;
  const admin = createAdminClient();

  // How many prospects per page. Big enough to scan a lot at once, small
  // enough to stay snappy on a large database.
  const PAGE_SIZE = 100;

  // PostgREST .or() filters are comma-delimited — strip characters that
  // would let a search term escape the ilike pattern into extra clauses.
  const q = (params.q ?? "").trim().replace(/[,()]/g, " ").slice(0, 100).trim();
  const status = (params.status ?? "").trim();
  const industry = (params.industry ?? "").trim();
  const campaign = (params.campaign ?? "").trim();

  // Default to A→Z by company so a lead is easy to find by name; other
  // sorts stay one click away.
  const sortKey = SORTS[params.sort ?? ""] ? params.sort! : "company";
  const sort = SORTS[sortKey];
  // 1-indexed page; clamp to a sane floor here, ceiling once we know the count.
  const pageReq = Math.max(1, Math.floor(Number(params.page)) || 1);
  const from = (pageReq - 1) * PAGE_SIZE;
  let query = admin
    .from("ge_prospects")
    .select(
      "id, company, contact_name, job_title, industry, location, email, phone, status, lead_score, qualification_status, last_contact_at, next_follow_up_at, campaign_id, assigned_to",
      { count: "exact" }
    )
    .order(sort.column, { ascending: sort.ascending, nullsFirst: false })
    // Tie-break so paging is stable when many rows share a sort value
    // (e.g. lots of "—" scores): id is unique, so no row is skipped/repeated
    // across page boundaries.
    .order("id", { ascending: true })
    .range(from, from + PAGE_SIZE - 1);
  if (q) {
    query = query.or(
      `company.ilike.%${q}%,contact_name.ilike.%${q}%,email.ilike.%${q}%,job_title.ilike.%${q}%`
    );
  }
  if (status) query = query.eq("status", status);
  if (industry) query = query.ilike("industry", industry);
  if (campaign) query = query.eq("campaign_id", campaign);

  const [
    { data: prospects, count: totalMatching },
    { data: campaigns },
    { data: industriesRaw },
    { data: team },
    { data: allProspects },
    { data: researched },
    { data: missingEmail },
  ] = await Promise.all([
    query,
    admin.from("ge_campaigns").select("id, name").order("name"),
    admin.from("ge_prospects").select("industry").not("industry", "is", null),
    admin.from("ge_team_members").select("id, name"),
    admin
      .from("ge_prospects")
      .select("id, company, website")
      .not("status", "in", '("won","lost","do_not_contact","archived")')
      .order("created_at", { ascending: false }),
    admin.from("ge_research").select("prospect_id"),
    admin
      .from("ge_prospects")
      .select("id, company")
      .not("website", "is", null)
      .is("email", null)
      .not("status", "in", '("won","lost","do_not_contact","archived")')
      .order("lead_score", { ascending: false, nullsFirst: false })
      .limit(100),
  ]);
  const teamById = new Map((team ?? []).map((t) => [t.id, t.name]));
  const researchedIds = new Set((researched ?? []).map((r) => r.prospect_id));
  // Research the most-researchable leads first: a website is by far the
  // strongest signal for research quality (the engine reads the site), so
  // leads with one lead each batch. Array.sort is stable, so within each
  // group the created_at-desc order from the query is preserved.
  const unresearched = (allProspects ?? [])
    .filter((p) => !researchedIds.has(p.id))
    .sort((a, b) => Number(Boolean(b.website)) - Number(Boolean(a.website)));

  const industries = [
    ...new Set((industriesRaw ?? []).map((r) => r.industry?.trim()).filter(Boolean)),
  ].sort() as string[];

  const rows = prospects ?? [];

  // Pagination maths. Alphabetical order is preserved across pages (the query
  // sort is unchanged); we just window the rows.
  const total = totalMatching ?? rows.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(pageReq, totalPages);
  const firstOnPage = total === 0 ? 0 : from + 1;
  const lastOnPage = from + rows.length;
  // Keep every active filter/sort in the page links; only the page number
  // changes. Search/filter forms omit `page`, so changing a filter resets
  // to page 1 automatically.
  const pageHref = (p: number) => {
    const sp = new URLSearchParams();
    if (q) sp.set("q", q);
    if (status) sp.set("status", status);
    if (industry) sp.set("industry", industry);
    if (campaign) sp.set("campaign", campaign);
    if (params.sort) sp.set("sort", params.sort);
    if (p > 1) sp.set("page", String(p));
    const qs = sp.toString();
    return qs ? `/growth/prospects?${qs}` : "/growth/prospects";
  };
  // Show up to 10 numbered pages, windowed around the current one so the
  // strip never runs off the screen on a big database.
  const WINDOW = 10;
  let winStart = Math.max(1, page - Math.floor(WINDOW / 2));
  const winEnd = Math.min(totalPages, winStart + WINDOW - 1);
  winStart = Math.max(1, winEnd - WINDOW + 1);
  const pageNumbers = Array.from(
    { length: winEnd - winStart + 1 },
    (_, i) => winStart + i
  );

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Prospect database</h1>
          <p>
            {total.toLocaleString("en-IE")} prospect
            {total === 1 ? "" : "s"}
            {q || status || industry || campaign ? " matching your filters" : ""} —
            search, filter, add manually or import in bulk.
          </p>
          {totalPages > 1 && (
            <p style={{ fontSize: 12, color: "var(--faint)", margin: "2px 0 0" }}>
              Showing {firstOnPage.toLocaleString("en-IE")}–
              {lastOnPage.toLocaleString("en-IE")} · page {page} of {totalPages}{" "}
              (alphabetical by company)
            </p>
          )}
        </div>
        <form
          method="get"
          role="search"
          aria-label="Search prospects"
          style={{ display: "flex", gap: 8, alignItems: "center", flex: "1 1 260px", maxWidth: 420 }}
        >
          {status && <input type="hidden" name="status" value={status} />}
          {industry && <input type="hidden" name="industry" value={industry} />}
          {campaign && <input type="hidden" name="campaign" value={campaign} />}
          {params.sort && <input type="hidden" name="sort" value={params.sort} />}
          <input
            type="search"
            name="q"
            defaultValue={params.q ?? ""}
            placeholder="Search company, contact, email…"
            aria-label="Search prospects"
            style={{ flex: 1, margin: 0 }}
          />
          <button type="submit" className="btn btn-secondary">
            <SearchIcon size={14} /> Search
          </button>
        </form>
        <a href="/growth/reports/export?type=prospects" className="btn btn-secondary">
          <Download size={14} /> Export CSV
        </a>
      </div>

      <ResearchQueue
        pending={unresearched}
        claude={Boolean(process.env.ANTHROPIC_API_KEY)}
      />

      <ContactHarvest pending={missingEmail ?? []} />

      <details className="panel panel-block" style={{ marginBottom: 12 }} open={rows.length === 0}>
        <summary style={{ cursor: "pointer", fontWeight: 600 }}>
          ✦ Research a company (paste a website)
        </summary>
        <ActionForm action={quickResearch} style={{ marginTop: 10 }}>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <div style={{ flex: "2 1 240px" }}>
              <label htmlFor="pqr-website">Company website (or leave blank)</label>
              <input id="pqr-website" name="website" placeholder="https://…" maxLength={300} style={{ width: "100%" }} />
            </div>
            <div style={{ flex: "1 1 170px" }}>
              <label htmlFor="pqr-company">Company (required if no website)</label>
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
        <div style={{ flex: "1 1 130px" }}>
          <label htmlFor="pf-sort" style={{ fontSize: 12, color: "var(--faint)" }}>
            Sort by
          </label>
          <select id="pf-sort" name="sort" defaultValue={sortKey} style={{ width: "100%" }}>
            <option value="newest">Newest first</option>
            <option value="score">Lead score</option>
            <option value="follow_up">Next follow-up</option>
            <option value="company">Company A–Z</option>
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
              <label htmlFor="np-facebook">Facebook URL</label>
              <input id="np-facebook" name="facebook_url" maxLength={500} placeholder="https://facebook.com/…" />
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
            Drop a .csv file (Google Sheets: File → Download → .csv) or paste
            rows straight from the sheet. Keep the header row. Recognised
            columns (any order): <code style={{ fontSize: 12 }}>{CSV_HINT}</code>.
            Rows need a company + at least one contact method; duplicate emails
            are skipped.
          </p>
          <CsvFileField />
          <label htmlFor="imp-campaign">Campaign</label>
          <select id="imp-campaign" name="campaign_id" defaultValue="__auto__">
            <option value="__auto__">
              Auto — group by the industry column (creates campaigns as needed)
            </option>
            <option value="">No campaign</option>
            {(campaigns ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                Assign all to: {c.name}
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
          {q || status || industry || campaign ? (
            <p className="empty-state">
              No prospects match your search or filters.{" "}
              <Link href="/growth/prospects">Clear them</Link> to see your whole
              list.
            </p>
          ) : (
            <p className="empty-state">
              No prospects yet. Add one above, or import a CSV to get started.
            </p>
          )}
        </div>
      ) : (
        <>
          <div style={{ marginBottom: 10 }}>
            <BulkActions isOwner={member.role === "owner"} />
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th style={{ width: 34 }}>
                    <SelectAll />
                  </th>
                  <th>Prospect</th>
                <th>Title</th>
                <th>Industry</th>
                <th>Location</th>
                <th>Phone</th>
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
                      <input
                        type="checkbox"
                        name="ids"
                        value={p.id}
                        form="prospect-bulk"
                        aria-label={`Select ${p.company}`}
                      />
                    </td>
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
                      {p.phone ? (
                        <a href={`tel:${p.phone.replace(/[^\d+]/g, "")}`}>
                          {p.phone}
                        </a>
                      ) : (
                        "—"
                      )}
                    </td>
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

          {totalPages > 1 && (
            <nav
              aria-label="Prospect pages"
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 6,
                alignItems: "center",
                justifyContent: "center",
                marginTop: 16,
              }}
            >
              {page > 1 ? (
                <Link href={pageHref(page - 1)} className="btn btn-ghost btn-sm">
                  ← Prev
                </Link>
              ) : (
                <span className="btn btn-ghost btn-sm" aria-disabled style={{ opacity: 0.4, pointerEvents: "none" }}>
                  ← Prev
                </span>
              )}
              {winStart > 1 && (
                <>
                  <Link href={pageHref(1)} className="btn btn-ghost btn-sm">1</Link>
                  <span style={{ color: "var(--faint)", padding: "0 2px" }}>…</span>
                </>
              )}
              {pageNumbers.map((p) =>
                p === page ? (
                  <span
                    key={p}
                    aria-current="page"
                    className="btn btn-primary btn-sm"
                    style={{ pointerEvents: "none" }}
                  >
                    {p}
                  </span>
                ) : (
                  <Link key={p} href={pageHref(p)} className="btn btn-ghost btn-sm">
                    {p}
                  </Link>
                )
              )}
              {winEnd < totalPages && (
                <>
                  <span style={{ color: "var(--faint)", padding: "0 2px" }}>…</span>
                  <Link href={pageHref(totalPages)} className="btn btn-ghost btn-sm">
                    {totalPages}
                  </Link>
                </>
              )}
              {page < totalPages ? (
                <Link href={pageHref(page + 1)} className="btn btn-ghost btn-sm">
                  Next →
                </Link>
              ) : (
                <span className="btn btn-ghost btn-sm" aria-disabled style={{ opacity: 0.4, pointerEvents: "none" }}>
                  Next →
                </span>
              )}
            </nav>
          )}
        </>
      )}
    </>
  );
}
