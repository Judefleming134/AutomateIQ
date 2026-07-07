import Link from "next/link";
import {
  Euro,
  Send,
  MessageSquare,
  CalendarCheck,
  AlarmClock,
  Sparkles,
  TrendingUp,
  Users,
} from "lucide-react";
import { requireGrowth } from "@/lib/growth/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadGrowthMetrics } from "@/lib/growth/metrics";
import { StatCard } from "@/components/portal/stat-card";
import { JarvisChat } from "@/components/growth/jarvis-chat";
import { CLOSED_STATUSES } from "@/lib/growth/constants";
import { dublinDate } from "@/lib/growth/dates";

// Jarvis answers run a live AI call inside this route's actions.
export const maxDuration = 60;

export default async function JarvisPage() {
  await requireGrowth();
  const admin = createAdminClient();
  const today = dublinDate();
  const activeFilter = `(${CLOSED_STATUSES.map((s) => `"${s}"`).join(",")})`;

  const [metrics, week, { count: dueCount }, { count: readyCount }] =
    await Promise.all([
      loadGrowthMetrics(admin, null),
      loadGrowthMetrics(admin, 7),
      admin
        .from("ge_prospects")
        .select("id", { count: "exact", head: true })
        .lte("next_follow_up_at", today)
        .not("status", "in", activeFilter),
      admin
        .from("ge_prospects")
        .select("id", { count: "exact", head: true })
        .in("status", ["research_complete", "outreach_ready"]),
    ]);

  const priorities: { label: string; href: string }[] = [];
  if ((dueCount ?? 0) > 0)
    priorities.push({
      label: `${dueCount} follow-up${dueCount === 1 ? "" : "s"} due or overdue — chase these first, they already know you`,
      href: "/growth?",
    });
  if ((readyCount ?? 0) > 0)
    priorities.push({
      label: `${readyCount} researched prospect${readyCount === 1 ? "" : "s"} with drafts ready and no first touch yet — send the top scores`,
      href: "/growth/prospects?sort=score",
    });
  if (week.replies > 0)
    priorities.push({
      label: `${week.replies} repl${week.replies === 1 ? "y" : "ies"} this week — every one gets an answer today`,
      href: "/growth/inbox",
    });

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Jarvis</h1>
          <p>
            Your sales copilot — live command centre over the whole pipeline.
            Ask it anything; it answers from the numbers below, never from
            thin air.
          </p>
        </div>
      </div>

      <div className="stat-grid" style={{ marginBottom: 16 }}>
        <StatCard icon={<Euro />} label="Pipeline value" value={`€${metrics.pipelineValue.toLocaleString("en-IE")}`} />
        <StatCard icon={<Users />} label="Prospects" value={String(metrics.prospectsTotal)} />
        <StatCard icon={<Send />} label="Sent (7 days)" value={String(week.outreachSent)} />
        <StatCard icon={<MessageSquare />} label="Reply rate" value={`${metrics.replyRate}%`} />
        <StatCard icon={<CalendarCheck />} label="Meetings booked" value={String(metrics.meetingsBooked)} />
        <StatCard icon={<TrendingUp />} label="Won" value={String(metrics.won)} />
      </div>

      {priorities.length > 0 && (
        <section
          className="panel panel-block"
          style={{ marginBottom: 16, borderLeft: "3px solid var(--ac2, #3b82f6)" }}
          aria-label="Priorities right now"
        >
          <h2 className="panel-title">
            <AlarmClock size={16} style={{ verticalAlign: "-3px" }} /> What
            matters right now
          </h2>
          <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 6, fontSize: 14 }}>
            {priorities.map((p) => (
              <li key={p.label}>
                <Link href={p.href}>{p.label}</Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <JarvisChat />

      <p style={{ fontSize: 12, color: "var(--faint)", marginTop: 12 }}>
        <Sparkles size={12} style={{ verticalAlign: "-2px" }} /> Jarvis reads
        the live CRM on every answer. It preps and advises — emails send from
        the platform when you press send; DMs and calls stay yours, with
        drafts and scripts ready in each prospect&apos;s workspace.
      </p>
    </>
  );
}
