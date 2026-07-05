import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight, ArrowLeft } from "lucide-react";
import { requireSession } from "@/lib/auth/require-session";
import { createClient } from "@/lib/supabase/server";
import { Markdown, extractHeadings } from "@/components/documentation/markdown";
import { DocProgress, DocToc } from "@/components/documentation/doc-reader";
import { DocIcon } from "@/components/documentation/doc-icon";

export default async function DocumentViewer({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  await requireSession();
  const { slug } = await params;
  const supabase = await createClient();

  // RLS enforces access — a document not visible to this business simply
  // returns nothing here, exactly as if it didn't exist.
  const { data: doc } = await supabase
    .from("doc_documents")
    .select("title, category, summary, icon, content, updated_at, version")
    .eq("slug", slug)
    .maybeSingle();

  if (!doc) notFound();

  const headings = extractHeadings(doc.content);

  return (
    <div className="doc-viewer">
      <DocProgress />

      <nav className="doc-breadcrumb" aria-label="Breadcrumb">
        <Link href="/portal/documentation">Documentation</Link>
        <ChevronRight size={13} />
        <span>{doc.category}</span>
        <ChevronRight size={13} />
        <span className="is-current">{doc.title}</span>
      </nav>

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

          <footer className="doc-article-foot">
            <Link href="/portal/documentation" className="doc-back">
              <ArrowLeft size={14} /> Back to Documentation Centre
            </Link>
            <span className="doc-foot-brand">AutomateIQ</span>
          </footer>
        </article>

        <aside className="doc-aside">
          <DocToc headings={headings} />
        </aside>
      </div>
    </div>
  );
}
