import Link from "next/link";
import { notFound } from "next/navigation";
import {
  Sparkles,
  Globe,
  AlertTriangle,
  Download,
  ExternalLink,
  Phone,
} from "lucide-react";
import { requireGrowth, loadGrowthSettings } from "@/lib/growth/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { ActionForm } from "@/components/admin/action-form";
import { SubmitButton } from "@/components/admin/submit-button";
import { CopyButton } from "@/components/portal/copy-button";
import { MessageStudio, type StudioDraftRow } from "@/components/growth/message-studio";
import { CRITERIA } from "@/lib/growth/scoring";
import { COMPLEXITY_META, sanitizeRecommendations } from "@/lib/growth/solutions";
import { formatPrice, buildQuote, formatEuro, FOUNDING_OFFER } from "@/lib/growth/pricing";
import { markdownToHtml } from "@/lib/growth/markdown";
import { dublinDate } from "@/lib/growth/dates";
import type { ResearchReport } from "@/lib/growth/research";
import { cleanSocialUrl } from "@/lib/growth/research";
import {
  PROSPECT_STATUSES,
  PROSPECT_STATUS_META,
  QUALIFICATION_META,
  MESSAGE_STATUS_META,
  MEETING_STATUS_META,
  CHANNEL_META,
  CHANNELS,
  PURPOSE_META,
  SENTIMENT_META,
  type ProspectStatus,
  type QualificationStatus,
  type Channel,
  type MessagePurpose,
  type MessageStatus,
  type MeetingStatus,
  type Sentiment,
} from "@/lib/growth/constants";
import {
  updateProspect,
  setProspectStatus,
  qualifyProspect,
  addActivity,
  addTask,
  completeTask,
  deleteProspect,
  researchProspect,
} from "../actions";
import {
  generateProposal,
  saveProposal,
  markProposalSent,
  deleteProposal,
} from "../proposal-actions";
import { logInboundMessage } from "../../inbox/actions";

// Research and proposal generation are single long AI calls.
export const maxDuration = 60;

const TABS = [
  { key: "research", label: "Research" },
  { key: "studio", label: "Message Studio" },
  { key: "conversation", label: "Conversation" },
  { key: "proposal", label: "Proposal" },
  { key: "details", label: "Details" },
] as const;

/**
 * Booking-page slots store the Irish wall-clock time AS UTC (a 14:00 session
 * is 14:00Z), so meetings synced from a booking must render in UTC — Dublin
 * rendering would show them an hour late in summer. Everything else (real
 * server timestamps) renders in Europe/Dublin as usual. Same rule as the
 * meetings page and the Jarvis brief.
 */
function fmt(ts: string | null | undefined, fromBooking = false): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleString("en-IE", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: fromBooking ? "UTC" : "Europe/Dublin",
  });
}

/**
 * Same labelled timestamp as the inbox thread: "did this actually send?" must
 * be unmistakable — a SENT message shows its real send time, a draft shows
 * when it was written. The bare time alone silently mixed the two.
 */
function stampLabel(m: {
  direction: string;
  status: string;
  sent_at: string | null;
  created_at: string;
}): string {
  if (m.direction === "inbound") return `Received ${fmt(m.created_at)}`;
  if (m.status === "sent") return `Sent ${fmt(m.sent_at ?? m.created_at)}`;
  if (m.status === "queued") return `Queued ${fmt(m.created_at)}`;
  if (m.status === "failed") return `Failed ${fmt(m.created_at)}`;
  return `Drafted ${fmt(m.created_at)}`;
}

/** Renders a stored social URL as a click-through link (opens the profile in
 *  a new tab), so DMing a prospect doesn't need copy-paste. Falls back to —. */
function SocialLink({ url }: { url: string | null | undefined }) {
  if (!url) return <>—</>;
  const href = /^https?:\/\//i.test(url) ? url : `https://${url}`;
  return (
    <a href={href} target="_blank" rel="noreferrer">
      {url}
    </a>
  );
}

/** Coerce a value from the AI-generated report JSON to a string array — a
 *  legacy or malformed report can be missing a list field entirely. */
const asArr = (v: unknown): string[] => (Array.isArray(v) ? (v as string[]) : []);

function ListSection({ title, items }: { title: string; items: string[] }) {
  if (!Array.isArray(items) || items.length === 0) return null;
  return (
    <div style={{ marginTop: 14 }}>
      <h3 style={{ fontSize: 13, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--faint)", margin: "0 0 6px" }}>
        {title}
      </h3>
      <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 4, fontSize: 14 }}>
        {items.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

export default async function ProspectWorkspacePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; notice?: string }>;
}) {
  const { member } = await requireGrowth();
  const { id } = await params;
  const { tab: tabParam, notice } = await searchParams;
  const tab = TABS.some((t) => t.key === tabParam) ? tabParam! : "research";

  const admin = createAdminClient();
  const { data: prospect } = await admin
    .from("ge_prospects")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!prospect) notFound();

  const [
    { data: research },
    { data: activities },
    { data: messages },
    { data: tasks },
    { data: meetings },
    { data: proposals },
    { data: team },
    { data: campaigns },
    settings,
  ] = await Promise.all([
    admin
      .from("ge_research")
      .select("report, solutions, website_fetched, updated_at")
      .eq("prospect_id", id)
      .maybeSingle(),
    admin
      .from("ge_activities")
      .select("id, type, content, created_at")
      .eq("prospect_id", id)
      .order("created_at", { ascending: false })
      .limit(100),
    admin
      .from("ge_messages")
      .select("id, channel, direction, status, purpose, subject, body, sentiment, sent_at, created_at")
      .eq("prospect_id", id)
      .order("created_at", { ascending: false })
      .limit(100),
    admin
      .from("ge_tasks")
      .select("id, title, due_at, status")
      .eq("prospect_id", id)
      .order("due_at", { ascending: true, nullsFirst: false }),
    admin
      .from("ge_meetings")
      .select("id, scheduled_at, status, notes, strategy_booking_id")
      .eq("prospect_id", id)
      .order("scheduled_at", { ascending: false }),
    admin
      .from("ge_proposals")
      .select("id, title, content, status, updated_at")
      .eq("prospect_id", id)
      .order("created_at", { ascending: false }),
    admin
      .from("ge_team_members")
      .select("id, name")
      .eq("status", "active")
      .order("name"),
    admin.from("ge_campaigns").select("id, name").order("name"),
    loadGrowthSettings(),
  ]);

  // Normalise the stored report's list fields to real arrays up front — it's
  // AI-generated JSONB cast (not validated) on read, so a legacy or
  // field-evolved report could be missing one, which would otherwise crash the
  // research tab, the studio's "From the research" panel and the call script
  // (all do report.<list>.length / .map).
  const rawReport = (research?.report as ResearchReport | undefined) ?? null;
  const report: ResearchReport | null = rawReport
    ? {
        ...rawReport,
        services: asArr(rawReport.services),
        operational_observations: asArr(rawReport.operational_observations),
        manual_processes: asArr(rawReport.manual_processes),
        inefficiencies: asArr(rawReport.inefficiencies),
        ai_opportunities: asArr(rawReport.ai_opportunities),
        conversation_starters: asArr(rawReport.conversation_starters),
        discovery_questions: asArr(rawReport.discovery_questions),
      }
    : null;
  const solutions = sanitizeRecommendations(research?.solutions);
  const statusMeta = PROSPECT_STATUS_META[prospect.status as ProspectStatus];
  const qualMeta =
    QUALIFICATION_META[prospect.qualification_status as QualificationStatus];
  const lastInbound = (messages ?? []).find((m) => m.direction === "inbound");
  const openTasks = (tasks ?? []).filter((t) => t.status === "open");

  // "Outreach so far" — a scannable history of every touch that actually went
  // out (sent messages + logged calls/meetings), oldest first, with the gist,
  // so on a call Jude can say "we emailed you on the 14th about X, then chased
  // on the 17th" instead of hunting the full timeline. Read-only from data
  // already loaded above.
  type Touch = {
    key: string;
    at: string;
    channelLabel: string;
    purposeLabel: string | null;
    subject: string | null;
    preview: string;
    inbound?: boolean;
  };
  const outreachTouches: Touch[] = [
    ...(messages ?? [])
      .filter((m) => m.status === "sent" || m.direction === "inbound")
      .map((m) => ({
        key: `m-${m.id}`,
        at: m.sent_at ?? m.created_at,
        channelLabel: CHANNEL_META[m.channel as Channel]?.label ?? m.channel,
        purposeLabel: m.direction === "inbound"
          ? "Their reply"
          : PURPOSE_META[(m.purpose as MessagePurpose) ?? "first"]?.label ?? null,
        subject: m.subject,
        preview: (m.body ?? "").trim(),
        inbound: m.direction === "inbound",
      })),
    ...(activities ?? [])
      .filter((a) => a.type === "call" || a.type === "meeting")
      .map((a) => ({
        key: `a-${a.id}`,
        at: a.created_at,
        channelLabel: a.type === "call" ? "Call" : "Meeting",
        purposeLabel: null,
        subject: null,
        preview: (a.content ?? "").trim(),
      })),
  ].sort((x, y) => (x.at < y.at ? -1 : 1));
  const outboundTouchCount = outreachTouches.filter((t) => !t.inbound).length;

  const studioDrafts: StudioDraftRow[] = (messages ?? [])
    .filter((m) => m.direction === "outbound" && m.status === "draft")
    .map((m) => ({
      id: m.id,
      channel: m.channel as Channel,
      purpose: (m.purpose as MessagePurpose | null) ?? "first",
      subject: m.subject,
      body: m.body,
    }));

  const defaultChannel: Channel = prospect.email
    ? "email"
    : prospect.instagram_url
      ? "instagram"
      : prospect.facebook_url
        ? "facebook"
        : prospect.linkedin_url
          ? "linkedin"
          : prospect.phone
            ? "call"
            : "sms";

  // The one-click happy path. Everything else lives in the Details select.
  const quickStages: ProspectStatus[] = [
    "replied",
    "qualified",
    "meeting_booked",
    "negotiation",
    "won",
  ];

  return (
    <>
      <div className="page-header">
        <div>
          <p style={{ margin: 0 }}>
            <Link href="/growth/prospects">← Prospects</Link>
          </p>
          <h1 style={{ marginTop: 4 }}>{prospect.company}</h1>
          <p>
            {/* Build the meta line by joining only the parts that exist, so a
                lead imported with just a company name never shows a dangling
                "· CEO" with a leading separator. */}
            {[prospect.contact_name, prospect.job_title, prospect.location]
              .filter(Boolean)
              .join(" · ")}
            {prospect.website ? (
              <>
                {[prospect.contact_name, prospect.job_title, prospect.location].some(Boolean)
                  ? " · "
                  : ""}
                <a href={/^https?:\/\//i.test(prospect.website) ? prospect.website : `https://${prospect.website}`} target="_blank" rel="noreferrer">
                  {prospect.website} <ExternalLink size={11} style={{ verticalAlign: "-1px" }} />
                </a>
              </>
            ) : null}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span className={`badge ${statusMeta?.badge ?? "badge-gray"}`}>
            {statusMeta?.label ?? prospect.status}
          </span>
          <span className={`badge ${qualMeta?.badge ?? "badge-gray"}`}>
            {qualMeta?.label} · {prospect.lead_score}/100
          </span>
        </div>
      </div>

      {notice && (
        <div className="panel panel-block" style={{ marginBottom: 14, borderLeft: "3px solid var(--orange, #fb923c)" }}>
          <p style={{ margin: 0, fontSize: 13 }}>
            <AlertTriangle size={13} style={{ verticalAlign: "-2px" }} /> {notice}
          </p>
        </div>
      )}

      {/* Stage quick-advance: each press does its own CRM bookkeeping. */}
      <div
        className="panel panel-block"
        style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 14 }}
        aria-label="Pipeline stage"
      >
        <span style={{ fontSize: 12, color: "var(--faint)" }}>Move stage:</span>
        {quickStages.map((s) => (
          <ActionForm action={setProspectStatus} key={s}>
            <input type="hidden" name="id" value={prospect.id} />
            <input type="hidden" name="status" value={s} />
            <SubmitButton
              className={`btn btn-sm ${prospect.status === s ? "btn-primary" : "btn-secondary"}`}
              pendingText="…"
            >
              {s === "replied" ? "Reply received" : PROSPECT_STATUS_META[s].label}
            </SubmitButton>
          </ActionForm>
        ))}
        {prospect.next_follow_up_at && (
          <span style={{ fontSize: 12, color: "var(--faint)", marginLeft: "auto" }}>
            Next follow-up: <strong>{prospect.next_follow_up_at}</strong>
          </span>
        )}
      </div>

      {/* Next best move: one status-driven instruction so the workspace
          always answers "what do I do with this prospect right now?" */}
      {(() => {
        const today = dublinDate();
        const overdue =
          prospect.next_follow_up_at && prospect.next_follow_up_at <= today;
        const base = `/growth/prospects/${prospect.id}`;
        const nba: Partial<Record<string, { msg: string; cta: string; href: string }>> = {
          new: { msg: "Not researched yet — one click gets the report, score, quote and drafts.", cta: "Run research", href: `${base}?tab=research` },
          researching: { msg: "Research is underway — check back for the report and drafts.", cta: "Open research", href: `${base}?tab=research` },
          research_failed: { msg: "Research failed last time (the timeline below says why) — the lead is fine; run it again.", cta: "Retry research", href: `${base}?tab=research` },
          research_complete: { msg: "Researched with drafts ready — nothing sent yet.", cta: "Send the first touch", href: `${base}?tab=studio` },
          outreach_ready: { msg: "Drafts approved and waiting — get the first touch out.", cta: "Send the first touch", href: `${base}?tab=studio` },
          contacted: overdue
            ? { msg: `Follow-up was due ${prospect.next_follow_up_at} — chase the reply today.`, cta: "Send the follow-up", href: `${base}?tab=studio` }
            : { msg: `First touch sent — reply window open (follow-up scheduled ${prospect.next_follow_up_at ?? "soon"}).`, cta: "Prep the follow-up", href: `${base}?tab=studio` },
          follow_up_sent: overdue
            ? { msg: `Second chase was due ${prospect.next_follow_up_at} — one more touch or a call.`, cta: "Send the next touch", href: `${base}?tab=studio` }
            : { msg: "Follow-up sent — give it a beat, then consider a call.", cta: "Open the call script", href: `${base}?tab=studio` },
          replied: studioDrafts.some((d) => d.purpose === "reply")
            ? { msg: "They replied — a suggested response is already drafted. Review it and send while it's warm.", cta: "Review the drafted reply", href: `${base}?tab=studio` }
            : { msg: "They replied — answer today while it's warm and steer to the Strategy Session.", cta: "Open the conversation", href: `${base}?tab=conversation` },
          qualified: { msg: "Qualified — the only next move is a booked AI Strategy Session.", cta: "Compose the booking message", href: `${base}?tab=studio` },
          meeting_booked: { msg: "Session booked — walk in prepared: report, angle, quote.", cta: "Review session prep", href: `${base}?tab=research` },
          proposal_in_progress: { msg: "Proposal in progress — finish and send while momentum holds.", cta: "Open Proposal Studio", href: `${base}?tab=proposal` },
          proposal_sent: { msg: "Proposal with them — nudge for a decision before it cools.", cta: "Send the nudge", href: `${base}?tab=studio` },
          negotiation: { msg: "Negotiation — hold the price book; the founding offer is the closer.", cta: "Open the conversation", href: `${base}?tab=conversation` },
          won: { msg: "Won 🎉 — deliver brilliantly, then ask for the review and a referral.", cta: "Log next steps", href: `${base}?tab=details` },
          future_opportunity: {
            msg: `Parked as a future opportunity${prospect.next_follow_up_at ? ` — it resurfaces on your due list around ${prospect.next_follow_up_at}` : ""}. Nothing to chase now; bring it forward with a fresh follow-up date or a new angle if the timing changes.`,
            cta: "Adjust the timing",
            href: `${base}?tab=details`,
          },
        };
        const action = nba[prospect.status];
        if (!action) return null;
        return (
          <div
            className="panel panel-block"
            style={{ marginBottom: 14, borderLeft: "3px solid var(--green, #34d399)", display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}
            aria-label="Next best move"
          >
            <div style={{ flex: "1 1 280px", fontSize: 14 }}>
              <strong>Next best move:</strong> {action.msg}
            </div>
            <Link href={action.href} className="btn btn-primary btn-sm">
              {action.cta} →
            </Link>
          </div>
        );
      })()}

      {/* Outreach history at a glance — what actually went out and when, so the
          call opens with "we've reached out N times" instead of a hunt. */}
      {outreachTouches.length > 0 && (
        <details
          className="panel panel-block"
          open
          style={{ marginBottom: 14, borderLeft: "3px solid var(--ac1, #8b5cf6)" }}
        >
          <summary style={{ cursor: "pointer", fontWeight: 600 }}>
            📨 Outreach so far — {outboundTouchCount} touch
            {outboundTouchCount === 1 ? "" : "es"} sent
            {outreachTouches.length > outboundTouchCount
              ? ` · ${outreachTouches.length - outboundTouchCount} reply back`
              : ""}
          </summary>
          <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
            {outreachTouches.map((t, i) => (
              <div
                key={t.key}
                style={{
                  fontSize: 13,
                  borderLeft: `2px solid ${t.inbound ? "var(--green, #34d399)" : "var(--ac2, #3b82f6)"}`,
                  paddingLeft: 10,
                }}
              >
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "baseline" }}>
                  <strong>
                    {t.inbound ? "" : `${i + 1}. `}
                    {t.channelLabel}
                  </strong>
                  {t.purposeLabel && (
                    <span style={{ color: "var(--faint)" }}>· {t.purposeLabel}</span>
                  )}
                  <span style={{ color: "var(--faint)", marginLeft: "auto" }}>
                    {fmt(t.at)}
                  </span>
                </div>
                {t.subject && (
                  <div style={{ fontWeight: 600, marginTop: 3 }}>{t.subject}</div>
                )}
                {t.preview && (
                  <div
                    style={{
                      color: "var(--body)",
                      marginTop: 3,
                      whiteSpace: "pre-wrap",
                      maxHeight: 120,
                      overflowY: "auto",
                    }}
                  >
                    {t.preview}
                  </div>
                )}
              </div>
            ))}
          </div>
          <p style={{ fontSize: 11.5, color: "var(--faint)", margin: "10px 0 0" }}>
            Full thread with statuses is under the Conversation tab.
          </p>
        </details>
      )}

      <nav role="tablist" aria-label="Prospect workspace" style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16 }}>
        {TABS.map((t) => (
          <Link
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            href={`/growth/prospects/${prospect.id}?tab=${t.key}`}
            className={`btn btn-sm ${tab === t.key ? "btn-primary" : "btn-secondary"}`}
          >
            {t.label}
            {t.key === "proposal" && (proposals ?? []).length > 0 ? ` (${(proposals ?? []).length})` : ""}
          </Link>
        ))}
      </nav>

      {/* ============================ RESEARCH ============================ */}
      {tab === "research" && (
        <div className="grid-main-side">
          <div>
            {!report ? (
              <section className="panel panel-block">
                <h2 className="panel-title">Company research</h2>
                <p style={{ fontSize: 14, color: "var(--faint)" }}>
                  One click researches {prospect.company}: the AI reads their
                  website, writes a full company report, identifies likely
                  pain points, recommends AutomateIQ solutions, suggests a
                  lead score and prepares a first-touch draft for every
                  channel. Everything is saved here automatically.
                </p>
                <ActionForm action={researchProspect}>
                  <input type="hidden" name="id" value={prospect.id} />
                  <SubmitButton pendingText="Researching — reading the website and writing the report (30–60s)…">
                    <Sparkles size={14} /> Research company
                  </SubmitButton>
                </ActionForm>
              </section>
            ) : (
              <>
                <section className="panel panel-block">
                  <h2 className="panel-title">
                    Company report
                    <span style={{ fontSize: 12, fontWeight: 400, color: "var(--faint)" }}>
                      {fmt(research!.updated_at)}
                    </span>
                  </h2>
                  <p style={{ fontSize: 12, color: "var(--faint)", marginTop: 0 }}>
                    <Globe size={12} style={{ verticalAlign: "-2px" }} />{" "}
                    {research!.website_fetched
                      ? "Website analysed."
                      : "Website could not be read — this report is inferred from the recorded details and sector norms; treat specifics with extra care."}
                    {(report as { engine?: string }).engine
                      ? ` Researched by ${(report as { engine?: string }).engine}.`
                      : ""}
                  </p>
                  {!research!.website_fetched && prospect.website && (
                    <div
                      className="panel"
                      style={{ padding: "10px 12px", margin: "0 0 10px", borderLeft: "3px solid var(--orange, #fb923c)", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}
                    >
                      <span style={{ fontSize: 12, flex: "1 1 200px" }}>
                        The site may just have blocked the first read. Try again
                        — no need to delete and re-add.
                      </span>
                      <ActionForm action={researchProspect}>
                        <input type="hidden" name="id" value={prospect.id} />
                        <SubmitButton className="btn btn-secondary btn-sm" pendingText="Reading the site again (30–60s)…">
                          <Globe size={13} /> Read the website &amp; re-research
                        </SubmitButton>
                      </ActionForm>
                    </div>
                  )}
                  <p style={{ fontSize: 15 }}>{report.overview}</p>
                  <div className="table-wrap" style={{ marginTop: 10 }}>
                    <table>
                      <tbody>
                        <tr><td>Industry</td><td>{report.industry || "—"}</td></tr>
                        <tr><td>Business model</td><td>{report.business_model || "—"}</td></tr>
                        <tr><td>Likely size</td><td>{report.company_size || "—"}</td></tr>
                      </tbody>
                    </table>
                  </div>
                  <ListSection title="Services" items={report.services} />
                  <ListSection title="Operational observations" items={report.operational_observations} />
                  <ListSection title="Likely manual processes" items={report.manual_processes} />
                  <ListSection title="Likely inefficiencies" items={report.inefficiencies} />
                  <ListSection title="AI opportunities" items={report.ai_opportunities} />
                  <ListSection title="Conversation starters" items={report.conversation_starters} />
                  <ListSection title="Discovery questions" items={report.discovery_questions} />
                  <ActionForm action={researchProspect} style={{ marginTop: 16 }}>
                    <input type="hidden" name="id" value={prospect.id} />
                    <SubmitButton className="btn btn-secondary btn-sm" pendingText="Re-researching (30–60s)…">
                      <Sparkles size={13} /> Re-run research
                    </SubmitButton>
                  </ActionForm>
                </section>

                {(() => {
                  const quote = buildQuote(solutions);
                  if (!quote) return null;
                  const min = quote.hasFrom ? "from " : "";
                  return (
                    <section
                      className="panel panel-block"
                      style={{ marginTop: 16, borderLeft: "3px solid var(--green, #34d399)" }}
                      aria-label="What to quote"
                    >
                      <h2 className="panel-title">💶 What to quote {prospect.company}</h2>
                      <p style={{ fontSize: 20, margin: "4px 0 2px" }}>
                        <strong>
                          {min}
                          {formatEuro(quote.setupTotal)} setup
                          {quote.monthlyTotal > 0 ? ` + ${formatEuro(quote.monthlyTotal)}/month` : ""}
                        </strong>
                      </p>
                      <p style={{ fontSize: 13, color: "var(--faint)", margin: "0 0 8px" }}>
                        {quote.lines.map((l) => l.name).join(" + ")} · first-year value{" "}
                        {min}{formatEuro(quote.firstYear)}
                      </p>
                      <div style={{ fontSize: 13, display: "grid", gap: 3 }}>
                        {quote.lines.map((l) => (
                          <div key={l.key}>
                            · {l.name}: {formatPrice(l.key)}
                          </div>
                        ))}
                      </div>
                      <p style={{ fontSize: 13, color: "var(--green, #34d399)", margin: "10px 0 0" }}>
                        {FOUNDING_OFFER}
                      </p>
                      <p style={{ fontSize: 12, color: "var(--faint)", margin: "6px 0 0" }}>
                        Say the monthly first, setup second. If they push on the
                        setup fee, hold the monthly and stage the setup — never
                        discount below the price book.
                      </p>
                    </section>
                  );
                })()}

                {solutions.length > 0 && (
                  <section className="panel panel-block" style={{ marginTop: 16 }}>
                    <h2 className="panel-title">Recommended solutions</h2>
                    <div style={{ display: "grid", gap: 12 }}>
                      {solutions.map((s) => (
                        <div key={s.key} className="panel" style={{ padding: "12px 14px" }}>
                          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                            <strong>{s.name}</strong>
                            <span className={`badge ${COMPLEXITY_META[s.complexity].badge}`}>
                              {COMPLEXITY_META[s.complexity].label}
                            </span>
                          </div>
                          <p style={{ fontSize: 14, margin: "6px 0 0" }}>{s.why}</p>
                          {s.benefits && (
                            <p style={{ fontSize: 13, color: "var(--faint)", margin: "6px 0 0" }}>
                              Illustrative benefits: {s.benefits}
                            </p>
                          )}
                          {formatPrice(s.key) && (
                            <p style={{ fontSize: 13, margin: "6px 0 0", color: "var(--green, #34d399)" }}>
                              If they ask: <strong>{formatPrice(s.key)}</strong>{" "}
                              <span style={{ color: "var(--faint)" }}>(founding-customer rate)</span>
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                    <p style={{ fontSize: 12, color: "var(--faint)", marginTop: 10 }}>
                      Operational improvements shown are illustrative estimates
                      for this type of business, not guarantees. Prices come
                      from the price book (Settings) — the AI never invents
                      figures.
                    </p>
                  </section>
                )}
              </>
            )}
          </div>

          <div>
            {report &&
              (prospect.status === "meeting_booked" ||
                (meetings ?? []).some((m) => m.status === "booked")) && (
                <section
                  className="panel panel-block"
                  style={{ marginBottom: 16, borderLeft: "3px solid var(--green, #34d399)" }}
                  aria-labelledby="prep-title"
                >
                  <h2 className="panel-title" id="prep-title">
                    Strategy Session prep
                  </h2>
                  {(meetings ?? [])
                    .filter((m) => m.status === "booked")
                    .slice(0, 2)
                    .map((m) => (
                      <p key={m.id} style={{ fontSize: 13, margin: "0 0 8px" }}>
                        <strong>{fmt(m.scheduled_at, Boolean(m.strategy_booking_id))}</strong>{" "}
                        (Irish time)
                      </p>
                    ))}
                  {solutions.length > 0 && (
                    <p style={{ fontSize: 13, margin: "0 0 4px" }}>
                      <strong>Pitch:</strong>{" "}
                      {solutions.slice(0, 3).map((s) => s.name).join(" · ")}
                    </p>
                  )}
                  {report.proposal_angle && (
                    <p style={{ fontSize: 13, margin: "0 0 8px" }}>
                      <strong>Angle:</strong> {report.proposal_angle}
                    </p>
                  )}
                  <ListSection title="Ask on the call" items={report.discovery_questions} />
                  <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
                    <Link
                      href={`/growth/prospects/${prospect.id}?tab=proposal`}
                      className="btn btn-primary btn-sm"
                    >
                      Prepare the proposal →
                    </Link>
                    <Link
                      href={`/growth/prospects/${prospect.id}?tab=conversation`}
                      className="btn btn-secondary btn-sm"
                    >
                      Log call notes
                    </Link>
                  </div>
                </section>
              )}
            {report && (
              <section className="panel panel-block">
                <h2 className="panel-title">Sales angle</h2>
                {report.proposal_angle && (
                  <p style={{ fontSize: 14, marginTop: 0 }}>
                    <strong>Proposal angle:</strong> {report.proposal_angle}
                  </p>
                )}
                {report.next_action && (
                  <p style={{ fontSize: 14 }}>
                    <strong>Suggested next action:</strong> {report.next_action}
                  </p>
                )}
                <Link href={`/growth/prospects/${prospect.id}?tab=studio`} className="btn btn-primary btn-sm">
                  Open Message Studio →
                </Link>
              </section>
            )}

            <section className="panel panel-block" style={{ marginTop: report ? 16 : 0 }}>
              <h2 className="panel-title">Book a Strategy Session</h2>
              <p style={{ fontSize: 13, color: "var(--faint)", marginTop: 0 }}>
                When they&apos;re ready, send the booking link — the studio&apos;s
                <em> Meeting confirmation</em> draft includes it.
              </p>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <code style={{ fontSize: 12, wordBreak: "break-all" }}>{settings.bookingUrl}</code>
                <CopyButton text={settings.bookingUrl} label="Copy link" />
              </div>
              {(meetings ?? []).length > 0 && (
                <div style={{ marginTop: 12 }}>
                  {(meetings ?? []).map((mt) => (
                    <div key={mt.id} style={{ fontSize: 13, marginBottom: 6 }}>
                      <span className={`badge ${MEETING_STATUS_META[mt.status as MeetingStatus]?.badge}`}>
                        {MEETING_STATUS_META[mt.status as MeetingStatus]?.label}
                      </span>{" "}
                      {fmt(mt.scheduled_at, Boolean(mt.strategy_booking_id))}
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        </div>
      )}

      {/* ============================ STUDIO ============================ */}
      {tab === "studio" && (
        <div className="grid-main-side">
          <section className="panel panel-block">
            <h2 className="panel-title">Message Studio</h2>
            {/* Send destinations right beside the drafts — copying a DM then
                hunting another tab for the profile link was a tab-flip per
                message on a 15-DM session. Junk links are hidden, not shown
                dead (cleanSocialUrl). */}
            {(() => {
              const ig = cleanSocialUrl(prospect.instagram_url);
              const fb = cleanSocialUrl(prospect.facebook_url);
              const li = cleanSocialUrl(prospect.linkedin_url);
              const targets = [
                ig && { label: "Instagram", href: ig },
                fb && { label: "Facebook", href: fb },
                li && { label: "LinkedIn", href: li },
                prospect.email && { label: "Email", href: `mailto:${prospect.email}` },
                prospect.phone && { label: `☎ ${prospect.phone}`, href: `tel:${prospect.phone.replace(/[^\d+]/g, "")}` },
              ].filter(Boolean) as { label: string; href: string }[];
              if (targets.length === 0) return null;
              return (
                <p style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", fontSize: 12.5, margin: "0 0 12px" }}>
                  <span style={{ color: "var(--faint)" }}>Send it here:</span>
                  {targets.map((t) => (
                    <a
                      key={t.label}
                      href={t.href}
                      target={t.href.startsWith("http") ? "_blank" : undefined}
                      rel="noreferrer"
                      className="btn btn-ghost btn-sm"
                    >
                      {t.label} ↗
                    </a>
                  ))}
                </p>
              );
            })()}
            {!report && (
              <p style={{ fontSize: 13, color: "var(--orange, #fb923c)", marginTop: 0 }}>
                No research yet — drafts will be generic.{" "}
                <Link href={`/growth/prospects/${prospect.id}?tab=research`}>
                  Run research first
                </Link>{" "}
                for personalised messages.
              </p>
            )}
            <MessageStudio
              prospectId={prospect.id}
              prospectEmail={prospect.email}
              prospectPhone={prospect.phone}
              defaultChannel={defaultChannel}
              savedDrafts={studioDrafts}
            />
          </section>

          <div>
            {report && report.conversation_starters.length > 0 && (
              <section className="panel panel-block">
                <h2 className="panel-title">From the research</h2>
                <ListSection title="Conversation starters" items={report.conversation_starters} />
                {report.proposal_angle && (
                  <p style={{ fontSize: 13, color: "var(--faint)", marginTop: 12 }}>
                    <strong>Angle:</strong> {report.proposal_angle}
                  </p>
                )}
              </section>
            )}
            <section className="panel panel-block" style={{ marginTop: report ? 16 : 0 }}>
              <h2 className="panel-title">Contact channels</h2>
              <div style={{ display: "grid", gap: 6, fontSize: 13 }}>
                <div style={{ wordBreak: "break-all" }}>
                  Email:{" "}
                  {prospect.email ? (
                    <a href={`mailto:${prospect.email}`}>{prospect.email}</a>
                  ) : (
                    "—"
                  )}
                </div>
                <div>
                  Phone:{" "}
                  {prospect.phone ? (
                    <a href={`tel:${prospect.phone.replace(/[^\d+]/g, "")}`}>{prospect.phone}</a>
                  ) : (
                    "—"
                  )}
                </div>
                <div style={{ wordBreak: "break-all" }}>LinkedIn: <SocialLink url={prospect.linkedin_url} /></div>
                <div style={{ wordBreak: "break-all" }}>Instagram: <SocialLink url={prospect.instagram_url} /></div>
                <div style={{ wordBreak: "break-all" }}>Facebook: <SocialLink url={prospect.facebook_url} /></div>
              </div>
            </section>
          </div>
        </div>
      )}

      {/* ========================== CONVERSATION ========================== */}
      {tab === "conversation" && (
        <div className="grid-main-side">
          <section className="panel panel-block">
            <h2 className="panel-title">Conversation &amp; activity</h2>
            <ActionForm action={addActivity} style={{ marginBottom: 14 }}>
              <input type="hidden" name="id" value={prospect.id} />
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <select name="type" defaultValue="note" aria-label="Activity type">
                  <option value="note">Note</option>
                  <option value="call">Call</option>
                  <option value="meeting">Meeting</option>
                </select>
                <input
                  name="content"
                  placeholder="Log a note, call or meeting…"
                  required
                  maxLength={4000}
                  style={{ flex: "1 1 240px" }}
                  aria-label="Activity details"
                />
                <SubmitButton className="btn btn-secondary btn-sm" pendingText="Logging…">
                  Log
                </SubmitButton>
              </div>
            </ActionForm>

            {(messages ?? []).length === 0 && (activities ?? []).length === 0 ? (
              <p className="empty-state">No history yet — the first message starts the record.</p>
            ) : (
              <div style={{ display: "grid", gap: 10 }}>
                {[
                  ...(messages ?? []).map((m) => ({ kind: "message" as const, at: m.created_at, m })),
                  ...(activities ?? []).map((a) => ({ kind: "activity" as const, at: a.created_at, a })),
                ]
                  .sort((x, y) => (x.at < y.at ? 1 : -1))
                  .map((entry) =>
                    entry.kind === "message" ? (
                      <div
                        key={`m-${entry.m.id}`}
                        className="panel"
                        style={{
                          padding: "12px 14px",
                          borderLeft:
                            entry.m.direction === "inbound"
                              ? "3px solid var(--green, #34d399)"
                              : "3px solid var(--ac2, #3b82f6)",
                        }}
                      >
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", fontSize: 12, color: "var(--faint)" }}>
                          <strong style={{ color: "var(--text, #eee)" }}>
                            {entry.m.direction === "inbound" ? "They replied" : "Outreach"}
                          </strong>
                          <span>{CHANNEL_META[entry.m.channel as Channel]?.label}</span>
                          <span className={`badge ${MESSAGE_STATUS_META[entry.m.status as MessageStatus]?.badge ?? "badge-gray"}`}>
                            {MESSAGE_STATUS_META[entry.m.status as MessageStatus]?.label ?? entry.m.status}
                          </span>
                          {entry.m.sentiment && (
                            <span className={`badge ${SENTIMENT_META[entry.m.sentiment as Sentiment].badge}`}>
                              {SENTIMENT_META[entry.m.sentiment as Sentiment].label}
                            </span>
                          )}
                          <span>{stampLabel(entry.m)}</span>
                        </div>
                        {entry.m.subject && <div style={{ fontWeight: 600, marginTop: 6 }}>{entry.m.subject}</div>}
                        <p style={{ whiteSpace: "pre-wrap", margin: "6px 0 0", fontSize: 14 }}>{entry.m.body}</p>
                      </div>
                    ) : (
                      <div key={`a-${entry.a.id}`} style={{ fontSize: 13, color: "var(--faint)", padding: "2px 4px" }}>
                        <span style={{ color: "var(--text, #ddd)" }}>{entry.a.content}</span>{" "}
                        · {entry.a.type.replace("_", " ")} · {fmt(entry.a.created_at)}
                      </div>
                    )
                  )}
              </div>
            )}
          </section>

          <div>
            {/* Call panel: dial + the script, right where Jude logs the call. */}
            {(() => {
              const callDraft = (messages ?? []).find(
                (m) => m.channel === "call" && m.direction === "outbound"
              );
              const script =
                callDraft?.body ||
                (report && (report.conversation_starters.length || report.discovery_questions.length)
                  ? [
                      report.conversation_starters.length
                        ? "OPENERS:\n" + report.conversation_starters.map((s) => `• ${s}`).join("\n")
                        : "",
                      report.discovery_questions.length
                        ? "ASK ON THE CALL:\n" + report.discovery_questions.map((s) => `• ${s}`).join("\n")
                        : "",
                    ].filter(Boolean).join("\n\n")
                  : "");
              if (!prospect.phone && !script) return null;
              return (
                <section
                  className="panel panel-block"
                  style={{ borderLeft: "3px solid var(--ac2, #3b82f6)" }}
                  aria-label="Call this prospect"
                >
                  <h2 className="panel-title">
                    <Phone size={15} style={{ verticalAlign: "-2px" }} /> Call {prospect.contact_name || prospect.company}
                  </h2>
                  {prospect.phone && (
                    <a
                      href={`tel:${prospect.phone.replace(/[^\d+]/g, "")}`}
                      className="btn btn-primary btn-sm"
                      style={{ marginBottom: 10 }}
                    >
                      <Phone size={13} /> {prospect.phone}
                    </a>
                  )}
                  {script ? (
                    <div>
                      <div style={{ fontSize: 12, color: "var(--faint)", marginBottom: 4 }}>
                        {callDraft ? "Your call script:" : "Quick script from the research:"}
                      </div>
                      <p style={{ whiteSpace: "pre-wrap", fontSize: 13, margin: 0, maxHeight: 260, overflowY: "auto" }}>
                        {script}
                      </p>
                      <p style={{ fontSize: 11, color: "var(--faint)", margin: "8px 0 0" }}>
                        {callDraft
                          ? "Full script generated in the Studio."
                          : "Generate a full call script in the Studio → Call tab."}
                      </p>
                    </div>
                  ) : (
                    <p style={{ fontSize: 12, color: "var(--faint)", margin: 0 }}>
                      Generate a call script in the Studio → Call tab.
                    </p>
                  )}
                  <p style={{ fontSize: 11, color: "var(--faint)", margin: "8px 0 0" }}>
                    After the call, log the outcome with the box on the left
                    (Call) — it schedules the follow-up automatically.
                  </p>
                </section>
              );
            })()}

            <section className="panel panel-block" style={{ marginTop: 16 }}>
              <h2 className="panel-title">Log their reply</h2>
              <p style={{ fontSize: 12, color: "var(--faint)", marginTop: 0 }}>
                Paste what they sent back — status moves to Replied and the
                sentiment feeds analytics.
              </p>
              <ActionForm action={logInboundMessage}>
                <input type="hidden" name="prospect_id" value={prospect.id} />
                <label htmlFor="pl-channel">Channel</label>
                <select id="pl-channel" name="channel" defaultValue={lastInbound?.channel ?? defaultChannel}>
                  {CHANNELS.map((ch) => (
                    <option key={ch} value={ch}>
                      {CHANNEL_META[ch].label}
                    </option>
                  ))}
                </select>
                <label htmlFor="pl-sentiment">Sentiment</label>
                <select id="pl-sentiment" name="sentiment" defaultValue="neutral">
                  <option value="positive">Positive</option>
                  <option value="neutral">Neutral</option>
                  <option value="negative">Negative</option>
                </select>
                <label htmlFor="pl-body">Their message</label>
                <textarea id="pl-body" name="body" rows={4} required maxLength={10000} />
                <div className="form-actions">
                  <SubmitButton className="btn btn-secondary btn-sm" pendingText="Logging…">
                    Log reply
                  </SubmitButton>
                </div>
              </ActionForm>
            </section>

            <section className="panel panel-block" style={{ marginTop: 16 }}>
              <h2 className="panel-title">Tasks &amp; follow-ups</h2>
              {openTasks.length === 0 ? (
                <p className="empty-state">No open tasks.</p>
              ) : (
                openTasks.map((t) => (
                  <div key={t.id} style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "space-between", marginBottom: 8, fontSize: 13 }}>
                    <span>
                      {t.title}
                      {t.due_at ? <span style={{ color: "var(--faint)" }}> · due {t.due_at}</span> : null}
                    </span>
                    <ActionForm action={completeTask}>
                      <input type="hidden" name="task_id" value={t.id} />
                      <input type="hidden" name="prospect_id" value={prospect.id} />
                      <SubmitButton className="btn btn-ghost btn-sm" pendingText="…">
                        Done
                      </SubmitButton>
                    </ActionForm>
                  </div>
                ))
              )}
              <ActionForm action={addTask} style={{ marginTop: 10 }}>
                <input type="hidden" name="prospect_id" value={prospect.id} />
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <input name="title" placeholder="New task…" required maxLength={300} style={{ flex: "1 1 140px" }} aria-label="Task title" />
                  <input type="date" name="due_at" aria-label="Due date" />
                  <SubmitButton className="btn btn-secondary btn-sm" pendingText="Adding…">
                    Add
                  </SubmitButton>
                </div>
              </ActionForm>
            </section>
          </div>
        </div>
      )}

      {/* ============================ PROPOSAL ============================ */}
      {tab === "proposal" && (
        <div>
          <section className="panel panel-block">
            <h2 className="panel-title">Proposal Studio</h2>
            <p style={{ fontSize: 13, color: "var(--faint)", marginTop: 0 }}>
              Drafts a proposal from the research, recommended solutions and
              your meeting notes. Edit it below, download it as a print-ready
              document, send it yourself, then mark it sent — the prospect
              moves to <em>Proposal sent</em> with a follow-up in 7 days.
            </p>
            {!report && (
              <p
                style={{
                  fontSize: 12.5,
                  color: "var(--orange, #fb923c)",
                  margin: "0 0 10px",
                }}
              >
                No research on file yet — the proposal will be general and
                hedged. Run research first (Research tab) for one grounded in
                their site, pain points and a real quote.
              </p>
            )}
            <ActionForm action={generateProposal}>
              <input type="hidden" name="prospect_id" value={prospect.id} />
              <SubmitButton pendingText="Writing the proposal draft (30–60s)…">
                <Sparkles size={14} /> Generate proposal draft
              </SubmitButton>
            </ActionForm>
          </section>

          {/* Readable typography for the rendered proposal — the preview is
              the primary view; raw Markdown lives in the editor below it. */}
          <style>{`
            .proposal-preview { font-size: 15px; line-height: 1.8; max-width: 760px; }
            .proposal-preview h1 { font-size: 24px; line-height: 1.3; margin: 26px 0 10px; }
            .proposal-preview h2 { font-size: 19px; line-height: 1.35; margin: 26px 0 8px; padding-bottom: 6px; border-bottom: 1px solid var(--line, rgba(255,255,255,.1)); }
            .proposal-preview h3 { font-size: 16px; margin: 20px 0 6px; }
            .proposal-preview p { margin: 0 0 14px; }
            .proposal-preview ul, .proposal-preview ol { margin: 0 0 14px; padding-left: 24px; }
            .proposal-preview li { margin-bottom: 6px; }
            .proposal-editor textarea { min-height: 480px; font-size: 14px; line-height: 1.7; padding: 14px; }
          `}</style>
          {(proposals ?? []).map((p) => (
            <section className="panel panel-block" style={{ marginTop: 16 }} key={p.id}>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
                <span className={`badge ${p.status === "sent" ? "badge-green" : "badge-gray"}`}>
                  {p.status === "sent" ? "Sent" : "Draft"}
                </span>
                <span style={{ fontSize: 12, color: "var(--faint)" }}>Updated {fmt(p.updated_at)}</span>
                <a
                  href={`/growth/proposals/${p.id}/download`}
                  target="_blank"
                  rel="noreferrer"
                  className="btn btn-secondary btn-sm"
                  style={{ marginLeft: "auto" }}
                >
                  <Download size={13} /> Open print version
                </a>
              </div>

              <h2 style={{ fontSize: 22, margin: "6px 0 14px" }}>{p.title}</h2>
              <div
                className="proposal-preview"
                // Safe: markdownToHtml escapes all input before formatting.
                dangerouslySetInnerHTML={{ __html: markdownToHtml(p.content) }}
              />

              <details className="proposal-editor" style={{ marginTop: 18 }}>
                <summary style={{ cursor: "pointer", fontWeight: 600 }}>
                  ✏️ Edit the text
                </summary>
                <ActionForm action={saveProposal} style={{ marginTop: 12 }}>
                  <input type="hidden" name="proposal_id" value={p.id} />
                  <label htmlFor={`pp-title-${p.id}`}>Title</label>
                  <input id={`pp-title-${p.id}`} name="title" defaultValue={p.title} required maxLength={300} />
                  <label htmlFor={`pp-content-${p.id}`}>Content (Markdown — ## makes a section heading, - makes a bullet)</label>
                  <textarea id={`pp-content-${p.id}`} name="content" rows={30} defaultValue={p.content} required maxLength={60000} />
                  <div className="form-actions">
                    <SubmitButton className="btn btn-secondary btn-sm" pendingText="Saving…">
                      Save changes
                    </SubmitButton>
                  </div>
                </ActionForm>
              </details>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                {p.status !== "sent" && (
                  <>
                    <ActionForm action={markProposalSent}>
                      <input type="hidden" name="proposal_id" value={p.id} />
                      <SubmitButton className="btn btn-primary btn-sm" pendingText="…">
                        Mark proposal sent
                      </SubmitButton>
                    </ActionForm>
                    <ActionForm action={deleteProposal}>
                      <input type="hidden" name="proposal_id" value={p.id} />
                      <SubmitButton className="btn btn-danger btn-sm" pendingText="…">
                        Delete draft
                      </SubmitButton>
                    </ActionForm>
                  </>
                )}
              </div>
            </section>
          ))}
        </div>
      )}

      {/* ============================ DETAILS ============================ */}
      {tab === "details" && (
        <div className="grid-2">
          <section className="panel panel-block">
            <h2 className="panel-title">Profile</h2>
            <ActionForm action={updateProspect}>
              <input type="hidden" name="id" value={prospect.id} />
              <label htmlFor="ep-company">Company *</label>
              <input id="ep-company" name="company" defaultValue={prospect.company} required maxLength={200} />
              <label htmlFor="ep-contact">Contact name *</label>
              <input id="ep-contact" name="contact_name" defaultValue={prospect.contact_name} required maxLength={200} />
              <label htmlFor="ep-title">Job title</label>
              <input id="ep-title" name="job_title" defaultValue={prospect.job_title ?? ""} maxLength={200} />
              <label htmlFor="ep-industry">Industry</label>
              <input id="ep-industry" name="industry" defaultValue={prospect.industry ?? ""} maxLength={200} />
              <label htmlFor="ep-website">Website</label>
              <input id="ep-website" name="website" defaultValue={prospect.website ?? ""} maxLength={300} />
              <label htmlFor="ep-location">Location</label>
              <input id="ep-location" name="location" defaultValue={prospect.location ?? ""} maxLength={200} />
              <label htmlFor="ep-email">Email</label>
              <input id="ep-email" name="email" type="email" defaultValue={prospect.email ?? ""} maxLength={300} />
              <label htmlFor="ep-phone">Phone</label>
              <input id="ep-phone" name="phone" defaultValue={prospect.phone ?? ""} maxLength={50} />
              <label htmlFor="ep-linkedin">LinkedIn URL</label>
              <input id="ep-linkedin" name="linkedin_url" defaultValue={prospect.linkedin_url ?? ""} maxLength={500} />
              <label htmlFor="ep-instagram">Instagram URL</label>
              <input id="ep-instagram" name="instagram_url" defaultValue={prospect.instagram_url ?? ""} maxLength={500} />
              <label htmlFor="ep-facebook">Facebook URL</label>
              <input id="ep-facebook" name="facebook_url" defaultValue={prospect.facebook_url ?? ""} maxLength={500} />
              <label htmlFor="ep-campaign">Campaign</label>
              <select id="ep-campaign" name="campaign_id" defaultValue={prospect.campaign_id ?? ""}>
                <option value="">No campaign</option>
                {(campaigns ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <label htmlFor="ep-assigned">Assigned to</label>
              <select id="ep-assigned" name="assigned_to" defaultValue={prospect.assigned_to ?? ""}>
                <option value="">Unassigned</option>
                {(team ?? []).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
              <label htmlFor="ep-followup">Next follow-up</label>
              <input id="ep-followup" type="date" name="next_follow_up_at" defaultValue={prospect.next_follow_up_at ?? ""} />
              <label htmlFor="ep-pipeline">Pipeline value (€)</label>
              <input id="ep-pipeline" name="pipeline_value" inputMode="decimal" defaultValue={prospect.pipeline_value ?? ""} />
              <label htmlFor="ep-notes">Notes</label>
              <textarea id="ep-notes" name="notes" rows={4} defaultValue={prospect.notes ?? ""} maxLength={4000} />
              <div className="form-actions">
                <SubmitButton pendingText="Saving…">Save profile</SubmitButton>
              </div>
            </ActionForm>
          </section>

          <div>
            <section className="panel panel-block">
              <h2 className="panel-title">Pipeline status</h2>
              <ActionForm action={setProspectStatus} style={{ display: "flex", gap: 10, alignItems: "end", flexWrap: "wrap" }}>
                <input type="hidden" name="id" value={prospect.id} />
                <div>
                  <label htmlFor="ps-status" style={{ fontSize: 12, color: "var(--faint)" }}>
                    Status
                  </label>
                  <select id="ps-status" name="status" defaultValue={prospect.status}>
                    {PROSPECT_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {PROSPECT_STATUS_META[s].label}
                      </option>
                    ))}
                  </select>
                </div>
                <SubmitButton className="btn btn-secondary btn-sm" pendingText="Saving…">
                  Update
                </SubmitButton>
              </ActionForm>
            </section>

            <section className="panel panel-block" style={{ marginTop: 16 }}>
              <h2 className="panel-title">Lead qualification</h2>
              <p style={{ fontSize: 12, color: "var(--faint)", marginTop: 0 }}>
                Research pre-fills these; your ratings always take precedence.
              </p>
              <ActionForm action={qualifyProspect}>
                <input type="hidden" name="id" value={prospect.id} />
                {CRITERIA.map((c) => (
                  <div key={c.key} style={{ marginBottom: 8 }}>
                    <label htmlFor={`q-${c.key}`} style={{ fontSize: 12, color: "var(--faint)" }}>
                      {c.label}
                    </label>
                    <select id={`q-${c.key}`} name={c.key} defaultValue={String(prospect[c.key] ?? 0)} style={{ width: "100%" }}>
                      {c.options.map((label, value) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
                <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, margin: "10px 0" }}>
                  <input type="checkbox" name="disqualified" defaultChecked={prospect.qualification_status === "disqualified"} />
                  Manually disqualify (overrides the score)
                </label>
                <SubmitButton className="btn btn-secondary btn-sm" pendingText="Scoring…">
                  Save &amp; rescore
                </SubmitButton>
              </ActionForm>
            </section>

            {member.role === "owner" && (
              <section className="panel panel-block" style={{ marginTop: 16 }}>
                <h2 className="panel-title">Danger zone</h2>
                <ActionForm
                  action={deleteProspect}
                  confirmText={`Delete ${prospect.company} and their whole history (messages, research, timeline)? This can't be undone.`}
                >
                  <input type="hidden" name="id" value={prospect.id} />
                  <SubmitButton className="btn btn-danger btn-sm" pendingText="Deleting…">
                    Delete prospect
                  </SubmitButton>
                </ActionForm>
              </section>
            )}
          </div>
        </div>
      )}
    </>
  );
}
