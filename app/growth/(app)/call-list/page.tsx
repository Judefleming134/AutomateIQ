import Link from "next/link";
import { Phone } from "lucide-react";
import { requireGrowth } from "@/lib/growth/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { dublinDate, dublinLocalToUtcISO } from "@/lib/growth/dates";
import { cleanSocialUrl } from "@/lib/growth/research";
import { buildQuote, formatEuro } from "@/lib/growth/pricing";
import { PROSPECT_STATUS_META, type ProspectStatus } from "@/lib/growth/constants";
import { ActionForm } from "@/components/admin/action-form";
import { SubmitButton } from "@/components/admin/submit-button";
import { addActivity, logNoAnswer } from "../prospects/actions";

export const metadata = { title: "Call list · Growth Engine" };

const MAX_ITEMS = 40;

/**
 * The dial list on ONE surface — everything needed to make the call is on the
 * card, so working through 30 prospects doesn't mean 30 open tabs. Number to
 * tap, the pitch + quote, a short script, their socials, and a one-tap "Log
 * call" (which schedules the follow-up). "Open workspace" is there for the deep
 * dive, but the point is you shouldn't need it to make the call.
 */
export default async function CallListPage() {
  await requireGrowth();
  const admin = createAdminClient();
  const today = dublinDate();

  // The warm phone list: has a number, still in a workable pre-close status.
  // Replies live in the Inbox; won/lost/booked/qualified are handled elsewhere.
  const COLUMNS =
    "id, company, contact_name, lead_score, status, phone, next_follow_up_at, last_contact_at, industry, location, linkedin_url, instagram_url, facebook_url";
  const WORKABLE = ["contacted", "follow_up_sent", "outreach_ready", "research_complete"];

  // TWO queries, deliberately. A single score-ordered fetch capped at 160 meant
  // a DUE CHASE scoring below that cut never entered the list at all — the
  // "due chases first" sort below could only reorder whatever the score window
  // happened to contain. On a database of a few hundred phone leads that hides
  // the most time-critical calls completely. Due chases are now fetched on
  // their own terms (most overdue first) and merged with the top-scored rest.
  const [{ data: dueRaw }, { data: topRaw }, { count: workableTotal }] = await Promise.all([
    admin
      .from("ge_prospects")
      .select(COLUMNS)
      .not("phone", "is", null)
      .in("status", WORKABLE)
      .not("next_follow_up_at", "is", null)
      .lte("next_follow_up_at", today)
      .order("next_follow_up_at", { ascending: true })
      .limit(80),
    admin
      .from("ge_prospects")
      .select(COLUMNS)
      .not("phone", "is", null)
      .in("status", WORKABLE)
      .order("lead_score", { ascending: false, nullsFirst: false })
      .limit(160),
    // The TRUE size of the callable pool, so the page can say how many are
    // left rather than implying 40 is all there is.
    admin
      .from("ge_prospects")
      .select("id", { count: "exact", head: true })
      .not("phone", "is", null)
      .in("status", WORKABLE),
  ]);

  const isDue = (p: { next_follow_up_at: string | null }) =>
    !!p.next_follow_up_at && p.next_follow_up_at.slice(0, 10) <= today;

  // Drop anyone already called today so the list is always "who's LEFT" and
  // shrinks as you work down it (the DM list does the same for sent DMs). A
  // logged call sets last_contact_at, so they fall off on the next load — no
  // re-dialling the person you just spoke to. They stay in Prospects if needed.
  // The boundary is Dublin midnight, not UTC: in summer a call logged between
  // midnight and 1am Irish falls before UTC midnight and the person would pop
  // back onto the list.
  const todayStart =
    dublinLocalToUtcISO(`${today}T00:00`) ?? new Date(`${today}T00:00:00Z`).toISOString();
  const calledToday = (p: { last_contact_at: string | null }) =>
    !!p.last_contact_at && p.last_contact_at >= todayStart;

  // Merge (due first, then by score), de-duplicate — a lead can legitimately
  // appear in both queries — then drop anyone already called today. Array.sort
  // is stable, so score order holds within each group.
  const merged = [...(dueRaw ?? []), ...(topRaw ?? [])];
  const seen = new Set<string>();
  const deduped = merged.filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)));
  const workable = deduped.filter((p) => !calledToday(p));
  const prospects = [...workable]
    .sort((a, b) => (isDue(a) === isDue(b) ? 0 : isDue(a) ? -1 : 1))
    .slice(0, MAX_ITEMS);
  const dueCount = workable.filter(isDue).length;
  const remaining = Math.max(0, (workableTotal ?? workable.length) - prospects.length);

  // Batch-load research for the pitch + script — one query, mapped in memory.
  const ids = prospects.map((p) => p.id);
  type ResearchRow = {
    prospect_id: string;
    report: {
      conversation_starters?: string[];
      discovery_questions?: string[];
      proposal_angle?: string;
    } | null;
    solutions: { key?: string; name?: string }[] | null;
  };
  const { data: researchRows } = ids.length
    ? await admin.from("ge_research").select("prospect_id, report, solutions").in("prospect_id", ids)
    : { data: [] as ResearchRow[] };
  const researchById = new Map(
    (researchRows ?? []).map((r) => [r.prospect_id, r as ResearchRow])
  );

  return (
    <>
      <div className="page-header">
        <div>
          <h1>
            <Phone size={20} style={{ verticalAlign: "-3px", marginRight: 8 }} />
            Call list
          </h1>
          <p>
            Who&apos;s left to call today, on one page — tap to call, the pitch
            and script are right here, log the call in a tap. Anyone you log
            drops off the list, so you just work down it. No tab per prospect.
          </p>
        </div>
      </div>

      {prospects.length === 0 ? (
        <div className="panel panel-block">
          <p className="empty-state" style={{ margin: 0 }}>
            Nothing left to call right now — either you&apos;ve worked today&apos;s
            list (nice one), or there are no phone prospects yet. Uncalled ones
            appear here warmest first; import or research more to top it up.
          </p>
        </div>
      ) : (
        <>
          <p style={{ fontSize: 13, color: "var(--faint)", margin: "0 0 12px" }}>
            Showing {prospects.length}
            {dueCount > 0 ? (
              <>
                {" "}·{" "}
                <strong style={{ color: "var(--orange, #fb923c)" }}>
                  {dueCount} chase{dueCount === 1 ? "" : "s"} due
                </strong>{" "}
                — those are first
              </>
            ) : (
              " · best score first"
            )}
            {remaining > 0 && (
              <>
                {" "}· <strong>{remaining} more</strong> still to call — log a
                call and the next one takes its place, or{" "}
                <Link href="/growth/prospects?phone=1">see the whole list</Link>
              </>
            )}
          </p>
          <div style={{ display: "grid", gap: 12 }}>
            {prospects.map((p) => {
              const research = researchById.get(p.id);
              const solutions = (research?.solutions ?? []).filter(
                (s): s is { key: string; name: string } => Boolean(s?.key && s?.name)
              );
              const quote = solutions.length ? buildQuote(solutions) : null;
              const openers = (research?.report?.conversation_starters ?? []).slice(0, 2);
              const questions = (research?.report?.discovery_questions ?? []).slice(0, 2);
              const meta = PROSPECT_STATUS_META[p.status as ProspectStatus];
              const socials = [
                ["in", cleanSocialUrl(p.linkedin_url ?? "")],
                ["IG", cleanSocialUrl(p.instagram_url ?? "")],
                ["FB", cleanSocialUrl(p.facebook_url ?? "")],
              ].filter(([, url]) => url) as [string, string][];
              const tel = `tel:${(p.phone ?? "").replace(/[^\d+]/g, "")}`;

              return (
                <section key={p.id} className="panel panel-block">
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 8 }}>
                    <Link href={`/growth/prospects/${p.id}`}>
                      <strong>{p.company}</strong>
                    </Link>
                    <span style={{ fontSize: 12.5, color: "var(--faint)" }}>
                      {p.contact_name ? `${p.contact_name} · ` : ""}
                      {[p.industry, p.location].filter(Boolean).join(" · ") || "—"} · score {p.lead_score ?? 0}
                    </span>
                    <span className={`badge ${meta?.badge ?? "badge-gray"}`}>{meta?.label ?? p.status}</span>
                    {isDue(p) && <span className="badge badge-orange">chase due</span>}
                  </div>

                  <a href={tel} className="btn btn-primary" style={{ marginBottom: 10 }}>
                    <Phone size={14} /> {p.phone}
                  </a>

                  {(solutions.length > 0 || quote) && (
                    <div style={{ fontSize: 13, margin: "0 0 8px" }}>
                      <strong>Pitch:</strong>{" "}
                      {solutions.slice(0, 3).map((s) => s.name).join(" · ") || "—"}
                      {quote && (
                        <span style={{ color: "var(--green, #34d399)" }}>
                          {" "}— {quote.hasFrom ? "from " : ""}
                          {formatEuro(quote.setupTotal)} setup
                          {quote.monthlyTotal > 0 ? ` + ${formatEuro(quote.monthlyTotal)}/mo` : ""}
                        </span>
                      )}
                    </div>
                  )}

                  {(openers.length > 0 || questions.length > 0) && (
                    <div
                      style={{
                        fontSize: 13,
                        background: "var(--bg2, rgba(255,255,255,.03))",
                        border: "1px solid var(--line, rgba(255,255,255,.08))",
                        borderRadius: 8,
                        padding: "8px 10px",
                        marginBottom: 8,
                      }}
                    >
                      {openers.length > 0 && (
                        <div>
                          <span style={{ color: "var(--faint)" }}>Open with:</span> {openers[0]}
                        </div>
                      )}
                      {questions.length > 0 && (
                        <div style={{ marginTop: 4 }}>
                          <span style={{ color: "var(--faint)" }}>Ask:</span> {questions.join(" · ")}
                        </div>
                      )}
                    </div>
                  )}

                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                    <ActionForm action={addActivity} className="inline-form" style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                      <input type="hidden" name="id" value={p.id} />
                      <input type="hidden" name="type" value="call" />
                      <input
                        name="content"
                        placeholder="How did the call go? (optional)"
                        maxLength={4000}
                        style={{ flex: "1 1 200px", minWidth: 160 }}
                        aria-label="Call outcome (optional)"
                      />
                      <SubmitButton className="btn btn-primary btn-sm" pendingText="Logging…">
                        <Phone size={13} /> Log call
                      </SubmitButton>
                    </ActionForm>
                    {/* The other outcome of most dials. Logged as an attempt,
                        but back on the list TOMORROW instead of in 3 days. */}
                    <ActionForm action={logNoAnswer} className="inline-form">
                      <input type="hidden" name="id" value={p.id} />
                      <SubmitButton className="btn btn-secondary btn-sm" pendingText="…">
                        No answer
                      </SubmitButton>
                    </ActionForm>
                    {socials.map(([label, url]) => (
                      <a key={label} href={url} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm">
                        {label} ↗
                      </a>
                    ))}
                    {/* Straight to the Conversation tab: that's where the full
                        per-business call sheet and the thread live. Landing on
                        Research mid-dial meant a tap to get to the script. */}
                    <Link
                      href={`/growth/prospects/${p.id}?tab=conversation`}
                      className="btn btn-ghost btn-sm"
                      style={{ marginLeft: "auto" }}
                    >
                      Open workspace →
                    </Link>
                  </div>
                  <p style={{ fontSize: 11, color: "var(--faint)", margin: "6px 0 0" }}>
                    Logging the call schedules the follow-up automatically — no tab needed.
                  </p>
                </section>
              );
            })}
          </div>
        </>
      )}
    </>
  );
}
