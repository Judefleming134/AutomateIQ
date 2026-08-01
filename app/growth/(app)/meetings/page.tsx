import Link from "next/link";
import { requireGrowth, loadGrowthSettings } from "@/lib/growth/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { ActionForm } from "@/components/admin/action-form";
import { SubmitButton } from "@/components/admin/submit-button";
import { CopyButton } from "@/components/portal/copy-button";
import { MEETING_STATUS_META, type MeetingStatus } from "@/lib/growth/constants";
import { selectAllRows } from "@/lib/growth/db";
import { splitMeetings } from "@/lib/growth/meeting-order";
import { recordMeeting, setMeetingStatus, syncStrategyBookings } from "./actions";

function fmt(ts: string, fromBooking = false): string {
  // Public-booking slots are labelled by their UTC wall-clock (a slot stored
  // 14:00Z is shown to the customer as "2:00pm" in the confirmation email), so
  // meetings synced FROM a booking must render the same way or Jude's list
  // disagrees with what the customer was told by an hour in summer (IST=UTC+1).
  // Manually recorded meetings ARE stored as true instants (dublinLocalToUtcISO)
  // and render correctly in Europe/Dublin.
  return new Date(ts).toLocaleString("en-IE", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: fromBooking ? "UTC" : "Europe/Dublin",
  });
}

/** Renders meeting notes with any URL (e.g. a pasted Zoom link) as a
 *  clickable link, so a call can be joined straight from the meeting card. */
function NotesWithLinks({ text }: { text: string }) {
  // Stop the URL before trailing sentence punctuation / a closing bracket, so
  // a Zoom link pasted as "join https://zoom.us/j/123." doesn't become a link
  // with a trailing "." that 404s. Real path/query chars are still included.
  const parts = text.split(/(https?:\/\/[^\s]*[^\s.,;:!?)\]}'"<>])/g);
  return (
    <>
      {parts.map((part, i) =>
        /^https?:\/\//.test(part) ? (
          <a key={i} href={part} target="_blank" rel="noreferrer">
            {part}
          </a>
        ) : (
          part
        )
      )}
    </>
  );
}

export default async function MeetingsPage() {
  await requireGrowth();
  const admin = createAdminClient();

  const [{ data: meetings }, prospects, settings] = await Promise.all([
    admin
      .from("ge_meetings")
      .select("id, prospect_id, scheduled_at, status, notes, strategy_booking_id")
      .order("scheduled_at", { ascending: false })
      .limit(300),
    // Page past the 1,000-row cap so every meeting resolves its prospect
    // (no "Unknown prospect" for later-alphabet companies) and every lead
    // stays selectable in the record-a-meeting dropdown after big imports.
    selectAllRows<{
      id: string;
      company: string;
      contact_name: string;
      phone: string | null;
    }>(() =>
      admin
        .from("ge_prospects")
        .select("id, company, contact_name, phone")
        .order("company")
    ),
    loadGrowthSettings(),
  ]);

  const prospectById = new Map(prospects.map((p) => [p.id, p]));
  // The three lists, and the ordering rules behind them, live in
  // lib/growth/meeting-order.ts so they can be tested. Doing it inline here is
  // how "Upcoming" ended up sorted soonest-first and then reversed at render,
  // which put the furthest-away meeting back at the top for the whole life of
  // the fix that was meant to correct it.
  const { upcoming, awaitingOutcome, past } = splitMeetings(meetings ?? []);

  const MeetingRow = ({ m }: { m: NonNullable<typeof meetings>[number] }) => {
    const p = prospectById.get(m.prospect_id);
    const meta = MEETING_STATUS_META[m.status as MeetingStatus];
    return (
      <div className="panel panel-block">
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          {p ? (
            <Link href={`/growth/prospects/${p.id}`}>
              <strong>{p.company}</strong>
            </Link>
          ) : (
            <strong>Unknown prospect</strong>
          )}
          <span style={{ color: "var(--faint)", fontSize: 13 }}>{p?.contact_name}</span>
          <span className={`badge ${meta?.badge ?? "badge-gray"}`}>{meta?.label ?? m.status}</span>
          {m.strategy_booking_id && <span className="badge badge-blue">Booking page</span>}
        </div>
        <div style={{ marginTop: 6, fontSize: 14 }}>{fmt(m.scheduled_at, Boolean(m.strategy_booking_id))} (Irish time)</div>
        {p?.phone && (
          <a
            href={`tel:${p.phone.replace(/[^\d+]/g, "")}`}
            style={{ fontSize: 13, display: "inline-block", marginTop: 6, color: "var(--ac2, #3b82f6)" }}
            title="Tap to call"
          >
            ☎ {p.phone}
          </a>
        )}
        {m.notes && (
          <p style={{ fontSize: 13, color: "var(--faint)", margin: "6px 0 0", whiteSpace: "pre-wrap" }}>
            <NotesWithLinks text={m.notes} />
          </p>
        )}
        {m.status === "booked" && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
            {(["completed", "no_show", "cancelled"] as const).map((s) => (
              <ActionForm action={setMeetingStatus} key={s}>
                <input type="hidden" name="meeting_id" value={m.id} />
                <input type="hidden" name="status" value={s} />
                <SubmitButton className="btn btn-secondary btn-sm" pendingText="…">
                  {MEETING_STATUS_META[s].label}
                </SubmitButton>
              </ActionForm>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Calendar &amp; booking</h1>
          <p>
            AI Strategy Sessions and sales meetings. Prospects book through the
            public booking page — sync pulls their bookings in by email match.
          </p>
        </div>
      </div>

      <div className="grid-main-side">
        <div>
          <h2 className="section-title">Upcoming ({upcoming.length})</h2>
          {upcoming.length === 0 ? (
            <div className="panel panel-block">
              {/* A bare "No upcoming meetings." is a dead end on the page whose
                  entire point is getting one booked — say what fills it. */}
              <p className="empty-state" style={{ margin: 0 }}>
                Nothing booked yet. Sessions land here when a prospect books
                through your link (sync pulls them in by email match) or when
                you record one below. Fastest route to the next booking:{" "}
                <Link href="/growth/call-list">work the call list</Link> and send
                anyone warm the booking link.
              </p>
            </div>
          ) : (
            <div style={{ display: "grid", gap: 12 }}>
              {upcoming.map((m) => (
                <MeetingRow key={m.id} m={m} />
              ))}
            </div>
          )}

          {awaitingOutcome.length > 0 && (
            <>
              <h2 className="section-title" style={{ marginTop: 24 }}>
                Awaiting outcome ({awaitingOutcome.length})
              </h2>
              <p style={{ fontSize: 12.5, color: "var(--faint)", margin: "0 0 12px" }}>
                These calls have passed but aren&apos;t marked yet — tap the
                result so your pipeline and analytics stay accurate.
              </p>
              <div style={{ display: "grid", gap: 12 }}>
                {awaitingOutcome.map((m) => (
                  <MeetingRow key={m.id} m={m} />
                ))}
              </div>
            </>
          )}

          {past.length > 0 && (
            <>
              <h2 className="section-title" style={{ marginTop: 24 }}>
                Past &amp; closed ({past.length})
              </h2>
              <div style={{ display: "grid", gap: 12 }}>
                {past.slice(0, 30).map((m) => (
                  <MeetingRow key={m.id} m={m} />
                ))}
              </div>
              {past.length > 30 && (
                <p style={{ fontSize: 12, color: "var(--faint)", marginTop: 10 }}>
                  Showing the 30 most recent of {past.length}. Nothing is lost —
                  older meetings stay on each prospect&apos;s page.
                </p>
              )}
            </>
          )}
        </div>

        <div>
          <section className="panel panel-block" aria-label="Booking page">
            <h2 className="panel-title">Booking page</h2>
            <p style={{ fontSize: 13, color: "var(--faint)", marginTop: 0 }}>
              Send ready prospects here — it&apos;s the same AI Strategy Session
              flow the website uses, so slots, confirmations and owner alerts
              all just work.
            </p>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <code style={{ fontSize: 12, wordBreak: "break-all" }}>{settings.bookingUrl}</code>
              <CopyButton text={settings.bookingUrl} label="Copy link" />
            </div>
            <ActionForm action={syncStrategyBookings} style={{ marginTop: 12 }}>
              <SubmitButton className="btn btn-primary btn-sm" pendingText="Syncing…">
                Sync bookings → meetings
              </SubmitButton>
            </ActionForm>
            <p style={{ fontSize: 12, color: "var(--faint)", marginTop: 8 }}>
              Matches bookings to prospects by email. Safe to run any time —
              nothing is duplicated.
            </p>
          </section>

          <section className="panel panel-block" style={{ marginTop: 16 }} aria-label="Record a meeting">
            <h2 className="panel-title">Record a meeting</h2>
            <ActionForm action={recordMeeting}>
              <label htmlFor="rm-prospect">Prospect</label>
              <select id="rm-prospect" name="prospect_id" required defaultValue="">
                <option value="" disabled>
                  Choose…
                </option>
                {(prospects ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.company} — {p.contact_name}
                  </option>
                ))}
              </select>
              <label htmlFor="rm-when">When</label>
              <input id="rm-when" type="datetime-local" name="scheduled_at" required />
              <label htmlFor="rm-notes">Notes</label>
              <textarea id="rm-notes" name="notes" rows={3} maxLength={2000} />
              <div className="form-actions">
                <SubmitButton pendingText="Recording…">Record meeting</SubmitButton>
              </div>
            </ActionForm>
          </section>
        </div>
      </div>
    </>
  );
}
