import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Eye } from "lucide-react";
import { requireAdmin } from "@/lib/auth/require-admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { Markdown, extractHeadings } from "@/components/documentation/markdown";
import { DocToc } from "@/components/documentation/doc-reader";
import { DocIcon } from "@/components/documentation/doc-icon";

export default async function DocumentPreview({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await params;
  const supabase = createAdminClient();

  // Admin preview: service-role read, so drafts and archived docs are visible
  // exactly as a customer would see them once published.
  const { data: doc } = await supabase
    .from("doc_documents")
    .select("title, category, summary, icon, content, status, version, updated_at")
    .eq("id", id)
    .maybeSingle();
  if (!doc) notFound();

  const headings = extractHeadings(doc.content);

  return (
    <div className="doc-viewer">
      <div className="doc-preview-banner">
        <Eye size={14} />
        <span>
          Admin preview — this is exactly how customers see it.{" "}
          {doc.status !== "published" && (
            <strong>Currently {doc.status} (not visible to customers yet).</strong>
          )}
        </span>
        <Link href={`/admin/documentation/${id}`} className="btn btn-ghost btn-sm">
          <ArrowLeft size={13} /> Back to editor
        </Link>
      </div>

      <div className="doc-layout">
        <article id="doc-article" className="doc-article">
          <header className="doc-cover">
            <div className="doc-cover-brand">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/logo-aiq.png" alt="AutomateIQ" />
              <span className="doc-cover-cat">{doc.category}</span>
            </div>
            <div className="doc-cover-icon">
              <DocIcon name={doc.icon} size={26} />
            </div>
            <h1>{doc.title}</h1>
            {doc.summary && <p className="doc-cover-summary">{doc.summary}</p>}
            <p className="doc-cover-meta">
              Version {doc.version} · Updated{" "}
              {new Date(doc.updated_at).toLocaleDateString("en-IE", {
                day: "numeric",
                month: "long",
                year: "numeric",
              })}
            </p>
          </header>

          <Markdown content={doc.content} />
        </article>

        <aside className="doc-aside">
          <DocToc headings={headings} />
        </aside>
      </div>
    </div>
  );
}
