import Link from "next/link";
import { Instagram, MessageCircle, CalendarCheck, Sparkles, Link2 } from "lucide-react";
import { requireSession } from "@/lib/auth/require-session";
import { createClient } from "@/lib/supabase/server";
import { StatCard } from "@/components/portal/stat-card";
import { ActionForm } from "@/components/admin/action-form";
import { SubmitButton } from "@/components/admin/submit-button";
import { isMissingTableError } from "@/lib/db/errors";
import { updateInstagramSettings } from "./actions";
import { SetterSimulator } from "./interactive";

export default async function InstagramDmSetterPage() {
  const { profile } = await requireSession();
  const supabase = await createClient();

  const [
    { data: settings, error: settingsError },
    { count: convoCount },
    { count: messageCount },
    { data: conversations },
    { data: assistant },
  ] = await Promise.all([
    supabase
      .from("ig_settings")
      .select("ig_account_id, ig_username, connected, auto_reply, persona, greeting, booking_link")
      .eq("business_id", profile.business_id!)
      .maybeSingle(),
    supabase.from("ig_conversations").select("id", { count: "exact", head: true }),
    supabase.from("ig_messages").select("id", { count: "exact", head: true }),
    supabase
      .from("ig_conversations")
      .select("id, username, ig_user_id, status, last_message_at")
      .order("last_message_at", { ascending: false })
      .limit(12),
    supabase
      .from("aa_assistants")
      .select("business_id")
      .eq("business_id", profile.business_id!)
      .maybeSingle(),
  ]);

  const needsMigration = settingsError && isMissingTableError(settingsError);
  const isOn = settings?.auto_reply !== false;
  const hasKnowledge = Boolean(assistant);

  return (
    <>
      <div className="page-header">
        <div>
          <h1>SocialIQ</h1>
          <p>
            A specialist agent in your AI workforce — it engages Instagram DMs in your brand voice,
            using the same knowledge and booking system as your AssistIQ, and turns conversations
            into booked appointments.
          </p>
        </div>
        <span className={`badge ${isOn ? "badge-green" : "badge-gray"}`} style={{ alignSelf: "center" }}>
          <Instagram size={11} /> {isOn ? "Auto-reply on" : "Auto-reply off"}
        </span>
      </div>

      {needsMigration && (
        <div className="panel panel-block" style={{ marginBottom: 18 }}>
          <p className="empty-state">
            Database update required — run <code>supabase/manual_update_0011.sql</code> in the
            Supabase SQL Editor, then refresh this page.
          </p>
        </div>
      )}

      <div className="stat-grid">
        <StatCard label="Conversations" value={convoCount ?? 0} icon={<MessageCircle />} accent="#E1306C" hint="all time" />
        <StatCard label="Messages handled" value={messageCount ?? 0} icon={<Instagram />} accent="#8B5CF6" hint="both directions" />
        <StatCard
          label="Booked"
          value={(conversations ?? []).filter((c) => c.status === "booked").length}
          icon={<CalendarCheck />}
          accent="#34D399"
          hint="from Instagram"
        />
      </div>

      {!hasKnowledge && (
        <div className="panel panel-block" style={{ marginTop: 4 }}>
          <p className="empty-state" style={{ margin: 0 }}>
            <Sparkles size={14} style={{ verticalAlign: "-2px", marginRight: 6 }} />
            The setter answers from your AssistIQ&apos;s business knowledge. Add it in{" "}
            <Link href="/portal/ai-assistant" style={{ color: "var(--ac2)" }}>AssistIQ → Knowledge</Link>{" "}
            so replies are accurate and on-brand.
          </p>
        </div>
      )}

      <div className="grid-main-side">
        {/* Live tester */}
        <div className="panel panel-block">
          <h2 className="panel-title">
            <span><span className="sys-index">01 /</span>Try the setter</span>
          </h2>
          <SetterSimulator />
        </div>

        {/* How it works */}
        <div className="panel panel-block">
          <h2 className="panel-title">
            <span><span className="sys-index">02 /</span>How it works</span>
          </h2>
          <ol className="timeline">
            <li>
              <h3>A lead DMs your Instagram</h3>
              <p>The message arrives through the connected account, day or night.</p>
            </li>
            <li>
              <h3>The setter replies instantly</h3>
              <p>
                Using your AssistIQ&apos;s knowledge and tone, it answers questions and builds
                rapport — like another member of your team.
              </p>
            </li>
            <li>
              <h3>It books the appointment</h3>
              <p>
                When the lead&apos;s ready, it shares your booking link so they pick a time — and it
                all lands in your bookings and CRM.
              </p>
            </li>
          </ol>
        </div>
      </div>

      {/* Recent conversations */}
      <h2 className="section-title">Conversations</h2>
      <div className="panel panel-block">
        {(conversations ?? []).length === 0 ? (
          <p className="empty-state">
            No conversations yet — send a test message above, or connect your Instagram account
            below to start receiving real DMs.
          </p>
        ) : (
          <ul className="feed-list">
            {(conversations ?? []).map((c) => (
              <li key={c.id}>
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  <span style={{ color: "var(--heading)", fontWeight: 600 }}>
                    @{c.username ?? c.ig_user_id.replace(/^sim:/, "")}
                  </span>{" "}
                  <span className={`badge ${c.status === "booked" ? "badge-green" : "badge-gray"}`} style={{ marginLeft: 6 }}>
                    {c.status}
                  </span>
                </span>
                <span className="feed-time">
                  {new Date(c.last_message_at).toLocaleDateString("en-IE", { day: "numeric", month: "short" })}{" "}
                  {new Date(c.last_message_at).toLocaleTimeString("en-IE", { hour: "2-digit", minute: "2-digit" })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Settings / connection */}
      <h2 className="section-title">Setter settings &amp; Instagram connection</h2>
      <ActionForm action={updateInstagramSettings} className="panel form-card">
        <div
          className="field"
          style={{ flexDirection: "row", alignItems: "center", gap: 10 }}
        >
          <input id="autoReply" type="checkbox" name="autoReply" defaultChecked={isOn} style={{ width: 16, height: 16 }} />
          <label htmlFor="autoReply" style={{ margin: 0 }}>Reply to DMs automatically</label>
        </div>

        <div className="field">
          <label htmlFor="persona">Voice &amp; persona (optional)</label>
          <textarea
            id="persona"
            name="persona"
            rows={3}
            defaultValue={settings?.persona ?? ""}
            placeholder="e.g. Warm and upbeat, use first names, keep it casual. Always offer a free consultation."
          />
        </div>
        <div className="field">
          <label htmlFor="greeting">First-touch opener (optional)</label>
          <input
            id="greeting"
            type="text"
            name="greeting"
            defaultValue={settings?.greeting ?? ""}
            placeholder="Hey! Thanks for the message 👋 how can we help?"
          />
        </div>
        <div className="field">
          <label htmlFor="bookingLink">
            <Link2 size={13} style={{ verticalAlign: "-2px", marginRight: 5 }} />
            Booking link
          </label>
          <input
            id="bookingLink"
            type="url"
            name="bookingLink"
            defaultValue={settings?.booking_link ?? ""}
            placeholder="https://automateiq.ie/book — leave blank to use your default booking page"
          />
        </div>

        <hr style={{ border: "none", borderTop: "1px solid var(--line)", margin: "18px 0" }} />
        <p style={{ margin: "0 0 12px", fontSize: 13, color: "var(--body)", maxWidth: "70ch" }}>
          <strong style={{ color: "var(--heading)" }}>Connect Instagram</strong> — from your Meta
          Business / Instagram Graph API app, paste your Instagram account ID and a Page access
          token. Point the app&apos;s webhook to <code>/api/ig/webhook</code>. The setter then replies
          to real DMs automatically.
        </p>
        <div className="field">
          <label htmlFor="igUsername">Instagram username</label>
          <input id="igUsername" type="text" name="igUsername" defaultValue={settings?.ig_username ?? ""} placeholder="@yourbusiness" />
        </div>
        <div className="field">
          <label htmlFor="igAccountId">Instagram account ID</label>
          <input id="igAccountId" type="text" name="igAccountId" defaultValue={settings?.ig_account_id ?? ""} placeholder="17841400000000000" />
        </div>
        <div className="field">
          <label htmlFor="pageAccessToken">Page access token</label>
          <input id="pageAccessToken" type="password" name="pageAccessToken" placeholder={settings?.connected ? "•••••••• (saved — leave blank to keep)" : "Paste your Page access token"} />
        </div>

        <div className="form-actions">
          <SubmitButton pendingText="Saving…">Save settings</SubmitButton>
        </div>
      </ActionForm>
    </>
  );
}
