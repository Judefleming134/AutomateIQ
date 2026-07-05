import Link from "next/link";
import { Plus, Library, Users2, ExternalLink, AlertTriangle } from "lucide-react";
import { requireAdmin } from "@/lib/auth/require-admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { ActionForm } from "@/components/admin/action-form";
import { SubmitButton } from "@/components/admin/submit-button";
import { DocIcon } from "@/components/documentation/doc-icon";
import { isMissingTableError } from "@/lib/db/errors";
import { seedLibrary, createDocument } from "./actions";

const STATUS_META: Record<string, { label: string; cls: string }> = {
  published: { label: "Published", cls: "doc-badge-published" },
  draft: { label: "Draft", cls: "doc-badge-draft" },
  archived: { label: "Archived", cls: "doc-badge-archived" },
};

export default async function AdminDocumentationPage() {
  await requireAdmin();
  const supabase = createAdminClient();

  const [{ data: docs, error: docsError }, { count: groupCount }, { data: assignRows }] =
    await Promise.all([
      supabase
        .from("doc_documents")
        .select("id, slug, title, category, icon, status, version, is_global, sort_order, updated_at")
        .order("category", { ascending: true })
        .order("sort_order", { ascending: true }),
      supabase.from("doc_groups").select("id", { count: "exact", head: true }),
      supabase.from("doc_assignments").select("document_id"),
    ]);

  // The documentation tables ship in migration 0009. If it hasn't been run in
  // the Supabase SQL Editor yet, show a clear setup step rather than a raw
  // schema-cache error or a misleading empty state.
  if (docsError && isMissingTableError(docsError)) {
    return (
      <>
        <div className="page-header">
          <div>
            <h1>Documentation</h1>
            <p>One quick database step is needed before you can use this.</p>
          </div>
        </div>
        <div className="panel panel-block">
          <div className="doc-seed-cta">
            <AlertTriangle size={22} />
            <div>
              <strong>Database update required</strong>
              <p>
                Run <code>supabase/manual_update_0009.sql</code> in the Supabase SQL Editor
                (one paste, safe to re-run). It creates the documentation tables. Refresh this
                page afterwards and you&apos;ll be able to load the starter library.
              </p>
            </div>
          </div>
        </div>
      </>
    );
  }

  const all = docs ?? [];
  const assignCounts = new Map<string, number>();
  for (const r of assignRows ?? []) {
    assignCounts.set(r.document_id, (assignCounts.get(r.document_id) ?? 0) + 1);
  }

  const published = all.filter((d) => d.status === "published").length;
  const drafts = all.filter((d) => d.status === "draft").length;

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Documentation</h1>
          <p>
            Author documents once, then publish and assign them to individual
            customers or groups. Customers see only what you assign — enforced
            by the database, not just the UI.
          </p>
        </div>
        <Link href="/admin/documentation/groups" className="btn btn-secondary">
          <Users2 size={14} /> Manage groups {groupCount ? `(${groupCount})` : ""}
        </Link>
      </div>

      <div className="stat-row" style={{ marginBottom: 20 }}>
        <div className="stat-chip">
          <span className="stat-chip-value">{all.length}</span>
          <span className="stat-chip-label">Documents</span>
        </div>
        <div className="stat-chip">
          <span className="stat-chip-value">{published}</span>
          <span className="stat-chip-label">Published</span>
        </div>
        <div className="stat-chip">
          <span className="stat-chip-value">{drafts}</span>
          <span className="stat-chip-label">Drafts</span>
        </div>
      </div>

      {all.length === 0 && (
        <div className="panel panel-block" style={{ marginBottom: 20 }}>
          <div className="doc-seed-cta">
            <Library size={22} />
            <div>
              <strong>Start with the professional library</strong>
              <p>
                Load 16 ready-to-use documents — welcome pack, onboarding guide,
                SOW, training manual, SLAs, GDPR &amp; security policy and more.
                You can edit every one before publishing.
              </p>
            </div>
            <ActionForm action={seedLibrary} className="inline-form">
              <SubmitButton pendingText="Loading…">Load starter library</SubmitButton>
            </ActionForm>
          </div>
        </div>
      )}

      <div className="admin-doc-toolbar">
        <details className="disclosure">
          <summary>
            <Plus size={14} /> New document
          </summary>
          <ActionForm action={createDocument} className="panel form-card">
            <div className="field-grid">
              <div className="field">
                <label htmlFor="title">Title</label>
                <input id="title" name="title" type="text" required placeholder="Welcome Pack" />
              </div>
              <div className="field">
                <label htmlFor="category">Category</label>
                <input id="category" name="category" type="text" required placeholder="Getting Started" />
              </div>
            </div>
            <div className="field">
              <label htmlFor="summary">Summary</label>
              <input id="summary" name="summary" type="text" placeholder="One line shown on the document card." />
            </div>
            <div className="field-grid">
              <div className="field">
                <label htmlFor="icon">Icon</label>
                <input id="icon" name="icon" type="text" placeholder="file-text" defaultValue="file-text" />
              </div>
              <div className="field">
                <label htmlFor="sortOrder">Sort order</label>
                <input id="sortOrder" name="sortOrder" type="number" defaultValue={100} />
              </div>
            </div>
            <div className="field">
              <label htmlFor="content">Content (Markdown)</label>
              <textarea id="content" name="content" rows={6} placeholder="# Heading&#10;&#10;Write in Markdown — headings, tables, callouts, checklists all supported." />
            </div>
            <div className="form-actions">
              <SubmitButton pendingText="Creating…">Create as draft</SubmitButton>
            </div>
          </ActionForm>
        </details>

        {all.length > 0 && (
          <ActionForm action={seedLibrary} className="inline-form">
            <SubmitButton className="btn btn-secondary" pendingText="Syncing…">
              <Library size={14} /> Refresh starter library
            </SubmitButton>
          </ActionForm>
        )}
      </div>

      <div className="table-wrap">
        {all.length === 0 ? (
          <p className="empty-state">No documents yet — load the starter library or create one above.</p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Document</th>
                <th>Category</th>
                <th>Status</th>
                <th>Visibility</th>
                <th>Version</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {all.map((d) => {
                const status = STATUS_META[d.status] ?? STATUS_META.draft;
                const assigned = assignCounts.get(d.id) ?? 0;
                const visibility = d.is_global
                  ? "All customers"
                  : assigned > 0
                    ? `${assigned} assigned`
                    : "Unassigned";
                return (
                  <tr key={d.id}>
                    <td>
                      <Link href={`/admin/documentation/${d.id}`} className="doc-row-link">
                        <span className="doc-row-icon">
                          <DocIcon name={d.icon ?? undefined} size={15} />
                        </span>
                        <span style={{ color: "var(--heading)", fontWeight: 600 }}>{d.title}</span>
                      </Link>
                    </td>
                    <td>{d.category}</td>
                    <td>
                      <span className={`doc-badge ${status.cls}`}>{status.label}</span>
                    </td>
                    <td style={{ color: d.is_global ? "var(--ac2)" : "var(--body)" }}>{visibility}</td>
                    <td style={{ fontFamily: "var(--mono)", color: "var(--faint)" }}>v{d.version}</td>
                    <td>
                      <div className="doc-row-actions">
                        <Link href={`/admin/documentation/${d.id}`} className="btn btn-secondary btn-sm">
                          Edit
                        </Link>
                        <Link
                          href={`/admin/documentation/${d.id}/preview`}
                          className="btn btn-ghost btn-sm"
                          title="Preview"
                        >
                          <ExternalLink size={13} />
                        </Link>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
