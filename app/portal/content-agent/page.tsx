import { PenLine, Library } from "lucide-react";
import { requireSession } from "@/lib/auth/require-session";
import { createClient } from "@/lib/supabase/server";
import { StatCard } from "@/components/portal/stat-card";
import { ContentGenerator } from "./generator";

const TYPE_LABELS: Record<string, string> = {
  blog: "Blog",
  social: "Social",
  email: "Email",
  ad: "Ad copy",
  other: "Other",
};

export default async function ContentAgentPage() {
  await requireSession();
  const supabase = await createClient();

  // RLS-scoped; reads empty until manual_update_0007.sql is run.
  const [{ data: library }, { count: total }] = await Promise.all([
    supabase
      .from("ca_content")
      .select("id, content_type, topic, body, created_at")
      .order("created_at", { ascending: false })
      .limit(20),
    supabase.from("ca_content").select("id", { count: "exact", head: true }),
  ]);

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Content Agent</h1>
          <p>
            On-brand blogs, social posts, emails and ad copy — written from
            your business knowledge in seconds.
          </p>
        </div>
      </div>

      <div className="stat-grid">
        <StatCard
          label="Pieces written"
          value={total ?? 0}
          icon={<PenLine />}
          accent="#EC4899"
          hint="all time"
        />
        <StatCard
          label="In your library"
          value={(library ?? []).length}
          icon={<Library />}
          accent="#8B5CF6"
          hint="most recent 20 shown"
        />
      </div>

      <div className="grid-main-side">
        <ContentGenerator />

        <div className="panel panel-block">
          <h2 className="panel-title">
            <span>
              <span className="sys-index">02 /</span>How it writes
            </span>
          </h2>
          <ol className="timeline">
            <li>
              <h3>Your voice</h3>
              <p>
                It writes in the tone and business knowledge you set under{" "}
                <a href="/portal/settings" style={{ color: "var(--ac2)" }}>
                  Settings → Business knowledge
                </a>{" "}
                — the more detail there, the better the copy.
              </p>
            </li>
            <li>
              <h3>Never invents facts</h3>
              <p>
                Prices, services and policies come from your knowledge —
                anything unknown stays generic instead of made up.
              </p>
            </li>
            <li>
              <h3>Saved automatically</h3>
              <p>
                Every piece lands in your library below — and you can ask
                the AI Assistant to write content too.
              </p>
            </li>
          </ol>
        </div>
      </div>

      <h2 className="section-title">Library</h2>
      {(library ?? []).length === 0 ? (
        <div className="panel panel-block">
          <p className="empty-state">
            Nothing written yet — generate your first piece above.
          </p>
        </div>
      ) : (
        <div className="content-library">
          {(library ?? []).map((item) => (
            <details key={item.id} className="panel content-item">
              <summary>
                <span className="badge badge-blue">
                  {TYPE_LABELS[item.content_type] ?? item.content_type}
                </span>
                <span className="content-topic">{item.topic}</span>
                <span className="feed-time">
                  {new Date(item.created_at).toLocaleDateString("en-IE", {
                    day: "numeric",
                    month: "short",
                  })}
                </span>
              </summary>
              <pre>{item.body}</pre>
            </details>
          ))}
        </div>
      )}
    </>
  );
}
