import Link from "next/link";
import { requireGrowth, loadGrowthSettings } from "@/lib/growth/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { ActionForm } from "@/components/admin/action-form";
import { SubmitButton } from "@/components/admin/submit-button";
import { CopyButton } from "@/components/portal/copy-button";
import { MessageComposer, type ComposerTemplate } from "@/components/growth/message-composer";
import {
  CHANNEL_META,
  CHANNELS,
  MESSAGE_STATUS_META,
  SENTIMENT_META,
  fillTemplate,
  type Channel,
  type MessageStatus,
  type Sentiment,
} from "@/lib/growth/constants";
import { sendQueuedEmail, markMessageSent, deleteMessage, logInboundMessage } from "./actions";

function fmt(ts: string | null | undefined): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleString("en-IE", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Dublin",
  });
}

/** Compact "how long ago" for the conversation list, so a fresh reply is
 *  obvious next to a stale one at a glance. Falls back to a short date past a
 *  week. */
function relTime(ts: string | null | undefined): string {
  if (!ts) return "";
  const diffMs = Date.now() - new Date(ts).getTime();
  if (!Number.isFinite(diffMs) || diffMs < 0) return "";
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(ts).toLocaleDateString("en-IE", { day: "numeric", month: "short", timeZone: "Europe/Dublin" });
}

/**
 * A labelled timestamp for a thread message so "did this actually send?" is
 * unmistakable: a SENT email shows its real send time ("Sent 10 Jul 14:32"),
 * a draft shows when it was written, etc. — the bare time alone silently
 * mixed send-time and draft-time.
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

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ p?: string; view?: string }>;
}) {
  await requireGrowth();
  const params = await searchParams;
  const admin = createAdminClient();
  const view = params.view === "queue" ? "queue" : "conversations";

  const MSG_COLS =
    "id, prospect_id, channel, direction, status, subject, body, sentiment, scheduled_at, sent_at, created_at";
  const { data: allMessages } = await admin
    .from("ge_messages")
    .select(MSG_COLS)
    .order("created_at", { ascending: false })
    .limit(1000);

  const messages = allMessages ?? [];

  // A blind "newest 1000 messages" is a trap for the Conversations view: the
  // engine writes ~5 drafts per researched prospect, so a fresh research or
  // autopilot batch can fill that window with new DRAFTS and push a real
  // inbound reply out of it — silently hiding the whole conversation from the
  // inbox. Inbound messages are far fewer than outbound, so fetch them
  // directly and load the FULL threads for those prospects. That guarantees
  // every reply shows up and every open thread is complete, regardless of how
  // much outreach volume has built up.
  const { data: inboundRows } = await admin
    .from("ge_messages")
    .select("prospect_id")
    .eq("direction", "inbound")
    .order("created_at", { ascending: false })
    .limit(1000);
  const inboundPids = [...new Set((inboundRows ?? []).map((r) => r.prospect_id))];
  const { data: threadRows } = inboundPids.length
    ? await admin.from("ge_messages").select(MSG_COLS).in("prospect_id", inboundPids)
    : { data: [] as typeof messages };
  // Newest-first, matching the global fetch's ordering the conversation
  // builder relies on (thread[0] = latest).
  const convMessages = (threadRows ?? [])
    .slice()
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));

  // The queue gets the same treatment as conversations: fetched directly, not
  // filtered out of the capped global window. Once sent-mail history passes
  // the 1,000-row window, older queued/failed drafts fell out of it and
  // silently vanished from this view — while the 8am cron would still send
  // them. Direct fetch means what's shown is exactly what's pending.
  const { data: queueRows } = await admin
    .from("ge_messages")
    .select(MSG_COLS)
    .eq("direction", "outbound")
    .in("status", ["draft", "queued", "failed"])
    .order("created_at", { ascending: false })
    .limit(500);

  // Prospect lookup covers everything shown: conversation threads + the queue.
  const prospectIds = [
    ...new Set(
      [...convMessages, ...messages, ...(queueRows ?? [])].map((m) => m.prospect_id)
    ),
  ];
  const { data: prospectsRaw } = prospectIds.length
    ? await admin
        .from("ge_prospects")
        .select("id, company, contact_name, email, status, campaign_id, industry, location, notes, linkedin_url, instagram_url, phone")
        .in("id", prospectIds)
    : { data: [] as never[] };
  const prospects = new Map((prospectsRaw ?? []).map((p) => [p.id, p]));

  // Conversations: THE INBOX — only prospects who have actually messaged us
  // (at least one inbound). Outbound-only prospects are outreach, not
  // conversations; they'd flood this list with Jude's own sends the moment a
  // batch is queued. They live in the Outreach queue view instead. Newest
  // message per prospect, unanswered replies first.
  const conversations = inboundPids
    .map((pid) => {
      const thread = convMessages.filter((m) => m.prospect_id === pid);
      const latest = thread[0];
      // "Who spoke last" must only count messages that actually happened —
      // inbound, or outbound that genuinely SENT. The engine auto-drafts a
      // suggested reply after every inbound, and that unsent draft would
      // otherwise register as "we replied" and silently clear the Reply-due
      // flag on every single conversation.
      const latestReal =
        thread.find(
          (m) => m.direction === "inbound" || m.status === "sent"
        ) ?? latest;
      const awaitingUs = latestReal?.direction === "inbound";
      return { pid, thread, latest, latestReal, awaitingUs };
    })
    .filter(
      (c) =>
        prospects.has(c.pid) &&
        c.thread.some((m) => m.direction === "inbound")
    )
    .sort((a, b) => {
      if (a.awaitingUs !== b.awaitingUs) return a.awaitingUs ? -1 : 1;
      return a.latestReal.created_at < b.latestReal.created_at ? 1 : -1;
    });

  const selectedId =
    params.p && prospects.has(params.p) ? params.p : conversations[0]?.pid ?? null;
  const selected = selectedId ? prospects.get(selectedId) : null;
  // From the complete per-prospect threads, not the capped global window, so
  // the open conversation always shows its full history. An outbound-only
  // prospect opened via ?p= won't be in the inbound threads — fall back to the
  // global window for that rare case so nothing regresses.
  const selectedThread = !selectedId
    ? []
    : convMessages.some((m) => m.prospect_id === selectedId)
      ? convMessages.filter((m) => m.prospect_id === selectedId)
      : messages.filter((m) => m.prospect_id === selectedId);
  const lastInbound = selectedThread.find((m) => m.direction === "inbound");

  // Surface what needs a decision first: a FAILED send (retry or delete) then
  // QUEUED (scheduled for 8am), then the bulk of plain drafts. The rows are
  // already newest-first and Array.sort is stable, so date order is preserved
  // within each status group.
  const queueRank: Record<string, number> = { failed: 0, queued: 1, draft: 2 };
  const queue = (queueRows ?? [])
    .slice()
    .sort((a, b) => (queueRank[a.status] ?? 3) - (queueRank[b.status] ?? 3));

  let templates: ComposerTemplate[] = [];
  let settingsBookingUrl = "";
  if (selected) {
    const [{ data: templatesRaw }, settings] = await Promise.all([
      admin.from("ge_templates").select("id, name, channel, subject, body").order("name"),
      loadGrowthSettings(),
    ]);
    settingsBookingUrl = settings.bookingUrl;
    templates = (templatesRaw ?? []).map((t) => ({
      id: t.id,
      name: t.name,
      channel: t.channel as Channel,
      subject: t.subject ? fillTemplate(t.subject, selected, settingsBookingUrl) : null,
      body: fillTemplate(t.body, selected, settingsBookingUrl),
    }));
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Conversation inbox</h1>
          <p>
            Prospects who&apos;ve messaged you — replies waiting on you come
            first. Your own outreach lives in the queue tab, not here.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Link
            href="/growth/inbox"
            className={`btn btn-sm ${view === "conversations" ? "btn-primary" : "btn-secondary"}`}
          >
            Conversations
          </Link>
          <Link
            href="/growth/inbox?view=queue"
            className={`btn btn-sm ${view === "queue" ? "btn-primary" : "btn-secondary"}`}
          >
            Outreach queue ({queue.length})
          </Link>
        </div>
      </div>

      {view === "queue" ? (
        queue.length === 0 ? (
          <div className="panel panel-block">
            <p className="empty-state">
              The queue is empty — draft messages from any prospect&apos;s page.
            </p>
          </div>
        ) : (
          <div style={{ display: "grid", gap: 12 }}>
            {queue.map((m) => {
              const p = prospects.get(m.prospect_id);
              const statusMeta = MESSAGE_STATUS_META[m.status as MessageStatus];
              const body = String(m.body ?? "");
              return (
                <div key={m.id} className="panel panel-block">
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", fontSize: 13 }}>
                    {p ? (
                      <Link href={`/growth/prospects/${p.id}`}>
                        <strong>{p.company}</strong>
                      </Link>
                    ) : (
                      <strong>Unknown prospect</strong>
                    )}
                    <span>{CHANNEL_META[m.channel as Channel]?.label}</span>
                    <span className={`badge ${statusMeta?.badge}`}>{statusMeta?.label}</span>
                    {m.scheduled_at && (
                      <span style={{ color: "var(--faint)" }}>scheduled {fmt(m.scheduled_at)}</span>
                    )}
                  </div>
                  {m.subject && <div style={{ fontWeight: 600, marginTop: 6 }}>{m.subject}</div>}
                  {/* Full bodies made the queue a wall of text at 20+ items —
                      a one-line preview scans; the full message is one tap.
                      FAILED messages stay fully expanded: they need reading
                      before a retry decision. A short draft shows in full too:
                      collapsing it behind a "…" that reveals identical text is
                      just a pointless extra tap. */}
                  {m.status === "failed" || body.length <= 130 ? (
                    <p style={{ whiteSpace: "pre-wrap", fontSize: 14, margin: "6px 0 10px" }}>{body}</p>
                  ) : (
                    <details style={{ margin: "6px 0 10px" }}>
                      <summary
                        style={{
                          cursor: "pointer",
                          fontSize: 13,
                          color: "var(--faint)",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          maxWidth: "72ch",
                        }}
                      >
                        {body.slice(0, 110)}…
                      </summary>
                      <p style={{ whiteSpace: "pre-wrap", fontSize: 14, margin: "8px 0 0" }}>{body}</p>
                    </details>
                  )}
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {m.channel === "email" ? (
                      <ActionForm action={sendQueuedEmail}>
                        <input type="hidden" name="message_id" value={m.id} />
                        <SubmitButton className="btn btn-primary btn-sm" pendingText="Sending…">
                          Send email now
                        </SubmitButton>
                      </ActionForm>
                    ) : (
                      <>
                        <CopyButton text={m.body} label="Copy text" />
                        <ActionForm action={markMessageSent}>
                          <input type="hidden" name="message_id" value={m.id} />
                          <SubmitButton className="btn btn-primary btn-sm" pendingText="Saving…">
                            Mark as sent
                          </SubmitButton>
                        </ActionForm>
                      </>
                    )}
                    <ActionForm action={deleteMessage}>
                      <input type="hidden" name="message_id" value={m.id} />
                      <SubmitButton className="btn btn-ghost btn-sm" pendingText="…">
                        Delete
                      </SubmitButton>
                    </ActionForm>
                  </div>
                </div>
              );
            })}
          </div>
        )
      ) : conversations.length === 0 ? (
        <div className="panel panel-block">
          <p className="empty-state">
            No replies yet — when a prospect emails back (or you log a DM
            reply from their page), the conversation lands here. Your sent and
            queued outreach is under{" "}
            <Link href="/growth/inbox?view=queue">Outreach queue</Link>.
          </p>
        </div>
      ) : (
        <div className="grid-main-side">
          <div>
            {selected && (
              <>
                <section className="panel panel-block" aria-label="Conversation thread">
                  <h2 className="panel-title">
                    {selected.company}
                    <Link href={`/growth/prospects/${selected.id}`}>Open prospect →</Link>
                  </h2>
                  <div style={{ display: "grid", gap: 10 }}>
                    {[...selectedThread].reverse().map((m) => (
                      <div
                        key={m.id}
                        className="panel"
                        style={{
                          padding: "12px 14px",
                          borderLeft:
                            m.direction === "inbound"
                              ? "3px solid var(--green, #34d399)"
                              : "3px solid var(--ac2, #3b82f6)",
                        }}
                      >
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", fontSize: 12, color: "var(--faint)", alignItems: "center" }}>
                          <strong style={{ color: "var(--text, #eee)" }}>
                            {m.direction === "inbound"
                              ? selected.contact_name || selected.company || "Them"
                              : "AutomateIQ"}
                          </strong>
                          <span>{CHANNEL_META[m.channel as Channel]?.label}</span>
                          <span className={`badge ${MESSAGE_STATUS_META[m.status as MessageStatus]?.badge}`}>
                            {MESSAGE_STATUS_META[m.status as MessageStatus]?.label}
                          </span>
                          {m.sentiment && (
                            <span className={`badge ${SENTIMENT_META[m.sentiment as Sentiment]?.badge ?? "badge-gray"}`}>
                              {SENTIMENT_META[m.sentiment as Sentiment]?.label ?? m.sentiment}
                            </span>
                          )}
                          <span>{stampLabel(m)}</span>
                        </div>
                        {m.subject && <div style={{ fontWeight: 600, marginTop: 6 }}>{m.subject}</div>}
                        <p style={{ whiteSpace: "pre-wrap", margin: "6px 0 0", fontSize: 14 }}>{m.body}</p>
                      </div>
                    ))}
                  </div>
                </section>

                <section className="panel panel-block" style={{ marginTop: 16 }} aria-label="Reply">
                  <h2 className="panel-title">Respond</h2>
                  <MessageComposer
                    prospectId={selected.id}
                    prospectEmail={selected.email}
                    defaultChannel={(lastInbound?.channel as Channel) ?? "email"}
                    defaultObjective={lastInbound ? "reply" : "follow_up"}
                    replyContext={lastInbound?.body}
                    templates={templates}
                  />
                </section>

                {/* Sits beside "Respond" rather than under the conversation
                    list: both are ways of recording the same exchange, and on
                    a phone it belongs after the thread you're reading, not
                    wedged between the list and the conversation. */}
                <section className="panel panel-block" style={{ marginTop: 16 }} aria-label="Log a reply">
                  <h2 className="panel-title">Log their reply</h2>
                  <p style={{ fontSize: 12, color: "var(--faint)", marginTop: 0 }}>
                    Got a reply in LinkedIn, Instagram, email or by text? Paste it
                    here so the record and analytics stay accurate.
                  </p>
                  <ActionForm action={logInboundMessage}>
                    <input type="hidden" name="prospect_id" value={selected.id} />
                    <label htmlFor="li-channel">Channel</label>
                    <select id="li-channel" name="channel" defaultValue={lastInbound?.channel ?? "email"}>
                      {CHANNELS.map((ch) => (
                        <option key={ch} value={ch}>
                          {CHANNEL_META[ch].label}
                        </option>
                      ))}
                    </select>
                    <label htmlFor="li-sentiment">Sentiment</label>
                    <select id="li-sentiment" name="sentiment" defaultValue="neutral">
                      <option value="positive">Positive</option>
                      <option value="neutral">Neutral</option>
                      <option value="negative">Negative</option>
                    </select>
                    <label htmlFor="li-body">Their message</label>
                    <textarea id="li-body" name="body" rows={4} required maxLength={10000} />
                    <div className="form-actions">
                      <SubmitButton className="btn btn-secondary btn-sm" pendingText="Logging…">
                        Log reply
                      </SubmitButton>
                    </div>
                  </ActionForm>
                </section>
              </>
            )}
          </div>

          {/* Hoisted above the thread on phones (see .inbox-side in
              globals.css): stacked in DOM order, the whole selected thread AND
              the composer came first, so you scrolled past an entire
              conversation before discovering there were others waiting. */}
          <div className="inbox-side">
            <section className="panel panel-block" aria-label="Conversations">
              <h2 className="panel-title">Conversations</h2>
              <div style={{ display: "grid", gap: 6 }}>
                {conversations.map((c) => {
                  const p = prospects.get(c.pid)!;
                  const active = c.pid === selectedId;
                  return (
                    <Link
                      key={c.pid}
                      href={`/growth/inbox?p=${c.pid}`}
                      className="panel"
                      style={{
                        padding: "10px 12px",
                        display: "block",
                        border: active ? "1px solid var(--ac2, #3b82f6)" : undefined,
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                        <strong style={{ fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.company}</strong>
                        <span style={{ display: "flex", gap: 6, alignItems: "center", flexShrink: 0 }}>
                          {c.awaitingUs && <span className="badge badge-orange">Reply due</span>}
                          <span style={{ fontSize: 11, color: "var(--faint)" }}>{relTime(c.latestReal.created_at)}</span>
                        </span>
                      </div>
                      {/* Preview the last message actually exchanged — an
                          unsent auto-draft would read as "You: …" for a reply
                          that never went out. */}
                      <div style={{ fontSize: 12, color: "var(--faint)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {c.latestReal.direction === "outbound" && (
                          <span style={{ color: "var(--ac2, #3b82f6)" }}>You: </span>
                        )}
                        {c.latestReal.body}
                      </div>
                    </Link>
                  );
                })}
              </div>
            </section>
          </div>
        </div>
      )}
    </>
  );
}
