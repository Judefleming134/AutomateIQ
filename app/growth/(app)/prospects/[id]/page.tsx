import Link from "next/link";
import { notFound } from "next/navigation";
import { requireGrowth, loadGrowthSettings } from "@/lib/growth/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { ActionForm } from "@/components/admin/action-form";
import { SubmitButton } from "@/components/admin/submit-button";
import { CopyButton } from "@/components/portal/copy-button";
import { MessageComposer, type ComposerTemplate } from "@/components/growth/message-composer";
import { CRITERIA } from "@/lib/growth/scoring";
import {
  PROSPECT_STATUSES,
  PROSPECT_STATUS_META,
  QUALIFICATION_META,
  MESSAGE_STATUS_META,
  MEETING_STATUS_META,
  CHANNEL_META,
  SENTIMENT_META,
  fillTemplate,
  type ProspectStatus,
  type QualificationStatus,
  type Channel,
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
} from "../actions";

function fmt(ts: string | null | undefined): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleString("en-IE", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Dublin",
  });
}

export default async function ProspectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { member } = await requireGrowth();
  const { id } = await params;
  const admin = createAdminClient();

  const { data: prospect } = await admin
    .from("ge_prospects")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!prospect) notFound();

  const [
    { data: activities },
    { data: messages },
    { data: tasks },
    { data: meetings },
    { data: templatesRaw },
    { data: campaigns },
    settings,
  ] = await Promise.all([
    admin
      .from("ge_activities")
      .select("id, type, content, created_at")
      .eq("prospect_id", id)
      .order("created_at", { ascending: false })
      .limit(100),
    admin
      .from("ge_messages")
      .select("id, channel, direction, status, subject, body, sentiment, sent_at, created_at")
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
      .select("id, scheduled_at, status, notes")
      .eq("prospect_id", id)
      .order("scheduled_at", { ascending: false }),
    admin
      .from("ge_templates")
      .select("id, name, channel, subject, body")
      .order("name"),
    admin.from("ge_campaigns").select("id, name").order("name"),
    loadGrowthSettings(),
  ]);

  const statusMeta = PROSPECT_STATUS_META[prospect.status as ProspectStatus];
  const qualMeta =
    QUALIFICATION_META[prospect.qualification_status as QualificationStatus];
  const lastInbound = (messages ?? []).find((m) => m.direction === "inbound");
  const openTasks = (tasks ?? []).filter((t) => t.status === "open");

  const templates: ComposerTemplate[] = (templatesRaw ?? []).map((t) => ({
    id: t.id,
    name: t.name,
    channel: t.channel as Channel,
    subject: t.subject ? fillTemplate(t.subject, prospect, settings.bookingUrl) : null,
    body: fillTemplate(t.body, prospect, settings.bookingUrl),
  }));

  const defaultChannel: Channel = prospect.email
    ? "email"
    : prospect.linkedin_url
      ? "linkedin"
      : prospect.instagram_url
        ? "instagram"
        : prospect.phone
          ? "sms"
          : "email";

  return (
    <>
      <div className="page-header">
        <div>
          <p style={{ margin: 0 }}>
            <Link href="/growth/prospects">← Prospects</Link>
          </p>
          <h1 style={{ marginTop: 4 }}>{prospect.company}</h1>
          <p>
            {prospect.contact_name}
            {prospect.job_title ? ` · ${prospect.job_title}` : ""}
            {prospect.location ? ` · ${prospect.location}` : ""}
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

      <ActionForm
        action={setProspectStatus}
        className="panel panel-block"
        style={{ display: "flex", gap: 10, alignItems: "end", flexWrap: "wrap", marginBottom: 16 }}
      >
        <input type="hidden" name="id" value={prospect.id} />
        <div>
          <label htmlFor="ps-status" style={{ fontSize: 12, color: "var(--faint)" }}>
            Pipeline status
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
          Update status
        </SubmitButton>
      </ActionForm>

      <div className="grid-main-side">
        <div>
          <section className="panel panel-block" aria-labelledby="composer-title">
            <h2 className="panel-title" id="composer-title">
              AI message generator
            </h2>
            <MessageComposer
              prospectId={prospect.id}
              prospectEmail={prospect.email}
              defaultChannel={defaultChannel}
              defaultObjective={lastInbound ? "reply" : "initial"}
              replyContext={lastInbound?.body}
              templates={templates}
            />
          </section>

          <section className="panel panel-block" style={{ marginTop: 16 }} aria-labelledby="timeline-title">
            <h2 className="panel-title" id="timeline-title">
              Conversation &amp; activity
            </h2>

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
                          <span
                            className={`badge ${MESSAGE_STATUS_META[entry.m.status as MessageStatus]?.badge ?? "badge-gray"}`}
                          >
                            {MESSAGE_STATUS_META[entry.m.status as MessageStatus]?.label ?? entry.m.status}
                          </span>
                          {entry.m.sentiment && (
                            <span className={`badge ${SENTIMENT_META[entry.m.sentiment as Sentiment].badge}`}>
                              {SENTIMENT_META[entry.m.sentiment as Sentiment].label}
                            </span>
                          )}
                          <span>{fmt(entry.m.sent_at ?? entry.m.created_at)}</span>
                        </div>
                        {entry.m.subject && (
                          <div style={{ fontWeight: 600, marginTop: 6 }}>{entry.m.subject}</div>
                        )}
                        <p style={{ whiteSpace: "pre-wrap", margin: "6px 0 0", fontSize: 14 }}>
                          {entry.m.body}
                        </p>
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
        </div>

        <div>
          <section className="panel panel-block" aria-labelledby="booking-title">
            <h2 className="panel-title" id="booking-title">
              Book a Strategy Session
            </h2>
            <p style={{ fontSize: 13, color: "var(--faint)", marginTop: 0 }}>
              When they&apos;re ready, send the booking link — the{" "}
              <em>Meeting confirmation</em> objective drafts it for you. Booked
              sessions appear in Meetings after a sync.
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
                    {fmt(mt.scheduled_at)}
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="panel panel-block" style={{ marginTop: 16 }} aria-labelledby="qual-title">
            <h2 className="panel-title" id="qual-title">
              Lead qualification
            </h2>
            <ActionForm action={qualifyProspect}>
              <input type="hidden" name="id" value={prospect.id} />
              {CRITERIA.map((c) => (
                <div key={c.key} style={{ marginBottom: 8 }}>
                  <label htmlFor={`q-${c.key}`} style={{ fontSize: 12, color: "var(--faint)" }}>
                    {c.label}
                  </label>
                  <select
                    id={`q-${c.key}`}
                    name={c.key}
                    defaultValue={String(prospect[c.key] ?? 0)}
                    style={{ width: "100%" }}
                  >
                    {c.options.map((label, value) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
              <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, margin: "10px 0" }}>
                <input
                  type="checkbox"
                  name="disqualified"
                  defaultChecked={prospect.qualification_status === "disqualified"}
                />
                Manually disqualify (overrides the score)
              </label>
              <SubmitButton className="btn btn-secondary btn-sm" pendingText="Scoring…">
                Save &amp; rescore
              </SubmitButton>
            </ActionForm>
          </section>

          <section className="panel panel-block" style={{ marginTop: 16 }} aria-labelledby="tasks-title">
            <h2 className="panel-title" id="tasks-title">
              Tasks &amp; follow-ups
            </h2>
            {openTasks.length === 0 ? (
              <p className="empty-state">No open tasks.</p>
            ) : (
              openTasks.map((t) => (
                <div
                  key={t.id}
                  style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "space-between", marginBottom: 8, fontSize: 13 }}
                >
                  <span>
                    {t.title}
                    {t.due_at ? (
                      <span style={{ color: "var(--faint)" }}> · due {t.due_at}</span>
                    ) : null}
                  </span>
                  <ActionForm action={completeTask}>
                    <input type="hidden" name="task_id" value={t.id} />
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
                <input
                  name="title"
                  placeholder="New task…"
                  required
                  maxLength={300}
                  style={{ flex: "1 1 140px" }}
                  aria-label="Task title"
                />
                <input type="date" name="due_at" aria-label="Due date" />
                <SubmitButton className="btn btn-secondary btn-sm" pendingText="Adding…">
                  Add
                </SubmitButton>
              </div>
            </ActionForm>
          </section>

          <details className="panel panel-block" style={{ marginTop: 16 }}>
            <summary style={{ cursor: "pointer", fontWeight: 600 }}>Edit profile</summary>
            <ActionForm action={updateProspect} style={{ marginTop: 12 }}>
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
              <label htmlFor="ep-campaign">Campaign</label>
              <select id="ep-campaign" name="campaign_id" defaultValue={prospect.campaign_id ?? ""}>
                <option value="">No campaign</option>
                {(campaigns ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
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
            {member.role === "owner" && (
              <ActionForm action={deleteProspect} style={{ marginTop: 14 }}>
                <input type="hidden" name="id" value={prospect.id} />
                <SubmitButton className="btn btn-danger btn-sm" pendingText="Deleting…">
                  Delete prospect
                </SubmitButton>
              </ActionForm>
            )}
          </details>
        </div>
      </div>
    </>
  );
}
