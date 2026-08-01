import { PenLine, CalendarClock, CheckCircle2, Megaphone } from "lucide-react";
import { requireSession } from "@/lib/auth/require-session";
import { createClient } from "@/lib/supabase/server";
import { StatCard } from "@/components/portal/stat-card";
import { selectAllRows } from "@/lib/growth/db";
import { ContentGenerator } from "./generator";
import {
  CampaignBuilder,
  ScheduleControl,
  PublishButton,
  SendToCustomers,
} from "./content-interactive";

const TYPE_LABELS: Record<string, string> = {
  blog: "Blog",
  social: "Social",
  email: "Email",
  ad: "Ad copy",
  other: "Other",
};

type Item = {
  id: string;
  content_type: string;
  topic: string;
  body: string;
  status: string | null;
  scheduled_for: string | null;
  created_at: string;
};

function ContentCard({ item, sent }: { item: Item; sent: number }) {
  const status = item.status ?? "draft";
  return (
    <details className="panel content-item">
      <summary>
        <span className="badge badge-blue">
          {TYPE_LABELS[item.content_type] ?? item.content_type}
        </span>
        <span className="content-topic">{item.topic}</span>
        <span
          onClick={(e) => e.preventDefault()}
          style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}
        >
          <ScheduleControl id={item.id} scheduledFor={item.scheduled_for} />
          {/* The real one: this delivers. "Mark published" stays for pieces
              posted somewhere else by hand. */}
          <SendToCustomers id={item.id} />
          {status !== "published" && <PublishButton id={item.id} />}
          {sent > 0 && (
            <span style={{ fontSize: 11, color: "var(--green, #34D399)" }}>
              ✓ emailed {sent}
            </span>
          )}
          {sent === 0 && status === "published" && (
            <span style={{ fontSize: 11, color: "var(--green, #34D399)" }}>✓ published</span>
          )}
        </span>
      </summary>
      <pre>{item.body}</pre>
    </details>
  );
}

export default async function ContentAgentPage() {
  await requireSession();
  const supabase = await createClient();

  // RLS-scoped; reads empty until manual_update_0007/0008 are run.
  const [{ data: library }, { count: total }, { count: campaigns }] =
    await Promise.all([
      supabase
        .from("ca_content")
        .select("id, content_type, topic, body, status, scheduled_for, created_at")
        .order("created_at", { ascending: false })
        .limit(60),
      supabase.from("ca_content").select("id", { count: "exact", head: true }),
      supabase.from("ca_campaigns").select("id", { count: "exact", head: true }),
    ]);

  const items = (library ?? []) as Item[];

  // How many real people each piece has actually been emailed.
  //
  // Its own query rather than a column on ca_content for two reasons: the page
  // still renders in full before migration 0039 has been run, and counting the
  // recipient rows themselves means the number shown can never drift from the
  // records behind it. Paged, because a business with a big list will have
  // more than PostgREST's 1,000-row ceiling and a short read here would
  // under-report deliveries that really happened.
  const sentByContent = new Map<string, number>();
  if (items.length > 0) {
    try {
      const rows = await selectAllRows<{ content_id: string }>(() =>
        supabase
          .from("ca_sends")
          .select("content_id")
          .eq("status", "sent")
          .in("content_id", items.map((i) => i.id))
      );
      for (const row of rows) {
        const key = String(row.content_id);
        sentByContent.set(key, (sentByContent.get(key) ?? 0) + 1);
      }
    } catch {
      // Table not there yet, or the read failed. Showing no count is honest;
      // showing a wrong one is not.
      sentByContent.clear();
    }
  }
  const scheduled = items
    .filter((i) => i.status === "scheduled")
    .sort((a, b) => (a.scheduled_for ?? "") < (b.scheduled_for ?? "") ? -1 : 1);
  const drafts = items.filter((i) => (i.status ?? "draft") === "draft");
  const published = items.filter((i) => i.status === "published");

  return (
    <>
      <div className="page-header">
        <div>
          <h1>ContentIQ</h1>
          <p>
            Plan campaigns, generate a week of on-brand content in one click,
            schedule it on a calendar, and publish — a full content operation.
          </p>
        </div>
      </div>

      <div className="stat-grid">
        <StatCard label="Scheduled" value={scheduled.length} icon={<CalendarClock />} accent="#3B82F6" hint="in the queue" />
        <StatCard label="Published" value={published.length} icon={<CheckCircle2 />} accent="#34D399" />
        <StatCard label="Campaigns" value={campaigns ?? 0} icon={<Megaphone />} accent="#EC4899" />
        <StatCard label="Total pieces" value={total ?? 0} icon={<PenLine />} accent="#8B5CF6" hint="all time" />
      </div>

      <div className="grid-main-side">
        <div>
          <CampaignBuilder />
          <div style={{ height: 18 }} />
          <ContentGenerator />
        </div>

        <div className="panel panel-block">
          <h2 className="panel-title">
            <span><span className="sys-index">01 /</span>How it works</span>
          </h2>
          <ol className="timeline">
            <li>
              <h3>Plan a campaign</h3>
              <p>Give it a theme; it generates a blog, social posts and an email in your brand voice — all at once.</p>
            </li>
            <li>
              <h3>Schedule the calendar</h3>
              <p>Each piece is auto-scheduled across the week. Drag the dates to fit your plan.</p>
            </li>
            <li>
              <h3>Send it to your customers</h3>
              <p>
                <strong>Send to customers</strong> emails the piece to your
                ClientIQ list — it shows you exactly who will get it before
                anything goes, skips anyone marked lost, and never sends the
                same piece to the same person twice. Use{" "}
                <strong>Mark published</strong> for pieces you post elsewhere by
                hand. Your brand voice comes from Settings → Business knowledge.
              </p>
            </li>
          </ol>
        </div>
      </div>

      {scheduled.length > 0 && (
        <>
          <h2 className="section-title">
            <CalendarClock size={16} style={{ verticalAlign: -3, marginRight: 6 }} />
            Content calendar
          </h2>
          <div className="content-library" style={{ marginBottom: 28 }}>
            {scheduled.map((item) => (
              <ContentCard key={item.id} item={item} sent={sentByContent.get(item.id) ?? 0} />
            ))}
          </div>
        </>
      )}

      {drafts.length > 0 && (
        <>
          <h2 className="section-title">Drafts</h2>
          <div className="content-library" style={{ marginBottom: 28 }}>
            {drafts.map((item) => (
              <ContentCard key={item.id} item={item} sent={sentByContent.get(item.id) ?? 0} />
            ))}
          </div>
        </>
      )}

      {published.length > 0 && (
        <>
          <h2 className="section-title">Published</h2>
          <div className="content-library">
            {published.map((item) => (
              <ContentCard key={item.id} item={item} sent={sentByContent.get(item.id) ?? 0} />
            ))}
          </div>
        </>
      )}

      {items.length === 0 && (
        <div className="panel panel-block">
          <p className="empty-state">
            Nothing yet — launch a campaign or generate a single piece above.
          </p>
        </div>
      )}
    </>
  );
}
