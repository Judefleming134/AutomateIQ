import { requireGrowth, loadGrowthSettings } from "@/lib/growth/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { ActionForm } from "@/components/admin/action-form";
import { SubmitButton } from "@/components/admin/submit-button";
import { CHANNELS, CHANNEL_META, OBJECTIVE_META, type MessageObjective } from "@/lib/growth/constants";
import { SOLUTION_CATALOG } from "@/lib/growth/solutions";
import { formatPrice } from "@/lib/growth/pricing";
import {
  saveGrowthSettings,
  saveTemplate,
  deleteTemplate,
  addTeamMember,
  setMemberStatus,
  removeTeamMember,
} from "./actions";

const CATEGORY_OPTIONS: { value: MessageObjective; label: string }[] = (
  Object.entries(OBJECTIVE_META) as [MessageObjective, { label: string }][]
).map(([value, meta]) => ({ value, label: meta.label }));

export default async function GrowthSettingsPage() {
  const { member } = await requireGrowth();
  const isOwner = member.role === "owner";
  const admin = createAdminClient();

  // Reflect the REAL failover chain (lib/ai/complete.ts): Claude is preferred,
  // but on an account-level failure — most commonly Anthropic credit running
  // out — it automatically falls back to Gemini. The status must say this, or a
  // green "Claude, full speed" badge hides the fact that a credit run-out
  // silently drops research onto Gemini's daily-capped free tier.
  const hasAnthropic = Boolean(process.env.ANTHROPIC_API_KEY);
  const hasGemini = Boolean(process.env.GEMINI_API_KEY);
  const ai = hasAnthropic
    ? hasGemini
      ? { label: "Claude + Gemini fallback", badge: "badge-green",
          note: "Runs on Claude (Anthropic) at full speed. If Anthropic credit runs out it automatically falls back to Gemini's free tier (daily cap, resets 8am Irish) so research never fully stops — top up Anthropic to stay at full speed." }
      : { label: "Claude (Anthropic)", badge: "badge-green",
          note: "Runs on Claude at full speed — no daily quota. No fallback configured: if Anthropic credit runs out, research and drafting PAUSE. Add a GEMINI_API_KEY in Vercel as a free backup." }
    : hasGemini
      ? { label: "Gemini (free tier)", badge: "badge-orange",
          note: "Free tier has a daily request cap that resets 8am Irish time. Add an ANTHROPIC_API_KEY in Vercel to run at full speed (Gemini stays as the automatic fallback)." }
      : { label: "Not connected", badge: "badge-red",
          note: "Add an ANTHROPIC_API_KEY (or GEMINI_API_KEY) in Vercel to enable research and drafting." };

  const [settings, { data: templates }, { data: team }] = await Promise.all([
    loadGrowthSettings(),
    admin
      .from("ge_templates")
      .select("id, name, channel, category, subject, body")
      .order("name"),
    admin
      .from("ge_team_members")
      .select("id, name, email, role, status, created_at")
      .order("created_at"),
  ]);

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Settings</h1>
          <p>Booking link, qualification rules, message templates and the team.</p>
        </div>
      </div>

      <div className="grid-2">
        <section className="panel panel-block" aria-labelledby="st-general">
          <h2 className="panel-title" id="st-general">
            Booking &amp; qualification rules
          </h2>
          <ActionForm action={saveGrowthSettings}>
            <label htmlFor="st-booking">Booking page URL</label>
            <input
              id="st-booking"
              name="booking_url"
              defaultValue={settings.bookingUrl}
              required
              maxLength={500}
              disabled={!isOwner}
            />
            <p style={{ fontSize: 12, color: "var(--faint)", margin: "4px 0 10px" }}>
              Where prospects book their AI Strategy Session — used in AI
              drafts, templates and the meetings sync.
            </p>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <div>
                <label htmlFor="st-qualify">Qualified at score ≥</label>
                <input
                  id="st-qualify"
                  name="qualify_threshold"
                  type="number"
                  min={1}
                  max={100}
                  defaultValue={settings.qualifyThreshold}
                  required
                  disabled={!isOwner}
                />
              </div>
              <div>
                <label htmlFor="st-review">In review at score ≥</label>
                <input
                  id="st-review"
                  name="review_threshold"
                  type="number"
                  min={0}
                  max={99}
                  defaultValue={settings.reviewThreshold}
                  required
                  disabled={!isOwner}
                />
              </div>
            </div>
            {isOwner ? (
              <div className="form-actions">
                <SubmitButton pendingText="Saving…">Save settings</SubmitButton>
              </div>
            ) : (
              <p style={{ fontSize: 12, color: "var(--faint)" }}>
                Only owners can change these settings.
              </p>
            )}
          </ActionForm>
        </section>

        <section className="panel panel-block" aria-labelledby="st-integrations">
          <h2 className="panel-title" id="st-integrations">
            Channel integrations
          </h2>
          <div style={{ display: "grid", gap: 10, fontSize: 13 }}>
            <div>
              <strong>AI engine</strong> — <span className={`badge ${ai.badge}`}>{ai.label}</span>
              <p style={{ color: "var(--faint)", margin: "4px 0 0" }}>{ai.note}</p>
            </div>
            <div>
              <strong>Email</strong> — <span className="badge badge-green">Connected</span>
              <p style={{ color: "var(--faint)", margin: "4px 0 0" }}>
                Sends directly through Resend from the platform&apos;s verified
                automateiq.ie address. Queue, schedule and one-click send.
              </p>
            </div>
            <div>
              <strong>LinkedIn, Instagram &amp; Facebook</strong> —{" "}
              <span className="badge badge-orange">Assisted</span>
              <p style={{ color: "var(--faint)", margin: "4px 0 0" }}>
                None of these platforms offers an approved API for cold DMs,
                and unofficial automation risks account bans — so the Growth
                Engine drafts the message, you copy-send it in the app, then
                mark it sent. Tracking and analytics stay complete.
              </p>
            </div>
            <div>
              <strong>SMS &amp; phone calls</strong> —{" "}
              <span className="badge badge-orange">Assisted</span>
              <p style={{ color: "var(--faint)", margin: "4px 0 0" }}>
                SMS drafts are sized for texting; the call channel generates a
                full call script (opener, the ask, objection responses,
                voicemail version) from the research. Send/dial from your
                phone, then mark it sent so the CRM tracks it.
              </p>
            </div>
            <div>
              <strong>Reply auto-capture</strong> —{" "}
              {process.env.INBOUND_EMAIL_SECRET ? (
                <span className="badge badge-green">Connected</span>
              ) : (
                <span className="badge badge-orange">One step left</span>
              )}
              <p style={{ color: "var(--faint)", margin: "4px 0 0" }}>
                {process.env.INBOUND_EMAIL_SECRET ? (
                  <>
                    Prospect replies forwarded to the webhook land straight in
                    the inbox: status flips to Replied, chases stop, and a
                    suggested response is drafted — no manual logging.
                  </>
                ) : (
                  <>
                    The last unwired piece of full-auto: right now email
                    replies only reach the CRM when you paste them in via
                    &quot;Log their reply&quot;. To automate it — 1) add an{" "}
                    <code style={{ fontSize: 12 }}>INBOUND_EMAIL_SECRET</code>{" "}
                    env var in Vercel (any long random string) and redeploy;
                    2) create a free Zapier/Make flow &quot;new email in
                    inbox → webhook POST&quot; to{" "}
                    <code style={{ fontSize: 12, wordBreak: "break-all" }}>
                      automateiq.ie/api/webhooks/inbound-email?secret=YOUR-SECRET
                    </code>{" "}
                    sending JSON{" "}
                    <code style={{ fontSize: 12 }}>
                      {"{from, subject, text}"}
                    </code>
                    . Until then, keep logging replies by hand — everything
                    else stays automatic.
                  </>
                )}
              </p>
            </div>
            <div>
              <strong>Booking page</strong> — <span className="badge badge-green">Connected</span>
              <p style={{ color: "var(--faint)", margin: "4px 0 0" }}>
                The public AI Strategy Session calendar handles slots,
                confirmations and owner alerts; the meetings sync links
                bookings back to prospects by email.
              </p>
            </div>
          </div>
        </section>
      </div>

      <section className="panel panel-block" style={{ marginTop: 20 }} aria-labelledby="st-pricing">
        <h2 className="panel-title" id="st-pricing">
          Price book — founding-customer rates (first 10 customers only)
        </h2>
        <p style={{ fontSize: 13, color: "var(--faint)", marginTop: 0 }}>
          The single source of every figure the engine shows or writes:
          recommendation cards, proposals, and any &quot;how much?&quot;
          answer the AI drafts. The AI can never invent a price — it only
          quotes this table. To change the numbers, ask Claude (they live in
          one file: <code style={{ fontSize: 12 }}>lib/growth/pricing.ts</code>).
        </p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Solution</th>
                <th>Founding rate</th>
              </tr>
            </thead>
            <tbody>
              {SOLUTION_CATALOG.filter((s) => formatPrice(s.key)).map((s) => (
                <tr key={s.key}>
                  <td>{s.name}</td>
                  <td style={{ whiteSpace: "nowrap" }}>{formatPrice(s.key)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel panel-block" style={{ marginTop: 20 }} aria-labelledby="st-templates">
        <h2 className="panel-title" id="st-templates">
          Message templates
        </h2>
        <p style={{ fontSize: 13, color: "var(--faint)", marginTop: 0 }}>
          Available in every composer. Placeholders:{" "}
          <code style={{ fontSize: 12 }}>
            {"{{first_name}} {{contact_name}} {{company}} {{industry}} {{location}} {{booking_url}}"}
          </code>
        </p>

        {(templates ?? []).map((t) => (
          <details key={t.id} className="panel" style={{ padding: "10px 14px", marginBottom: 8 }}>
            <summary style={{ cursor: "pointer" }}>
              <strong>{t.name}</strong>{" "}
              <span style={{ color: "var(--faint)", fontSize: 12 }}>
                {CHANNEL_META[t.channel as keyof typeof CHANNEL_META]?.label} ·{" "}
                {OBJECTIVE_META[t.category as MessageObjective]?.label ?? t.category}
              </span>
            </summary>
            <ActionForm action={saveTemplate} style={{ marginTop: 10 }}>
              <input type="hidden" name="template_id" value={t.id} />
              <label htmlFor={`tp-name-${t.id}`}>Name</label>
              <input id={`tp-name-${t.id}`} name="name" defaultValue={t.name} required maxLength={200} />
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <div>
                  <label htmlFor={`tp-channel-${t.id}`}>Channel</label>
                  <select id={`tp-channel-${t.id}`} name="channel" defaultValue={t.channel}>
                    {CHANNELS.map((c) => (
                      <option key={c} value={c}>
                        {CHANNEL_META[c].label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor={`tp-category-${t.id}`}>Category</label>
                  <select id={`tp-category-${t.id}`} name="category" defaultValue={t.category}>
                    {CATEGORY_OPTIONS.map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <label htmlFor={`tp-subject-${t.id}`}>Subject (email only)</label>
              <input id={`tp-subject-${t.id}`} name="subject" defaultValue={t.subject ?? ""} maxLength={300} />
              <label htmlFor={`tp-body-${t.id}`}>Body</label>
              <textarea id={`tp-body-${t.id}`} name="body" rows={6} defaultValue={t.body} required maxLength={10000} />
              <div className="form-actions" style={{ display: "flex", gap: 8 }}>
                <SubmitButton className="btn btn-secondary btn-sm" pendingText="Saving…">
                  Save template
                </SubmitButton>
              </div>
            </ActionForm>
            <ActionForm
              action={deleteTemplate}
              style={{ marginTop: 8 }}
              confirmText={`Delete the template "${t.name}"? This can't be undone.`}
            >
              <input type="hidden" name="template_id" value={t.id} />
              <SubmitButton className="btn btn-danger btn-sm" pendingText="Deleting…">
                Delete
              </SubmitButton>
            </ActionForm>
          </details>
        ))}

        <details className="panel" style={{ padding: "10px 14px", marginTop: 12 }}>
          <summary style={{ cursor: "pointer", fontWeight: 600 }}>+ New template</summary>
          <ActionForm action={saveTemplate} style={{ marginTop: 10 }}>
            <label htmlFor="tp-new-name">Name</label>
            <input id="tp-new-name" name="name" required maxLength={200} />
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <div>
                <label htmlFor="tp-new-channel">Channel</label>
                <select id="tp-new-channel" name="channel" defaultValue="email">
                  {CHANNELS.map((c) => (
                    <option key={c} value={c}>
                      {CHANNEL_META[c].label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="tp-new-category">Category</label>
                <select id="tp-new-category" name="category" defaultValue="initial">
                  {CATEGORY_OPTIONS.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <label htmlFor="tp-new-subject">Subject (email only)</label>
            <input id="tp-new-subject" name="subject" maxLength={300} />
            <label htmlFor="tp-new-body">Body</label>
            <textarea id="tp-new-body" name="body" rows={6} required maxLength={10000} />
            <div className="form-actions">
              <SubmitButton pendingText="Creating…">Create template</SubmitButton>
            </div>
          </ActionForm>
        </details>
      </section>

      <section className="panel panel-block" style={{ marginTop: 20 }} aria-labelledby="st-team">
        <h2 className="panel-title" id="st-team">
          Team
        </h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Member</th>
                <th>Role</th>
                <th>Status</th>
                {isOwner && <th>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {(team ?? []).map((t) => (
                <tr key={t.id}>
                  <td>
                    <strong>{t.name}</strong>
                    <div style={{ color: "var(--faint)", fontSize: 12 }}>{t.email}</div>
                  </td>
                  <td>{t.role === "owner" ? "Owner" : "Member"}</td>
                  <td>
                    <span className={`badge ${t.status === "active" ? "badge-green" : "badge-red"}`}>
                      {t.status === "active" ? "Active" : "Suspended"}
                    </span>
                  </td>
                  {isOwner && (
                    <td>
                      {t.id !== member.id && (
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                          <ActionForm action={setMemberStatus}>
                            <input type="hidden" name="member_id" value={t.id} />
                            <input
                              type="hidden"
                              name="status"
                              value={t.status === "active" ? "suspended" : "active"}
                            />
                            <SubmitButton className="btn btn-secondary btn-sm" pendingText="…">
                              {t.status === "active" ? "Suspend" : "Reactivate"}
                            </SubmitButton>
                          </ActionForm>
                          <ActionForm
                            action={removeTeamMember}
                            confirmText={`Remove ${t.name} from the Growth Engine? They lose access immediately.`}
                          >
                            <input type="hidden" name="member_id" value={t.id} />
                            <SubmitButton className="btn btn-danger btn-sm" pendingText="…">
                              Remove
                            </SubmitButton>
                          </ActionForm>
                        </div>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {isOwner && (
          <details style={{ marginTop: 12 }}>
            <summary style={{ cursor: "pointer", fontWeight: 600 }}>+ Add a team member</summary>
            <ActionForm action={addTeamMember} style={{ marginTop: 10, maxWidth: 420 }}>
              <label htmlFor="tm-name">Name</label>
              <input id="tm-name" name="name" required maxLength={200} />
              <label htmlFor="tm-email">Email</label>
              <input id="tm-email" name="email" type="email" required maxLength={300} />
              <label htmlFor="tm-role">Role</label>
              <select id="tm-role" name="role" defaultValue="member">
                <option value="member">Member</option>
                <option value="owner">Owner</option>
              </select>
              <p style={{ fontSize: 12, color: "var(--faint)" }}>
                New people get an email invite to set a password; existing
                accounts just gain access. Growth accounts can never reach the
                customer portal or the platform admin console.
              </p>
              <div className="form-actions">
                <SubmitButton pendingText="Adding…">Add member</SubmitButton>
              </div>
            </ActionForm>
          </details>
        )}
      </section>
    </>
  );
}
