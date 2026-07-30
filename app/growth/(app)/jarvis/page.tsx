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
import { loadGrowthMetricsMulti } from "@/lib/growth/metrics";
import { StatCard } from "@/components/portal/stat-card";
import { JarvisChat } from "@/components/growth/jarvis-chat";
import { EmailAutopilot } from "@/components/growth/email-autopilot";
import { SendBriefButton } from "@/components/growth/send-brief-button";
import { listAutopilotCandidates } from "@/lib/growth/autopilot";
import { CLOSED_STATUSES } from "@/lib/growth/constants";
import { dublinDate, morningSendLabel } from "@/lib/growth/dates";

// Jarvis answers run a live AI call inside this route's actions.
export const maxDuration = 60;

export default async function JarvisPage() {
  await requireGrowth();
  const admin = createAdminClient();
  const today = dublinDate();
  const activeFilter = `(${CLOSED_STATUSES.map((s) => `"${s}"`).join(",")})`;

  const [
    [metrics, week],
    { count: dueCount },
    { count: readyCount },
    candidates,
    { data: queuedEmails },
  ] = await Promise.all([
    // All-time + last-7-days from a single table load, not two full scans.
    loadGrowthMetricsMulti(admin, [null, 7]),
    admin
      .from("ge_prospects")
      .select("id", { count: "exact", head: true })
      .lte("next_follow_up_at", today)
      // Same live window as the dashboard + autopilot: chases 7+ days overdue
      // have "gone cold" and are parked separately, so "chase these first"
      // counts only the follow-ups still worth chasing today — not the cold pile.
      .gte("next_follow_up_at", dublinDate(-7))
      .not("status", "in", activeFilter),
    admin
      .from("ge_prospects")
      .select("id", { count: "exact", head: true })
      .in("status", ["research_complete", "outreach_ready"]),
    listAutopilotCandidates(25),
    // Rows, not just a count: the prospect ids are needed below to keep the
    // "ready" priority number consistent with the dashboard's.
    admin
      .from("ge_messages")
      .select("prospect_id")
      .eq("channel", "email")
      .eq("direction", "outbound")
      .eq("status", "queued")
      .limit(500),
  ]);
  const queuedRows = (queuedEmails ?? []) as { prospect_id: string }[];
  const queuedCount = queuedRows.length;

  // Same adjustment the dashboard makes: a ready prospect whose email is
  // already queued for the 8am run is handled — counting it again here made
  // Jarvis and the dashboard show different numbers for the same list.
  let readyAdjusted = readyCount ?? 0;
  if (readyAdjusted > 0 && queuedRows.length > 0) {
    const queuedIds = [...new Set(queuedRows.map((r) => r.prospect_id))];
    const { count: queuedReady } = await admin
      .from("ge_prospects")
      .select("id", { count: "exact", head: true })
      .in("status", ["research_complete", "outreach_ready"])
      .in("id", queuedIds);
    readyAdjusted = Math.max(0, readyAdjusted - (queuedReady ?? 0));
  }

  const priorities: { label: string; href: string }[] = [];
  if ((dueCount ?? 0) > 0)
    priorities.push({
      label: `${dueCount} follow-up${dueCount === 1 ? "" : "s"} due or overdue — chase these first, they already know you`,
      // Sort by next follow-up (ascending) so the most-overdue chases land at
      // the top of the list, each flagged with its overdue badge — a real chase
      // list, not the bare dashboard the old dangling "/growth?" link dropped on.
      href: "/growth/prospects?due=live&sort=follow_up",
    });
  if (readyAdjusted > 0)
    priorities.push({
      label: `${readyAdjusted} researched prospect${readyAdjusted === 1 ? "" : "s"} with drafts ready and no first touch yet — send the top scores`,
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
        <StatCard icon={<Euro />} label="Pipeline value" value={`€${Math.round(metrics.pipelineValue).toLocaleString("en-IE")}`} />
        <StatCard icon={<Users />} label="Prospects" value={String(metrics.prospectsTotal)} />
        <StatCard icon={<Send />} label="Sent (7 days)" value={String(week.outreachSent)} />
        <StatCard icon={<MessageSquare />} label="Reply rate" value={`${metrics.replyRate}%`} />
        <StatCard icon={<CalendarCheck />} label="Meetings booked" value={String(metrics.meetingsBooked)} />
        <StatCard icon={<TrendingUp />} label="Won" value={String(metrics.won)} />
      </div>

      <div style={{ marginBottom: 16 }}>
        <SendBriefButton />
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

      <EmailAutopilot candidates={candidates} queuedCount={queuedCount} />

      <JarvisChat />

      <p style={{ fontSize: 12, color: "var(--faint)", marginTop: 12 }}>
        <Sparkles size={12} style={{ verticalAlign: "-2px" }} /> Jarvis reads
        the live CRM on every answer. <strong>Emails go out on autopilot every
        morning (~{morningSendLabel()} Irish, booking link included)</strong> — the best researched
        drafts are auto-queued and sent for you, so you don&apos;t have to be
        here. You can still send any email now from the panel above; DMs and
        calls stay yours, with drafts and scripts ready in each prospect&apos;s
        workspace.
      </p>
    </>
  );
}
