import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, ExternalLink, History, RotateCcw } from "lucide-react";
import { requireAdmin } from "@/lib/auth/require-admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { ActionForm } from "@/components/admin/action-form";
import { SubmitButton } from "@/components/admin/submit-button";
import {
  saveDocument,
  publishDocument,
  setDocumentStatus,
  deleteDocument,
  setGlobal,
  setBusinessAssignments,
  setGroupAssignments,
  restoreVersion,
} from "../actions";

export default async function DocumentEditor({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await params;
  const supabase = createAdminClient();

  const { data: doc } = await supabase
    .from("doc_documents")
    .select("id, slug, title, category, summary, icon, content, status, version, is_global, sort_order, updated_at")
    .eq("id", id)
    .maybeSingle();
  if (!doc) notFound();

  const [
    { data: businesses },
    { data: groups },
    { data: assignments },
    { data: groupAssignments },
    { data: versions },
  ] = await Promise.all([
    supabase
      .from("businesses")
      .select("id, name")
      .is("deleted_at", null)
      .eq("status", "active")
      .order("name"),
    supabase.from("doc_groups").select("id, name").order("name"),
    supabase.from("doc_assignments").select("business_id").eq("document_id", id),
    supabase.from("doc_group_assignments").select("group_id").eq("document_id", id),
    supabase
      .from("doc_versions")
      .select("id, version, title, created_at")
      .eq("document_id", id)
      .order("version", { ascending: false }),
  ]);

  const assignedBiz = new Set((assignments ?? []).map((a) => a.business_id));
  const assignedGroups = new Set((groupAssignments ?? []).map((g) => g.group_id));

  // Bind the document id into the lifecycle/global actions (they take a plain id).
  async function doPublish() {
    "use server";
    return publishDocument(id);
  }
  async function doUnpublish() {
    "use server";
    return setDocumentStatus(id, "draft");
  }
  async function doArchive() {
    "use server";
    return setDocumentStatus(id, "archived");
  }
  async function doDelete() {
    "use server";
    await deleteDocument(id);
    redirect("/admin/documentation");
  }
  async function makeGlobal(_p: unknown, _f: FormData) {
    "use server";
    return setGlobal(id, !doc!.is_global);
  }

  return (
    <>
      <div className="doc-breadcrumb" style={{ marginBottom: 16 }}>
        <Link href="/admin/documentation">
          <ArrowLeft size={13} style={{ verticalAlign: "-2px", marginRight: 4 }} />
          Documentation
        </Link>
      </div>

      <div className="page-header">
        <div>
          <h1>{doc.title}</h1>
          <p>
            <span className={`doc-badge doc-badge-${doc.status}`}>{doc.status}</span>
            <span style={{ margin: "0 8px", color: "var(--faint)" }}>·</span>
            <span style={{ fontFamily: "var(--mono)", fontSize: 12.5 }}>/{doc.slug}</span>
            <span style={{ margin: "0 8px", color: "var(--faint)" }}>·</span>
            v{doc.version}
          </p>
        </div>
        <Link href={`/admin/documentation/${id}/preview`} className="btn btn-secondary">
          <ExternalLink size={14} /> Preview
        </Link>
      </div>

      <div className="doc-editor">
        {/* Editor form */}
        <ActionForm action={saveDocument} className="panel form-card" style={{ maxWidth: "none" }}>
          <input type="hidden" name="id" value={id} />
          <div className="field-grid">
            <div className="field">
              <label htmlFor="title">Title</label>
              <input id="title" name="title" type="text" required defaultValue={doc.title} />
            </div>
            <div className="field">
              <label htmlFor="category">Category</label>
              <input id="category" name="category" type="text" required defaultValue={doc.category} />
            </div>
          </div>
          <div className="field">
            <label htmlFor="summary">Summary</label>
            <input id="summary" name="summary" type="text" defaultValue={doc.summary ?? ""} />
          </div>
          <div className="field-grid">
            <div className="field">
              <label htmlFor="icon">Icon</label>
              <input id="icon" name="icon" type="text" defaultValue={doc.icon ?? "file-text"} />
            </div>
            <div className="field">
              <label htmlFor="sortOrder">Sort order</label>
              <input id="sortOrder" name="sortOrder" type="number" defaultValue={doc.sort_order} />
            </div>
          </div>
          <div className="field">
            <label htmlFor="content">Content (Markdown)</label>
            <textarea
              id="content"
              name="content"
              className="doc-content-area"
              defaultValue={doc.content}
            />
          </div>
          <div className="form-actions">
            <SubmitButton pendingText="Saving…">Save changes</SubmitButton>
          </div>
        </ActionForm>

        {/* Side rail: lifecycle, assignment, versions */}
        <div className="doc-editor-side">
          <div className="doc-side-panel">
            <h3>Lifecycle</h3>
            <div className="doc-lifecycle">
              {doc.status !== "published" ? (
                <ActionForm action={doPublish} className="inline-form">
                  <SubmitButton className="btn btn-primary btn-sm" pendingText="Publishing…">
                    Publish
                  </SubmitButton>
                </ActionForm>
              ) : (
                <ActionForm action={doPublish} className="inline-form">
                  <SubmitButton className="btn btn-primary btn-sm" pendingText="Publishing…">
                    Publish update (v{doc.version + 1})
                  </SubmitButton>
                </ActionForm>
              )}
              {doc.status === "published" && (
                <ActionForm action={doUnpublish} className="inline-form">
                  <SubmitButton className="btn btn-secondary btn-sm" pendingText="…">
                    Unpublish
                  </SubmitButton>
                </ActionForm>
              )}
              {doc.status !== "archived" && (
                <ActionForm action={doArchive} className="inline-form">
                  <SubmitButton className="btn btn-ghost btn-sm" pendingText="…">
                    Archive
                  </SubmitButton>
                </ActionForm>
              )}
              {doc.status === "archived" && (
                <ActionForm action={doUnpublish} className="inline-form">
                  <SubmitButton className="btn btn-secondary btn-sm" pendingText="…">
                    Restore to draft
                  </SubmitButton>
                </ActionForm>
              )}
            </div>
          </div>

          <div className="doc-side-panel">
            <h3>Visibility</h3>
            <ActionForm action={makeGlobal} className="inline-form" style={{ marginBottom: 12 }}>
              <SubmitButton
                className={doc.is_global ? "btn btn-primary btn-sm" : "btn btn-secondary btn-sm"}
                pendingText="…"
              >
                {doc.is_global ? "✓ Visible to all customers" : "Make visible to all customers"}
              </SubmitButton>
            </ActionForm>
            <p style={{ fontSize: 12, color: "var(--faint)", margin: "0 0 4px" }}>
              {doc.is_global
                ? "Global — every active customer sees this once published. Specific assignments below are ignored while global."
                : "Assign to specific customers below, or make it global."}
            </p>
          </div>

          {/* Per-business assignment */}
          <div className="doc-side-panel">
            <h3>Assign to customers</h3>
            <ActionForm action={setBusinessAssignments}>
              <input type="hidden" name="id" value={id} />
              <div className="doc-check-list">
                {(businesses ?? []).length === 0 && (
                  <p className="empty-state" style={{ fontSize: 12 }}>No active customers.</p>
                )}
                {(businesses ?? []).map((b) => (
                  <label key={b.id} className="doc-check-row">
                    <input
                      type="checkbox"
                      name="businessIds"
                      value={b.id}
                      defaultChecked={assignedBiz.has(b.id)}
                    />
                    {b.name}
                  </label>
                ))}
              </div>
              <SubmitButton className="btn btn-secondary btn-sm" pendingText="Saving…">
                Save customer assignments
              </SubmitButton>
            </ActionForm>
          </div>

          {/* Group assignment */}
          <div className="doc-side-panel">
            <h3>Assign to groups</h3>
            {(groups ?? []).length === 0 ? (
              <p style={{ fontSize: 12, color: "var(--faint)", margin: 0 }}>
                No groups yet — <Link href="/admin/documentation/groups" style={{ color: "var(--ac2)" }}>create one</Link>.
              </p>
            ) : (
              <ActionForm action={setGroupAssignments}>
                <input type="hidden" name="id" value={id} />
                <div className="doc-check-list">
                  {(groups ?? []).map((g) => (
                    <label key={g.id} className="doc-check-row">
                      <input
                        type="checkbox"
                        name="groupIds"
                        value={g.id}
                        defaultChecked={assignedGroups.has(g.id)}
                      />
                      {g.name}
                    </label>
                  ))}
                </div>
                <SubmitButton className="btn btn-secondary btn-sm" pendingText="Saving…">
                  Save group assignments
                </SubmitButton>
              </ActionForm>
            )}
          </div>

          {/* Version history */}
          <div className="doc-side-panel">
            <h3><History size={13} style={{ verticalAlign: "-2px", marginRight: 5 }} />Version history</h3>
            {(versions ?? []).length === 0 ? (
              <p style={{ fontSize: 12, color: "var(--faint)", margin: 0 }}>
                No versions yet — a snapshot is saved each time you publish.
              </p>
            ) : (
              <div className="doc-version-list">
                {(versions ?? []).map((v) => {
                  async function restore() {
                    "use server";
                    await restoreVersion(id, v.id);
                  }
                  return (
                    <div key={v.id} className="doc-version-row">
                      <div>
                        <strong style={{ color: "var(--heading)" }}>v{v.version}</strong>
                        <span className="doc-version-meta" style={{ marginLeft: 8 }}>
                          {new Date(v.created_at).toLocaleDateString("en-IE", {
                            day: "numeric",
                            month: "short",
                            year: "numeric",
                          })}
                        </span>
                      </div>
                      <form action={restore}>
                        <button type="submit" className="btn btn-ghost btn-sm" title="Restore this version into the editor">
                          <RotateCcw size={12} /> Restore
                        </button>
                      </form>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Danger zone */}
          <div className="doc-side-panel" style={{ borderColor: "rgba(248,113,113,0.28)" }}>
            <h3 style={{ color: "#fca5a5" }}>Delete</h3>
            <p style={{ fontSize: 12, color: "var(--faint)", margin: "0 0 10px" }}>
              Permanently removes this document, its versions and assignments.
            </p>
            <form action={doDelete}>
              <SubmitButton className="btn btn-danger btn-sm" pendingText="Deleting…">
                Delete document
              </SubmitButton>
            </form>
          </div>
        </div>
      </div>
    </>
  );
}
