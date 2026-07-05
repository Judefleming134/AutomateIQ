import Link from "next/link";
import { BookOpen, Search, ArrowRight } from "lucide-react";
import { requireSession } from "@/lib/auth/require-session";
import { createClient } from "@/lib/supabase/server";
import { DOC_CATEGORY_ORDER } from "@/lib/documentation/library";
import { DocIcon } from "@/components/documentation/doc-icon";

export default async function DocumentationCentre({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  await requireSession();
  const supabase = await createClient();
  const { q = "" } = await searchParams;
  const query = q.replace(/[,()%]/g, " ").trim();

  // RLS returns only documents visible to this business (published +
  // global/assigned/grouped). No frontend filtering needed for access.
  let docsQuery = supabase
    .from("doc_documents")
    .select("id, slug, title, category, summary, icon, sort_order, updated_at")
    .order("sort_order", { ascending: true })
    .limit(300);
  if (query) {
    docsQuery = docsQuery.or(`title.ilike.%${query}%,summary.ilike.%${query}%`);
  }
  const { data: docs } = await docsQuery;
  const all = docs ?? [];

  const known = new Set(DOC_CATEGORY_ORDER);
  const categories = [
    ...DOC_CATEGORY_ORDER.filter((c) => all.some((d) => d.category === c)),
    ...[...new Set(all.map((d) => d.category))].filter((c) => !known.has(c)),
  ];

  return (
    <>
      <section className="doc-hero">
        <div className="doc-hero-mark">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-aiq.png" alt="AutomateIQ" />
        </div>
        <p className="doc-hero-kicker">
          <BookOpen size={13} /> Documentation Centre
        </p>
        <h1>Everything you need, in one place</h1>
        <p className="doc-hero-sub">
          Guides, policies and reference material for getting the most from
          your AutomateIQ platform.
        </p>
        <form method="get" className="doc-search">
          <Search size={16} />
          <input type="text" name="q" placeholder="Search documentation…" defaultValue={q} />
        </form>
      </section>

      {all.length === 0 ? (
        <div className="panel panel-block" style={{ marginTop: 24 }}>
          <p className="empty-state">
            {query
              ? "No documents match that search."
              : "No documents have been shared with you yet — they'll appear here as your team publishes them."}
          </p>
        </div>
      ) : (
        categories.map((category) => (
          <section key={category} className="doc-cat">
            <h2 className="doc-cat-title">{category}</h2>
            <div className="doc-grid">
              {all
                .filter((d) => d.category === category)
                .map((doc) => (
                  <Link key={doc.id} href={`/portal/documentation/${doc.slug}`} className="doc-card panel">
                    <span className="doc-card-icon">
                      <DocIcon name={doc.icon} />
                    </span>
                    <span className="doc-card-body">
                      <span className="doc-card-title">{doc.title}</span>
                      <span className="doc-card-summary">{doc.summary}</span>
                    </span>
                    <ArrowRight size={16} className="doc-card-arrow" />
                  </Link>
                ))}
            </div>
          </section>
        ))
      )}
    </>
  );
}
