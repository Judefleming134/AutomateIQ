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

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ p?: string; view?: string }>;
}) {
  await requireGrowth();
  const params = await searchParams;
  const admin = createAdminClient();
  const view = params.view === "queue" ? "queue" : "conversations";

  const { data: allMessages } = await admin
    .from("ge_messages")
    .select(
      "id, prospect_id, channel, direction, status, subject, body, sentiment, scheduled_at, sent_at, created_at"
    )
    .order("created_at", { ascending: false })
    .limit(1000);

  const messages = allMessages ?? [];
  const prospectIds = [...new Set(messages.map((m) => m.prospect_id))];
  const { data: prospectsRaw } = prospectIds.length
    ? await admin
        .from("ge_prospects")
        .select("id, company, contact_name, email, status, campaign_id, industry, location, notes, linkedin_url, instagram_url, phone")
        .in("id", prospectIds)
    : { data: [] as never[] };
  const prospects = new Map((prospectsRaw ?? []).map((p) => [p.id, p]));

  // Conversations: newest message per prospect, unanswered replies first.
  const conversations = prospectIds
    .map((pid) => {
      const thread = messages.filter((m) => m.prospect_id === pid);
      const latest = thread[0];
      const awaitingUs = latest?.direction === "inbound";
      return { pid, thread, latest, awaitingUs };
    })
    .filter((c) => prospects.has(c.pid))
    .sort((a, b) => {
      if (a.awaitingUs !== b.awaitingUs) return a.awaitingUs ? -1 : 1;
      return a.latest.created_at < b.latest.created_at ? 1 : -1;
    });

  const selectedId =
    params.p && prospects.has(params.p) ? params.p : conversations[0]?.pid ?? null;
  const selected = selectedId ? prospects.get(selectedId) : null;
  const selectedThread = selectedId
    ? messages.filter((m) => m.prospect_id === selectedId)
    : [];
  const lastInbound = selectedThread.find((m) => m.direction === "inbound");

  const queue = messages.filter(
    (m) => m.direction === "outbound" && ["draft", "queued", "failed"].includes(m.status)
  );

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
            Every message across LinkedIn, Instagram, email and SMS in one
            place — replies waiting on you come first.
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
                  <p style={{ whiteSpace: "pre-wrap", fontSize: 14, margin: "6px 0 10px" }}>{m.body}</p>
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
            No conversations yet — send your first outreach from a prospect&apos;s
            page and it will appear here.
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
                            {m.direction === "inbound" ? selected.contact_name : "AutomateIQ"}
                          </strong>
                          <span>{CHANNEL_META[m.channel as Channel]?.label}</span>
                          <span className={`badge ${MESSAGE_STATUS_META[m.status as MessageStatus]?.badge}`}>
                            {MESSAGE_STATUS_META[m.status as MessageStatus]?.label}
                          </span>
                          {m.sentiment && (
                            <span className={`badge ${SENTIMENT_META[m.sentiment as Sentiment].badge}`}>
                              {SENTIMENT_META[m.sentiment as Sentiment].label}
                            </span>
                          )}
                          <span>{fmt(m.sent_at ?? m.created_at)}</span>
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
              </>
            )}
          </div>

          <div>
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
                        <strong style={{ fontSize: 14 }}>{p.company}</strong>
                        {c.awaitingUs && <span className="badge badge-orange">Reply due</span>}
                      </div>
                      <div style={{ fontSize: 12, color: "var(--faint)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {c.latest.body}
                      </div>
                    </Link>
                  );
                })}
              </div>
            </section>

            {selected && (
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
            )}
          </div>
        </div>
      )}
    </>
  );
}
