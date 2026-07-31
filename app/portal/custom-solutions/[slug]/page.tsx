import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { requireSession } from "@/lib/auth/require-session";
import { createClient } from "@/lib/supabase/server";

export default async function CustomModulePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  await requireSession();
  const { slug } = await params;
  const supabase = await createClient();

  // RLS scopes this to the caller's own business — a slug belonging to
  // another tenant returns no rows and 404s.
  const { data: mod } = await supabase
    .from("custom_modules")
    .select("id, name, description, config")
    .eq("route_slug", slug)
    .maybeSingle();

  if (!mod) notFound();

  const config = (mod.config ?? {}) as { content?: string; embed_url?: string };
  const paragraphs = (config.content ?? "")
    .split(/\n{2,}|\n/)
    .map((p) => p.trim())
    .filter(Boolean);

  return (
    <>
      <div className="page-header">
        <div>
          <Link
            href="/portal/custom-solutions"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontSize: 12.5,
              color: "var(--ac2)",
              textDecoration: "none",
              marginBottom: 8,
            }}
          >
            <ArrowLeft size={13} /> CustomIQ
          </Link>
          <h1>{mod.name}</h1>
          {mod.description && <p>{mod.description}</p>}
        </div>
        {config.embed_url && (
          <a
            href={config.embed_url}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-secondary"
          >
            Open in new tab <ExternalLink size={14} />
          </a>
        )}
      </div>

      {paragraphs.length > 0 && (
        <div className="panel panel-block" style={{ marginBottom: 18 }}>
          {paragraphs.map((p, i) => (
            <p
              key={i}
              style={{
                margin: i === 0 ? 0 : "12px 0 0",
                fontSize: 14,
                lineHeight: 1.65,
                color: "var(--body)",
              }}
            >
              {p}
            </p>
          ))}
        </div>
      )}

      {config.embed_url && (
        <div className="panel" style={{ overflow: "hidden" }}>
          <iframe
            src={config.embed_url}
            title={mod.name}
            style={{
              display: "block",
              width: "100%",
              height: "70vh",
              border: 0,
              background: "#fff",
            }}
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          />
        </div>
      )}

      {paragraphs.length === 0 && !config.embed_url && (
        <div className="panel empty-state" style={{ borderRadius: "var(--radius)" }}>
          This module hasn&apos;t been configured yet.
        </div>
      )}
    </>
  );
}
