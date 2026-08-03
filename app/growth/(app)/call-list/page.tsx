import Link from "next/link";
import { Phone } from "lucide-react";
import { requireGrowth } from "@/lib/growth/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { selectAllRowsByIds } from "@/lib/growth/db";
import { dublinDate, dublinLocalToUtcISO } from "@/lib/growth/dates";
import { cleanSocialUrl } from "@/lib/growth/research";
import { buildQuote, formatEuro } from "@/lib/growth/pricing";
import { PROSPECT_STATUS_META, type ProspectStatus } from "@/lib/growth/constants";
import { ActionForm } from "@/components/admin/action-form";
import { SubmitButton } from "@/components/admin/submit-button";
import { addActivity, logNoAnswer } from "../prospects/actions";

export const metadata = { title: "Call list · Growth Engine" };

const MAX_ITEMS = 40;

/** Irish calendar day of a UTC timestamp — same basis as dublinDate(). */
const dublinDayOf = (iso: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Dublin" }).format(new Date(iso));

/**
 * "yesterday" / "4 days ago", counted in Irish calendar days rather than 24h
 * chunks — a call logged at 11pm Monday reads as "yesterday" on Tuesday
 * morning, not "today".
 */
function lastContactLabel(iso: string | null, today: string): string | null {
  if (!iso) return null;
  const day = dublinDayOf(iso);
  const diff = Math.round(
    (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`)) / 86_400_000
  );
  if (!Number.isFinite(diff) || diff < 0) return null;
  if (diff === 0) return "today";
  if (diff === 1) return "yesterday";
  if (diff < 14) return `${diff} days ago`;
  if (diff < 60) return `${Math.round(diff / 7)} weeks ago`;
  return "a while back";
}

/** "Fri 1 Aug" — noon avoids any DST edge when parsing a plain date. */
const chaseDayLabel = (date: string) =>
  new Intl.DateTimeFormat("en-IE", {
    timeZone: "Europe/Dublin",
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(new Date(`${date.slice(0, 10)}T12:00:00Z`));

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
  // The Dublin-midnight boundary for "called today" — declared before the
  // queries because the head-count below needs it too. In summer a call logged
  // between midnight and 1am Irish falls before UTC midnight, and using UTC
  // would pop that person back onto the list.
  const todayStart =
    dublinLocalToUtcISO(`${today}T00:00`) ?? new Date(`${today}T00:00:00Z`).toISOString();

  const [
    { data: dueRaw },
    { data: topRaw },
    { count: workableTotal },
    { data: workedTodayRows },
  ] = await Promise.all([
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
    // WHO HAS ACTUALLY BEEN RUNG TODAY — asked of the timeline, not of
    // last_contact_at.
    //
    // This page used to decide it from `last_contact_at >= todayStart`, and
    // that column is stamped by recordOutreachSent on EVERY outreach touch:
    // the 07:00 email autopilot, "Mark sent" on the DM list, the composer, the
    // inbox Send button. So the thirty prospects the engine emailed at 07:00
    // vanished from the call list before Jude opened it — and they are the
    // TOP-SCORED thirty, because that is exactly who the autopilot picks. The
    // page then congratulated him: "30 done today", in green, before he had
    // dialled a single number.
    //
    // An email that went out this morning is a REASON to ring someone, not a
    // reason to hide them. `type` in ("call", "meeting") is the unambiguous
    // signal that a human worked this lead today: addActivity writes "call" for
    // Log call and "meeting" for a logged meeting, and logNoAnswer writes
    // "call" too — so a no-answer still drops off today, exactly as before.
    admin
      .from("ge_activities")
      .select("prospect_id")
      .in("type", ["call", "meeting"])
      .gte("created_at", todayStart)
      // A day's calls is tens of rows. The cap is only here so a pathological
      // day can't page; it is far below PostgREST's 1,000.
      .limit(500),
  ]);

  // Distinct people worked today. Every one of them, whatever happened to the
  // lead afterwards — this is the "you've done N today" number.
  const workedTodayIds = new Set(
    (workedTodayRows ?? []).map((a) => a.prospect_id as string)
  );

  const isDue = (p: { next_follow_up_at: string | null }) =>
    !!p.next_follow_up_at && p.next_follow_up_at.slice(0, 10) <= today;
  // A chase date already in the diary, later than today: this person has been
  // dealt with and has an agreed date. They are NOT today's problem.
  const bookedAhead = (p: { next_follow_up_at: string | null }) =>
    !!p.next_follow_up_at && p.next_follow_up_at.slice(0, 10) > today;

  // Drop anyone already rung today so the list is always "who's LEFT" and
  // shrinks as you work down it (the DM list does the same for sent DMs).
  // Logging a call or a no-answer writes the activity below, so they fall off
  // on the next load — no re-dialling the person you just spoke to. They stay
  // in Prospects, and on tomorrow's list, either way.
  //
  // Deliberately NOT last_contact_at: see the query above. An email or a DM
  // stamps that column too, and being emailed is not being called.
  const calledToday = (p: { id: string }) => workedTodayIds.has(p.id);

  // Merge, de-duplicate — a lead can legitimately appear in both queries —
  // then drop anyone already called today.
  const merged = [...(dueRaw ?? []), ...(topRaw ?? [])];
  const seen = new Set<string>();
  const deduped = merged.filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)));
  const workable = deduped.filter((p) => !calledToday(p));

  // THREE tiers, not two. It used to be "due chases first, everyone else by
  // score", which quietly put a business Jude rang YESTERDAY — and agreed to
  // chase on Friday — near the top of today's list, purely because it scores
  // well. Nothing on the card said so, so the only way to find out was the
  // person answering the phone. Someone with a chase date still ahead of them
  // now sinks below the leads that haven't been rung at all, and every card
  // carries its last-contact line. Array.sort is stable, so the order WITHIN
  // each tier is untouched: due date ascending, then score descending.
  //   0 — chase due today or overdue
  //   1 — nothing in the diary (never rung, or rung with no date agreed)
  //   2 — already spoken to, chase booked for a later day
  const tier = (p: { next_follow_up_at: string | null }) =>
    isDue(p) ? 0 : bookedAhead(p) ? 2 : 1;
  const prospects = [...workable].sort((a, b) => tier(a) - tier(b)).slice(0, MAX_ITEMS);
  const dueCount = workable.filter(isDue).length;

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
  const [{ data: researchRows }, workedInPoolRows] = await Promise.all([
    ids.length
      ? admin.from("ge_research").select("prospect_id, report, solutions").in("prospect_id", ids)
      : Promise.resolve({ data: [] as ResearchRow[] }),
    // How many of the people worked today came out of THIS pool — the exact
    // number to subtract below, so "N more still to call" can't drift.
    //
    // Counted against the same phone + WORKABLE filter as the pool total, and
    // CHUNKED: every id rides in the request URL at ~40 chars, so a heavy day
    // of dialling would otherwise build a URL that simply fails — and a failed
    // count here reads as "nobody worked today", inflating the number it exists
    // to keep honest.
    workedTodayIds.size
      ? selectAllRowsByIds<{ id: string }>([...workedTodayIds], (chunk) =>
          admin
            .from("ge_prospects")
            .select("id")
            .not("phone", "is", null)
            .in("status", WORKABLE)
            .in("id", chunk)
        )
      : Promise.resolve([] as { id: string }[]),
  ]);
  const researchById = new Map(
    (researchRows ?? []).map((r) => [r.prospect_id, r as ResearchRow])
  );

  // Two different questions, two different numbers.
  //   callsToday   — people Jude worked today, for the "you've done N" line.
  //                  Counts everyone, including a lead a call moved out of the
  //                  callable pool. Crediting his effort must not depend on
  //                  where the lead ended up.
  //   workedInPool — how many of those are still countable inside
  //                  `workableTotal`, which is the only figure it is valid to
  //                  subtract from it.
  const callsToday = workedTodayIds.size;
  const workedInPool = (workedInPoolRows ?? []).length;
  // Exclude today's completed calls from "still to call" — they're done, and
  // counting them meant the number never fell as he worked down the list.
  const remaining = Math.max(
    0,
    (workableTotal ?? workable.length) - workedInPool - prospects.length
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
            {callsToday > 0
              ? `Nothing left to call — that's ${callsToday} logged today. Nice one. Tomorrow's chases will be waiting here in the morning.`
              : "Nothing left to call right now — there are no phone prospects in a workable stage yet. Uncalled ones appear here warmest first; import or research more to top it up."}
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
            {callsToday > 0 && (
              <>
                {" "}·{" "}
                <strong style={{ color: "var(--green, #34d399)" }}>
                  {callsToday} done today
                </strong>
              </>
            )}
            <br />
            Anyone with a chase already booked for a later day sits at the
            bottom — each card says when you last spoke to them.
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
              const lastContact = lastContactLabel(p.last_contact_at, today);
              const booked = bookedAhead(p);
              // Rang in the last couple of days: worth flagging in orange so
              // it registers BEFORE the number is tapped.
              const recent = lastContact === "yesterday" || lastContact === "today";

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

                  {/* Where this lead actually stands, said before the number is
                      tapped — the card used to show none of it, so a business
                      rung yesterday looked identical to one never contacted. */}
                  <p
                    style={{
                      fontSize: 12,
                      color: recent ? "var(--orange, #fb923c)" : "var(--faint)",
                      margin: "0 0 8px",
                    }}
                  >
                    {lastContact ? `Last contact ${lastContact}` : "Never contacted"}
                    {booked && p.next_follow_up_at
                      ? ` · chase booked for ${chaseDayLabel(p.next_follow_up_at)} — not due yet`
                      : ""}
                  </p>

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
                        and back on the list TOMORROW instead of in 3 days —
                        unless a later chase is already agreed, which a
                        no-answer never overwrites (see logNoAnswer / K7). The
                        timeline entry says which of the two happened. */}
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
