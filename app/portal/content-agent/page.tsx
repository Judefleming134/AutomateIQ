import { PenLine, CalendarClock, CheckCircle2, Megaphone } from "lucide-react";
import { requireSession } from "@/lib/auth/require-session";
import { createClient } from "@/lib/supabase/server";
import { StatCard } from "@/components/portal/stat-card";
import { ContentGenerator } from "./generator";
import {
  CampaignBuilder,
  ScheduleControl,
  PublishButton,
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

function ContentCard({ item }: { item: Item }) {
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
          style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
        >
          <ScheduleControl id={item.id} scheduledFor={item.scheduled_for} />
          {status !== "published" && <PublishButton id={item.id} />}
          {status === "published" && (
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
              <h3>Publish &amp; track</h3>
              <p>Mark pieces published as you post them. Your brand voice comes from Settings → Business knowledge.</p>
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
              <ContentCard key={item.id} item={item} />
            ))}
          </div>
        </>
      )}

      {drafts.length > 0 && (
        <>
          <h2 className="section-title">Drafts</h2>
          <div className="content-library" style={{ marginBottom: 28 }}>
            {drafts.map((item) => (
              <ContentCard key={item.id} item={item} />
            ))}
          </div>
        </>
      )}

      {published.length > 0 && (
        <>
          <h2 className="section-title">Published</h2>
          <div className="content-library">
            {published.map((item) => (
              <ContentCard key={item.id} item={item} />
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
