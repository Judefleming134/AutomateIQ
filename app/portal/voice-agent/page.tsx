import { Mic, Phone } from "lucide-react";
import { requireSession } from "@/lib/auth/require-session";
import { createClient } from "@/lib/supabase/server";
import { ActionForm } from "@/components/admin/action-form";
import { SubmitButton } from "@/components/admin/submit-button";
import { updateVoiceConfig, logVoiceTicket } from "./actions";

const STATUS_META: Record<string, { label: string; cls: string; blurb: string }> = {
  provisioning: {
    label: "Setting up",
    cls: "badge-blue",
    blurb: "We're connecting your number and building your agent. You'll get a text the moment it goes live.",
  },
  live: {
    label: "Live",
    cls: "badge-green",
    blurb: "Your receptionist is answering. Missed calls are picked up, jobs booked, and the details texted to you.",
  },
  paused: {
    label: "Paused",
    cls: "badge-gray",
    blurb: "Your receptionist is paused and not answering calls. Log a problem below or contact us to switch it back on.",
  },
};

const TICKET_STATUS: Record<string, { label: string; cls: string }> = {
  open: { label: "Open", cls: "badge-blue" },
  in_progress: { label: "In progress", cls: "badge-blue" },
  resolved: { label: "Resolved", cls: "badge-green" },
};

export default async function VoiceAgentPage() {
  const { profile } = await requireSession();
  const supabase = await createClient();

  const [{ data: config }, { data: tickets }] = await Promise.all([
    supabase
      .from("va_config")
      .select(
        "status, phone_number, greeting, services, business_hours, service_area, knowledge"
      )
      .eq("business_id", profile.business_id!)
      .maybeSingle(),
    supabase
      .from("va_tickets")
      .select("id, subject, detail, status, created_at")
      .eq("business_id", profile.business_id!)
      .order("created_at", { ascending: false })
      .limit(10),
  ]);

  const status = config?.status ?? "provisioning";
  const meta = STATUS_META[status] ?? STATUS_META.provisioning;

  return (
    <>
      <div className="page-header">
        <div>
          <h1>
            <Mic size={22} style={{ verticalAlign: "-3px", marginRight: 8 }} />
            Voice Agent
          </h1>
          <p>
            Your AI receptionist. See that it&apos;s live, keep what it says up
            to date, and log a problem any time.
          </p>
        </div>
      </div>

      {/* Status + number — the "is it live?" answer, first thing on the page. */}
      <div className="panel panel-block" style={{ marginBottom: 24 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <span className={`badge ${meta.cls}`}>{meta.label}</span>
          {config?.phone_number && (
            <a
              href={`tel:${config.phone_number.replace(/[^\d+]/g, "")}`}
              style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
            >
              <Phone size={15} />
              {config.phone_number}
            </a>
          )}
        </div>
        <p style={{ color: "var(--faint)", fontSize: 13, marginTop: 10 }}>
          {meta.blurb}
        </p>
      </div>

      <div className="grid-main-side">
        {/* Knowledge base — the only thing the customer edits. */}
        <ActionForm action={updateVoiceConfig} className="panel form-card">
          <h2 className="panel-title">What your receptionist knows</h2>
          <p style={{ color: "var(--faint)", fontSize: 13, marginBottom: 14 }}>
            Update these any time — changes apply to every call from then on.
          </p>
          <div className="field">
            <label htmlFor="greeting">Greeting (first line it says)</label>
            <input
              id="greeting"
              type="text"
              name="greeting"
              placeholder="Thanks for calling Castleknock Plumbing, how can I help?"
              defaultValue={config?.greeting ?? ""}
            />
          </div>
          <div className="field">
            <label htmlFor="services">Services you offer</label>
            <textarea
              id="services"
              name="services"
              rows={3}
              placeholder="Emergency callouts, boiler repair & servicing, leaks, bathroom installs…"
              defaultValue={config?.services ?? ""}
            />
          </div>
          <div className="field">
            <label htmlFor="businessHours">Business hours</label>
            <input
              id="businessHours"
              type="text"
              name="businessHours"
              placeholder="Mon–Fri 8am–6pm, emergency callouts 24/7"
              defaultValue={config?.business_hours ?? ""}
            />
          </div>
          <div className="field">
            <label htmlFor="serviceArea">Service area</label>
            <input
              id="serviceArea"
              type="text"
              name="serviceArea"
              placeholder="Castleknock, Blanchardstown & Dublin 15"
              defaultValue={config?.service_area ?? ""}
            />
          </div>
          <div className="field">
            <label htmlFor="knowledge">
              Anything else it should know (FAQs, pricing notes, what to say)
            </label>
            <textarea
              id="knowledge"
              name="knowledge"
              rows={6}
              placeholder="We don't quote exact prices over the phone — confirm on site. Ask for the address and the problem. If it's a gas leak, tell them to call Gas Networks on 1800 20 50 50 first."
              defaultValue={config?.knowledge ?? ""}
            />
          </div>
          <div className="form-actions">
            <SubmitButton pendingText="Saving…">Save changes</SubmitButton>
          </div>
        </ActionForm>

        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          {/* Log a problem */}
          <ActionForm action={logVoiceTicket} className="panel form-card">
            <h2 className="panel-title">Log a problem</h2>
            <p
              style={{ color: "var(--faint)", fontSize: 13, marginBottom: 14 }}
            >
              Something not right? Tell us and we&apos;ll get on it.
            </p>
            <div className="field">
              <label htmlFor="subject">What&apos;s wrong?</label>
              <input
                id="subject"
                type="text"
                name="subject"
                placeholder="Agent didn't answer a call this morning"
                required
              />
            </div>
            <div className="field">
              <label htmlFor="detail">More detail (optional)</label>
              <textarea
                id="detail"
                name="detail"
                rows={3}
                placeholder="Around 9:15am, caller said it rang out…"
              />
            </div>
            <div className="form-actions">
              <SubmitButton pendingText="Sending…">Log problem</SubmitButton>
            </div>
          </ActionForm>

          {/* Ticket history */}
          <div className="panel panel-block">
            <h2 className="panel-title">Your reported problems</h2>
            {tickets && tickets.length > 0 ? (
              <ul
                style={{
                  listStyle: "none",
                  margin: 0,
                  padding: 0,
                  display: "flex",
                  flexDirection: "column",
                  gap: 12,
                }}
              >
                {tickets.map((t) => {
                  const ts = TICKET_STATUS[t.status] ?? TICKET_STATUS.open;
                  return (
                    <li
                      key={t.id}
                      style={{
                        borderBottom: "1px solid var(--border)",
                        paddingBottom: 10,
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          gap: 8,
                          alignItems: "start",
                        }}
                      >
                        <strong style={{ fontSize: 14 }}>{t.subject}</strong>
                        <span className={`badge ${ts.cls}`}>{ts.label}</span>
                      </div>
                      {t.detail && (
                        <p
                          style={{
                            color: "var(--faint)",
                            fontSize: 13,
                            margin: "4px 0 0",
                          }}
                        >
                          {t.detail}
                        </p>
                      )}
                      <span style={{ color: "var(--faint)", fontSize: 12 }}>
                        {t.created_at.slice(0, 10)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p style={{ color: "var(--faint)", fontSize: 13 }}>
                No problems logged. If your receptionist ever slips up, tell us
                here.
              </p>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
