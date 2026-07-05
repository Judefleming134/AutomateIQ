import Link from "next/link";
import { ArrowLeft, Plus, Users2 } from "lucide-react";
import { requireAdmin } from "@/lib/auth/require-admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { ActionForm } from "@/components/admin/action-form";
import { SubmitButton } from "@/components/admin/submit-button";
import { createGroup, setGroupMembers, deleteGroup } from "../actions";

export default async function DocumentGroupsPage() {
  await requireAdmin();
  const supabase = createAdminClient();

  const [{ data: groups }, { data: businesses }, { data: members }] =
    await Promise.all([
      supabase.from("doc_groups").select("id, name, description").order("name"),
      supabase
        .from("businesses")
        .select("id, name")
        .is("deleted_at", null)
        .eq("status", "active")
        .order("name"),
      supabase.from("doc_group_members").select("group_id, business_id"),
    ]);

  const membersByGroup = new Map<string, Set<string>>();
  for (const m of members ?? []) {
    if (!membersByGroup.has(m.group_id)) membersByGroup.set(m.group_id, new Set());
    membersByGroup.get(m.group_id)!.add(m.business_id);
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
          <h1>Customer groups</h1>
          <p>
            Bundle customers into a group, then assign a document to the whole
            group at once — everyone in it sees the document.
          </p>
        </div>
      </div>

      <details className="disclosure" style={{ marginBottom: 20 }}>
        <summary>
          <Plus size={14} /> New group
        </summary>
        <ActionForm action={createGroup} className="panel form-card">
          <div className="field">
            <label htmlFor="name">Group name</label>
            <input id="name" name="name" type="text" required placeholder="Premium tier" />
          </div>
          <div className="field">
            <label htmlFor="description">Description</label>
            <input id="description" name="description" type="text" placeholder="Optional — what this group is for." />
          </div>
          <div className="field">
            <label>Members</label>
            <div className="doc-check-list">
              {(businesses ?? []).length === 0 && (
                <p className="empty-state" style={{ fontSize: 12 }}>No active customers.</p>
              )}
              {(businesses ?? []).map((b) => (
                <label key={b.id} className="doc-check-row">
                  <input type="checkbox" name="businessIds" value={b.id} />
                  {b.name}
                </label>
              ))}
            </div>
          </div>
          <div className="form-actions">
            <SubmitButton pendingText="Creating…">Create group</SubmitButton>
          </div>
        </ActionForm>
      </details>

      {(groups ?? []).length === 0 ? (
        <div className="panel panel-block">
          <p className="empty-state">No groups yet — create one above.</p>
        </div>
      ) : (
        <div className="doc-group-grid">
          {(groups ?? []).map((g) => {
            const memberSet = membersByGroup.get(g.id) ?? new Set();
            async function remove() {
              "use server";
              await deleteGroup(g.id);
            }
            return (
              <div key={g.id} className="doc-side-panel">
                <h3>
                  <Users2 size={13} style={{ verticalAlign: "-2px", marginRight: 6 }} />
                  {g.name}
                  <span style={{ marginLeft: 8, color: "var(--faint)", fontFamily: "var(--mono)" }}>
                    {memberSet.size}
                  </span>
                </h3>
                {g.description && (
                  <p style={{ fontSize: 12.5, color: "var(--body)", margin: "0 0 12px" }}>{g.description}</p>
                )}
                <ActionForm action={setGroupMembers}>
                  <input type="hidden" name="groupId" value={g.id} />
                  <div className="doc-check-list">
                    {(businesses ?? []).map((b) => (
                      <label key={b.id} className="doc-check-row">
                        <input
                          type="checkbox"
                          name="businessIds"
                          value={b.id}
                          defaultChecked={memberSet.has(b.id)}
                        />
                        {b.name}
                      </label>
                    ))}
                  </div>
                  <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                    <SubmitButton className="btn btn-secondary btn-sm" pendingText="Saving…">
                      Save members
                    </SubmitButton>
                  </div>
                </ActionForm>
                <form action={remove} style={{ marginTop: 10 }}>
                  <SubmitButton className="btn btn-ghost btn-sm" pendingText="Deleting…">
                    Delete group
                  </SubmitButton>
                </form>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
