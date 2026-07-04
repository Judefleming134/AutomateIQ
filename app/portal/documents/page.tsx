import { FileText, Download } from "lucide-react";
import { requireSession } from "@/lib/auth/require-session";
import { createClient } from "@/lib/supabase/server";

function formatSize(bytes: number | null) {
  if (!bytes) return "";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default async function DocumentsPage() {
  await requireSession();
  const supabase = await createClient();

  // RLS scopes this to the caller's own business automatically.
  const { data: documents } = await supabase
    .from("documents")
    .select("id, name, file_size, created_at")
    .order("created_at", { ascending: false });

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Documents</h1>
          <p>
            Your contracts and paperwork with AutomateIQ — view and download
            copies any time.
          </p>
        </div>
      </div>

      <div className="table-wrap">
        {(documents ?? []).length === 0 ? (
          <p className="empty-state">
            Nothing here yet — documents we share with you will appear on this
            page.
          </p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Document</th>
                <th>Size</th>
                <th>Added</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {(documents ?? []).map((doc) => (
                <tr key={doc.id}>
                  <td>
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 8,
                        color: "var(--heading)",
                        fontWeight: 600,
                      }}
                    >
                      <FileText size={15} style={{ color: "var(--ac2)" }} />
                      {doc.name}
                    </span>
                  </td>
                  <td>{formatSize(doc.file_size)}</td>
                  <td>{new Date(doc.created_at).toLocaleDateString()}</td>
                  <td>
                    <a
                      href={`/portal/documents/${doc.id}/download`}
                      className="btn btn-secondary btn-sm"
                    >
                      <Download size={13} /> Download
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
