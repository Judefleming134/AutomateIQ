import { Zap, CalendarDays } from "lucide-react";
import { requireSession } from "@/lib/auth/require-session";
import { createClient } from "@/lib/supabase/server";
import { StatCard } from "@/components/portal/stat-card";
import { ActionForm } from "@/components/admin/action-form";
import { SubmitButton } from "@/components/admin/submit-button";
import {
  DEFAULT_STL_SUBJECT,
  DEFAULT_STL_TEMPLATE,
} from "@/lib/speed-to-lead/template";
import { updateSpeedToLeadSettings } from "./actions";

export default async function SpeedToLeadAgentPage() {
  const { profile } = await requireSession();
  const supabase = await createClient();

  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();

  // RLS-scoped; reads empty until manual_update_0007.sql is run.
  const [{ count: total }, { count: thisWeek }, { data: replies }, { data: settings }] =
    await Promise.all([
      supabase.from("stl_replies").select("id", { count: "exact", head: true }),
      supabase
        .from("stl_replies")
        .select("id", { count: "exact", head: true })
        .gte("created_at", weekAgo),
      supabase
        .from("stl_replies")
        .select("id, sent_to, created_at, wa_leads(name)")
        .order("created_at", { ascending: false })
        .limit(25),
      supabase
        .from("stl_settings")
        .select("enabled, subject, reply_template")
        .eq("business_id", profile.business_id!)
        .maybeSingle(),
    ]);

  const isOn = settings?.enabled !== false;

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Speed-to-Lead Agent</h1>
          <p>
            Every new website lead gets a personal reply within 60 seconds —
            while your competitors are still checking their inbox.
          </p>
        </div>
        <span
          className={`badge ${isOn ? "badge-green" : "badge-gray"}`}
          style={{ alignSelf: "center" }}
        >
          <Zap size={11} /> {isOn ? "Active" : "Paused"}
        </span>
      </div>

      <div className="stat-grid">
        <StatCard
          label="Instant replies sent"
          value={total ?? 0}
          icon={<Zap />}
          accent="#F59E0B"
          hint="all time"
        />
        <StatCard
          label="This week"
          value={thisWeek ?? 0}
          icon={<CalendarDays />}
          accent="#3B82F6"
          hint="last 7 days"
        />
      </div>

      <div className="grid-main-side">
        <div className="panel panel-block">
          <h2 className="panel-title">
            <span>
              <span className="sys-index">01 /</span>Reply log
            </span>
          </h2>
          {(replies ?? []).length === 0 ? (
            <p className="empty-state">
              No instant replies yet — the moment a lead with an email
              address arrives through your website, the reply goes out and
              shows up here.
            </p>
          ) : (
            <ul className="feed-list">
              {(replies ?? []).map((r) => {
                const lead = r.wa_leads as unknown as { name: string } | null;
                return (
                  <li key={r.id}>
                    <span
                      style={{
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      <span style={{ color: "var(--heading)", fontWeight: 600 }}>
                        {lead?.name ?? "Lead"}
                      </span>{" "}
                      <span style={{ color: "var(--faint)" }}>· {r.sent_to}</span>
                    </span>
                    <span className="feed-time">
                      {new Date(r.created_at).toLocaleDateString("en-IE", {
                        day: "numeric",
                        month: "short",
                      })}{" "}
                      {new Date(r.created_at).toLocaleTimeString("en-IE", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="panel panel-block">
          <h2 className="panel-title">
            <span>
              <span className="sys-index">02 /</span>How it works
            </span>
          </h2>
          <ol className="timeline">
            <li>
              <h3>Lead arrives</h3>
              <p>
                Someone fills in the enquiry form on your Website Agent page
                — any time, day or night.
              </p>
            </li>
            <li>
              <h3>Reply in under 60 seconds</h3>
              <p>
                If they left an email address, a warm, personal
                acknowledgment goes out instantly in your business&apos;s
                name.
              </p>
            </li>
            <li>
              <h3>You follow up</h3>
              <p>
                The lead lands in your Leads tab and CRM as usual — but now
                the customer already knows you&apos;re on it.
              </p>
            </li>
          </ol>
        </div>
      </div>

      <h2 className="section-title">Your instant reply</h2>
      <ActionForm action={updateSpeedToLeadSettings} className="panel form-card">
        <p style={{ margin: "0 0 12px", fontSize: 13, color: "var(--body)", maxWidth: "70ch" }}>
          This is the email every new lead receives within seconds. Use{" "}
          <code style={{ fontFamily: "var(--mono)", fontSize: 12 }}>{"{{name}}"}</code>{" "}
          for the lead&apos;s name and{" "}
          <code style={{ fontFamily: "var(--mono)", fontSize: 12 }}>{"{{business}}"}</code>{" "}
          for your business name — they&apos;re filled in automatically.
        </p>
        <div
          className="field"
          style={{ flexDirection: "row", alignItems: "center", gap: 10 }}
        >
          <input
            id="enabled"
            type="checkbox"
            name="enabled"
            defaultChecked={isOn}
            style={{ width: 16, height: 16 }}
          />
          <label htmlFor="enabled" style={{ margin: 0 }}>
            Send instant replies automatically
          </label>
        </div>
        <div className="field">
          <label htmlFor="subject">Subject line</label>
          <input
            id="subject"
            type="text"
            name="subject"
            defaultValue={settings?.subject ?? DEFAULT_STL_SUBJECT}
            required
          />
        </div>
        <div className="field">
          <label htmlFor="replyTemplate">Message</label>
          <textarea
            id="replyTemplate"
            name="replyTemplate"
            rows={10}
            defaultValue={settings?.reply_template ?? DEFAULT_STL_TEMPLATE}
            required
          />
        </div>
        <div className="form-actions">
          <SubmitButton pendingText="Saving…">Save reply</SubmitButton>
        </div>
      </ActionForm>
    </>
  );
}
