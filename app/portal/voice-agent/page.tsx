import {
  Mic,
  Phone,
  PhoneCall,
  ClipboardList,
  CalendarClock,
  MessageSquareText,
  Clock,
  ShieldCheck,
} from "lucide-react";
import { requireSession } from "@/lib/auth/require-session";
import { createClient } from "@/lib/supabase/server";
import { isMissingTableError } from "@/lib/db/errors";
import { ActionForm } from "@/components/admin/action-form";
import { SubmitButton } from "@/components/admin/submit-button";
import { StatCard } from "@/components/portal/stat-card";
import { DeleteJobButton } from "@/components/portal/delete-job-button";
import { updateVoiceConfig, logVoiceTicket } from "./actions";

const STATUS_META: Record<string, { label: string; cls: string; blurb: string }> = {
  provisioning: {
    label: "Setting up",
    cls: "badge-blue",
    blurb: "We're connecting your number and building your agent. We'll let you know the moment it goes live.",
  },
  live: {
    label: "Live",
    cls: "badge-green",
    blurb: "Your receptionist is answering. Missed calls are picked up, jobs booked, and the details sent straight to you.",
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

const URGENCY_CLS: Record<string, string> = {
  emergency: "badge-red",
  urgent: "badge-orange",
  high: "badge-orange",
  soon: "badge-blue",
  routine: "badge-gray",
  low: "badge-gray",
};

type VoiceJob = {
  id: string;
  caller_name: string;
  caller_phone: string;
  address: string;
  problem: string;
  urgency: string;
  booking_slot: string;
  summary: string;
  created_at: string;
};

/** Compact "2h ago" / "3 days ago" so the list reads like a live feed. */
function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  const mins = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-IE", { day: "numeric", month: "short" });
}

export default async function VoiceAgentPage() {
  const { profile } = await requireSession();
  const supabase = await createClient();
  const businessId = profile.business_id!;

  const [{ data: config, error: configError }, { data: tickets }, { data: business }] =
    await Promise.all([
      supabase
        .from("va_config")
        .select(
          "status, phone_number, greeting, services, business_hours, service_area, knowledge"
        )
        .eq("business_id", businessId)
        .maybeSingle(),
      supabase
        .from("va_tickets")
        .select("id, subject, detail, status, created_at")
        .eq("business_id", businessId)
        .order("created_at", { ascending: false })
        .limit(10),
      supabase.from("businesses").select("name").eq("id", businessId).maybeSingle(),
    ]);

  // Captured jobs. The headline numbers come from real COUNT queries (not the
  // length of a fetched page), so they stay correct no matter how many calls
  // the receptionist takes — a busy customer never sees a total frozen at the
  // page size. The feed itself is a bounded most-recent slice. Read through the
  // RLS-scoped session client (defence in depth — a customer can only ever see
  // their OWN jobs), and guarded so a not-yet-run migration degrades cleanly.
  const FEED_SIZE = 30;
  let jobs: VoiceJob[] = [];
  let totalJobs = 0;
  let jobsThisWeek = 0;
  let jobsToday = 0;
  try {
    const weekAgoIso = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const [recent, totalRes, weekRes, todayRes] = await Promise.all([
      supabase
        .from("va_jobs")
        .select(
          "id, caller_name, caller_phone, address, problem, urgency, booking_slot, summary, created_at"
        )
        .eq("business_id", businessId)
        .order("created_at", { ascending: false })
        .limit(FEED_SIZE),
      supabase.from("va_jobs").select("id", { count: "exact", head: true }).eq("business_id", businessId),
      supabase
        .from("va_jobs")
        .select("id", { count: "exact", head: true })
        .eq("business_id", businessId)
        .gte("created_at", weekAgoIso),
      supabase
        .from("va_jobs")
        .select("id", { count: "exact", head: true })
        .eq("business_id", businessId)
        .gte("created_at", dayStart.toISOString()),
    ]);
    if (!recent.error && recent.data) jobs = recent.data as VoiceJob[];
    totalJobs = totalRes.count ?? 0;
    jobsThisWeek = weekRes.count ?? 0;
    jobsToday = todayRes.count ?? 0;
  } catch {
    // Table not there yet — the rest of the page still works.
  }

  // The product can be enabled before manual_update_0019 has been run in the
  // Supabase SQL Editor. Degrade to a clear "being set up" state instead of
  // throwing a raw schema-cache error at the customer.
  if (isMissingTableError(configError)) {
    return (
      <>
        <div className="page-header">
          <div>
            <h1>
              <Mic size={22} style={{ verticalAlign: "-3px", marginRight: 8 }} />
              Voice Agent
            </h1>
            <p>Your AI receptionist.</p>
          </div>
        </div>
        <div className="panel panel-block">
          <span className="badge badge-blue">Setting up</span>
          <p style={{ color: "var(--faint)", fontSize: 13, marginTop: 10 }}>
            We&apos;re finishing your receptionist setup. This page will be ready
            shortly — no action needed from you.
          </p>
        </div>
      </>
    );
  }

  const status = config?.status ?? "provisioning";
  const meta = STATUS_META[status] ?? STATUS_META.provisioning;
  const bizName = business?.name?.trim() || "your business";

  const lastJob = jobs[0];

  return (
    <>
      <div className="page-header">
        <div>
          <h1>
            <Mic size={22} style={{ verticalAlign: "-3px", marginRight: 8 }} />
            Voice Agent
          </h1>
          <p>
            {bizName}&apos;s AI receptionist — answering every call, booking the
            job, and sending you the details the moment the caller hangs up.
          </p>
        </div>
      </div>

      {/* Status + number — the "is it live?" answer, first thing on the page. */}
      <div className="panel panel-block" style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
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
        <p style={{ color: "var(--faint)", fontSize: 13, marginTop: 10 }}>{meta.blurb}</p>
      </div>

      {/* Headline value — the jobs it's captured, at a glance. */}
      <div className="stat-grid" style={{ marginBottom: 20 }}>
        <StatCard
          label="Jobs captured"
          value={totalJobs}
          icon={<ClipboardList />}
          accent="#7C3AED"
          hint="all time"
        />
        <StatCard
          label="This week"
          value={jobsThisWeek}
          icon={<CalendarClock />}
          accent="#22D3EE"
          hint="last 7 days"
        />
        <StatCard
          label="Today"
          value={jobsToday}
          icon={<PhoneCall />}
          accent="#FB923C"
          hint="so far today"
        />
        <StatCard
          label="Last job"
          value={lastJob ? timeAgo(lastJob.created_at) : "—"}
          icon={<Clock />}
          accent="#34D399"
        />
      </div>

      {/* Jobs your receptionist booked — the centrepiece. */}
      <div className="panel panel-block" style={{ marginBottom: 20 }}>
        <h2 className="panel-title">
          <PhoneCall size={15} style={{ verticalAlign: "-2px", marginRight: 6 }} />
          Jobs your receptionist booked
        </h2>
        {jobs.length === 0 ? (
          <div
            style={{
              border: "1px dashed var(--border)",
              borderRadius: 10,
              padding: "22px 18px",
              textAlign: "center",
            }}
          >
            <p style={{ margin: 0, fontSize: 14 }}>
              As soon as your receptionist takes its first call, the job appears
              here — and lands in your inbox at the same time.
            </p>
            <p style={{ margin: "6px 0 0", color: "var(--faint)", fontSize: 13 }}>
              Every enquiry captured, nothing lost to a missed call.
            </p>
          </div>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {jobs.map((j) => {
              const uKey = j.urgency.trim().toLowerCase();
              const uCls = URGENCY_CLS[uKey] ?? "badge-gray";
              return (
                <div
                  key={j.id}
                  className="panel"
                  style={{ padding: "12px 14px", borderLeft: "3px solid var(--ac2, #3b82f6)" }}
                >
                  <div
                    style={{
                      display: "flex",
                      gap: 8,
                      flexWrap: "wrap",
                      alignItems: "center",
                      fontSize: 12,
                      color: "var(--faint)",
                    }}
                  >
                    <strong style={{ color: "var(--text, #eee)", fontSize: 14 }}>
                      {j.caller_name || "Caller"}
                    </strong>
                    {j.urgency.trim() && <span className={`badge ${uCls}`}>{j.urgency}</span>}
                    {j.caller_phone.trim() && (
                      <a
                        href={`tel:${j.caller_phone.replace(/[^\d+]/g, "")}`}
                        style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
                      >
                        <Phone size={12} /> {j.caller_phone}
                      </a>
                    )}
                    <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 8 }}>
                      {timeAgo(j.created_at)}
                      <DeleteJobButton jobId={j.id} />
                    </span>
                  </div>
                  {j.problem.trim() && (
                    <p style={{ margin: "6px 0 0", fontSize: 14 }}>{j.problem}</p>
                  )}
                  <div
                    style={{
                      display: "flex",
                      gap: 14,
                      flexWrap: "wrap",
                      marginTop: 6,
                      fontSize: 12,
                      color: "var(--faint)",
                    }}
                  >
                    {j.address.trim() && <span>📍 {j.address}</span>}
                    {j.booking_slot.trim() && <span>🗓️ {j.booking_slot}</span>}
                  </div>
                  {j.summary.trim() && (
                    <p style={{ margin: "8px 0 0", fontSize: 12.5, color: "var(--faint)" }}>
                      {j.summary}
                    </p>
                  )}
                </div>
              );
            })}
            {totalJobs > jobs.length && (
              <p style={{ margin: "4px 0 0", fontSize: 12.5, color: "var(--faint)", textAlign: "center" }}>
                Showing your {jobs.length} most recent jobs of {totalJobs} total.
              </p>
            )}
          </div>
        )}
      </div>

      {/* How it works — reassures a new customer their €349 bought a real system. */}
      <div className="panel panel-block" style={{ marginBottom: 24 }}>
        <h2 className="panel-title">How your receptionist works</h2>
        <div className="stat-grid">
          {[
            {
              icon: <PhoneCall />,
              t: "Answers every call",
              d: "Picks up the calls your team can't — first ring, day or night, never engaged.",
            },
            {
              icon: <ClipboardList />,
              t: "Captures the job",
              d: "Gets the name, number, address, the problem and how urgent it is — and reads it back to confirm.",
            },
            {
              icon: <MessageSquareText />,
              t: "Sends it straight to you",
              d: "The moment the caller hangs up, the full job card lands in your inbox — ready to action.",
            },
            {
              icon: <ShieldCheck />,
              t: "Stays on the rails",
              d: "Never quotes a price or invents availability — it takes the details and says you'll confirm.",
            },
          ].map((s) => (
            <div key={s.t} className="panel" style={{ padding: "14px 16px" }}>
              <div style={{ color: "var(--ac2, #3b82f6)", marginBottom: 8 }}>{s.icon}</div>
              <strong style={{ fontSize: 14 }}>{s.t}</strong>
              <p style={{ margin: "4px 0 0", fontSize: 12.5, color: "var(--faint)" }}>{s.d}</p>
            </div>
          ))}
        </div>
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
            <p style={{ color: "var(--faint)", fontSize: 13, marginBottom: 14 }}>
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
                      style={{ borderBottom: "1px solid var(--border)", paddingBottom: 10 }}
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
                        <p style={{ color: "var(--faint)", fontSize: 13, margin: "4px 0 0" }}>
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
                No problems logged. If your receptionist ever slips up, tell us here.
              </p>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
