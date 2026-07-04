import Link from "next/link";
import { Box, FileText, Download, MessageSquare } from "lucide-react";
import { requireSession } from "@/lib/auth/require-session";
import { createClient } from "@/lib/supabase/server";

function formatSize(bytes: number | null) {
  if (!bytes) return "";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default async function ProjectsPage() {
  await requireSession();
  const supabase = await createClient();

  // RLS scopes both to the caller's own business automatically.
  const [{ data: modules }, { data: documents }] = await Promise.all([
    supabase.from("custom_modules").select("id, name, description, route_slug"),
    supabase
      .from("documents")
      .select("id, name, file_size, created_at")
      .order("created_at", { ascending: false }),
  ]);

  const hasModules = (modules ?? []).length > 0;

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Projects</h1>
          <p>
            Bespoke work we&apos;re doing for your business — custom AI
            modules, plus your contracts and paperwork.
          </p>
        </div>
      </div>

      <h2 className="section-title">Custom modules</h2>
      {hasModules ? (
        <div className="product-grid" style={{ marginBottom: 30 }}>
          {(modules ?? []).map((m) => (
            <Link
              key={m.id}
              href={`/portal/custom-solutions/${m.route_slug}`}
              className="panel product-tile"
              style={{ "--tile-accent": "#F472B6" } as React.CSSProperties}
            >
              <div className="product-tile-icon">
                <Box size={21} />
              </div>
              <h3>{m.name}</h3>
              {m.description && <p>{m.description}</p>}
              <span className="badge badge-green">Active</span>
            </Link>
          ))}
        </div>
      ) : (
        <div
          className="panel panel-block"
          style={{
            textAlign: "center",
            padding: "30px 24px",
            marginBottom: 30,
          }}
        >
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 12,
              display: "grid",
              placeItems: "center",
              background: "rgba(244, 114, 182, 0.14)",
              color: "#F472B6",
              margin: "0 auto 12px",
            }}
          >
            <MessageSquare size={20} />
          </div>
          <h3 style={{ fontSize: 15, marginBottom: 4 }}>
            No custom modules yet
          </h3>
          <p style={{ margin: 0, fontSize: 13, color: "var(--body)" }}>
            Describe the repetitive job eating your week — quoting, invoicing,
            scheduling — and we&apos;ll build a module around exactly how your
            business works.{" "}
            <a href="mailto:hello@automateiq.ie" style={{ color: "var(--ac2)" }}>
              hello@automateiq.ie
            </a>
          </p>
        </div>
      )}

      <h2 className="section-title">Documents</h2>
      <div className="table-wrap">
        {(documents ?? []).length === 0 ? (
          <p className="empty-state">
            Nothing here yet — contracts and paperwork we share with you will
            appear on this page.
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
