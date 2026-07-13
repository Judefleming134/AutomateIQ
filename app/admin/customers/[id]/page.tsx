import { notFound } from "next/navigation";
import {
  KeyRound,
  FileText,
  Send,
  MousePointerClick,
  Users,
  MessageSquare,
  Mic,
  Sparkles,
} from "lucide-react";
import { requireAdmin } from "@/lib/auth/require-admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { StatCard } from "@/components/portal/stat-card";
import {
  setBusinessStatus,
  softDeleteBusiness,
  resetUserPassword,
  sendLoginInvite,
  setProductEnabled,
  saveVoiceProvisioning,
  saveAssistantKnowledge,
  uploadDocument,
  deleteDocument,
} from "../actions";
import { ActionForm } from "@/components/admin/action-form";
import { SubmitButton } from "@/components/admin/submit-button";

type VoiceProvisioning = {
  status: string;
  phone_number: string | null;
  elevenlabs_agent_id: string | null;
  greeting: string | null;
  services: string | null;
  business_hours: string | null;
  service_area: string | null;
  knowledge: string | null;
};

export default async function AdminCustomerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await params;
  const supabase = createAdminClient();

  const { data: business } = await supabase
    .from("businesses")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (!business) notFound();

  const [{ data: users }, { data: products }, { data: enabled }, { data: documents }] =
    await Promise.all([
      supabase
        .from("profiles")
        .select("id, role, created_at")
        .eq("business_id", id),
      supabase.from("products").select("id, key, name, status"),
      supabase.from("business_products").select("product_id").eq("business_id", id),
      supabase
        .from("documents")
        .select("id, name, file_size, created_at")
        .eq("business_id", id)
        .order("created_at", { ascending: false }),
    ]);

  // profiles has no email column (that lives on auth.users) — fetch emails
  // via the admin API for the small number of users on this business.
  const usersWithEmail = await Promise.all(
    (users ?? []).map(async (u) => {
      const { data } = await supabase.auth.admin.getUserById(u.id);
      return { ...u, email: data.user?.email ?? "(unknown)" };
    })
  );

  const enabledProductIds = new Set((enabled ?? []).map((e) => e.product_id));
  const voiceProduct = (products ?? []).find((p) => p.key === "voice-agent");
  const voiceEnabled = voiceProduct ? enabledProductIds.has(voiceProduct.id) : false;
  const assistantProduct = (products ?? []).find((p) => p.key === "ai-assistant");
  const aiAssistantEnabled = assistantProduct
    ? enabledProductIds.has(assistantProduct.id)
    : false;

  // Current voice provisioning + seeded knowledge. Guarded — the table may not
  // exist yet on a fresh DB; degrade to blank defaults rather than 500.
  let voiceConfig: VoiceProvisioning | null = null;
  if (voiceEnabled) {
    const { data } = await supabase
      .from("va_config")
      .select(
        "status, phone_number, elevenlabs_agent_id, greeting, services, business_hours, service_area, knowledge"
      )
      .eq("business_id", id)
      .maybeSingle();
    voiceConfig = (data as VoiceProvisioning | null) ?? null;
  }

  // Usage snapshot + setup state for this business — service-role queries,
  // explicitly scoped by business_id.
  const [
    { count: requests },
    { count: clicked },
    { count: leads },
    { count: conversations },
    { data: waPage },
    { data: assistant },
  ] = await Promise.all([
    supabase
      .from("ra_review_requests")
      .select("id", { count: "exact", head: true })
      .eq("business_id", id)
      .in("status", ["sent", "reminded", "clicked"]),
    supabase
      .from("ra_review_requests")
      .select("id", { count: "exact", head: true })
      .eq("business_id", id)
      .eq("status", "clicked"),
    supabase
      .from("wa_leads")
      .select("id", { count: "exact", head: true })
      .eq("business_id", id),
    supabase
      .from("aa_conversations")
      .select("id", { count: "exact", head: true })
      .eq("business_id", id),
    supabase
      .from("wa_pages")
      .select("published")
      .eq("business_id", id)
      .maybeSingle(),
    supabase
      .from("aa_assistants")
      .select("knowledge, tone")
      .eq("business_id", id)
      .maybeSingle(),
  ]);

  const clickRate =
    (requests ?? 0) > 0
      ? `${Math.round(((clicked ?? 0) / (requests ?? 1)) * 100)}%`
      : "—";

  const setupChecks = [
    {
      label: "Google review link",
      ok: Boolean(business.google_review_link),
    },
    { label: "AI Assistant knowledge", ok: Boolean(assistant?.knowledge) },
    { label: "Website page published", ok: Boolean(waPage?.published) },
    { label: "First review request sent", ok: (requests ?? 0) > 0 },
    { label: "First lead captured", ok: (leads ?? 0) > 0 },
  ];

  // useActionState requires action: (prevState, formData) => result — these
  // capture `id` (and, per-item, the loop variable) via closure.
  async function suspend(_p: unknown, _f: FormData) {
    "use server";
    return setBusinessStatus(id, "suspended");
  }
  async function unsuspend(_p: unknown, _f: FormData) {
    "use server";
    return setBusinessStatus(id, "active");
  }
  async function remove(_p: unknown, _f: FormData) {
    "use server";
    return softDeleteBusiness(id);
  }
  async function invite(_p: unknown, _f: FormData) {
    "use server";
    return sendLoginInvite(id);
  }
  async function saveVoice(_p: unknown, f: FormData) {
    "use server";
    return saveVoiceProvisioning(id, undefined, f);
  }
  async function saveAssistant(_p: unknown, f: FormData) {
    "use server";
    return saveAssistantKnowledge(id, undefined, f);
  }
  const voiceStatus = voiceConfig?.status ?? "provisioning";

  return (
    <>
      <div className="page-header">
        <div>
          <h1>{business.name}</h1>
          <span className={`badge ${business.status === "active" ? "badge-green" : "badge-orange"}`}>
            {business.status}
          </span>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <ActionForm action={invite} className="inline-form">
            <SubmitButton className="btn btn-primary" pendingText="Sending…">
              Send login invite
            </SubmitButton>
          </ActionForm>
          {business.status === "active" ? (
            <ActionForm action={suspend} className="inline-form">
              <SubmitButton className="btn btn-secondary" pendingText="Suspending…">
                Suspend
              </SubmitButton>
            </ActionForm>
          ) : (
            <ActionForm action={unsuspend} className="inline-form">
              <SubmitButton className="btn btn-secondary" pendingText="Reactivating…">
                Reactivate
              </SubmitButton>
            </ActionForm>
          )}
          <ActionForm action={remove} className="inline-form">
            <SubmitButton className="btn btn-danger" pendingText="Deleting…">
              Delete
            </SubmitButton>
          </ActionForm>
        </div>
      </div>

      <div className="stat-grid">
        <StatCard
          label="Review requests"
          value={requests ?? 0}
          icon={<Send />}
          accent="#7C3AED"
        />
        <StatCard
          label="Review clicks"
          value={clicked ?? 0}
          icon={<MousePointerClick />}
          accent="#22D3EE"
          hint={`${clickRate} click rate`}
        />
        <StatCard
          label="Leads"
          value={leads ?? 0}
          icon={<Users />}
          accent="#0891B2"
        />
        <StatCard
          label="AI conversations"
          value={conversations ?? 0}
          icon={<MessageSquare />}
          accent="#3B82F6"
        />
      </div>

      <div className="panel panel-block" style={{ marginBottom: 26 }}>
        <h2 className="panel-title">Setup progress</h2>
        <ul className="health-list health-list-row">
          {setupChecks.map((c) => (
            <li key={c.label} className={c.ok ? "is-done" : ""}>
              <span>{c.label}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="grid-2">
        <div className="panel panel-block">
          <h2 className="panel-title">Users</h2>
          {usersWithEmail.length === 0 ? (
            <p className="empty-state">No users yet.</p>
          ) : (
            <ul className="feed-list">
              {usersWithEmail.map((u) => {
                async function reset(_p: unknown, _f: FormData) {
                  "use server";
                  return resetUserPassword(u.id, u.email);
                }
                return (
                  <li key={u.id}>
                    <span
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        minWidth: 0,
                      }}
                    >
                      <span className="badge badge-blue">{u.role}</span>
                      <span
                        style={{
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                          color: "var(--heading)",
                        }}
                      >
                        {u.email}
                      </span>
                    </span>
                    <ActionForm action={reset} className="inline-form">
                      <SubmitButton
                        className="btn btn-secondary btn-sm"
                        pendingText="Sending…"
                      >
                        <KeyRound size={13} /> Reset password
                      </SubmitButton>
                    </ActionForm>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="panel panel-block">
          <h2 className="panel-title">Products</h2>
          <ul className="feed-list">
            {(products ?? []).map((p) => {
              const isEnabled = enabledProductIds.has(p.id);
              async function toggle(_prev: unknown, _f: FormData) {
                "use server";
                return setProductEnabled(id, p.id, !isEnabled);
              }
              return (
                <li key={p.id}>
                  <span
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      minWidth: 0,
                    }}
                  >
                    <span
                      className={`badge ${isEnabled ? "badge-green" : "badge-gray"}`}
                    >
                      {isEnabled ? "Enabled" : "Disabled"}
                    </span>
                    <span
                      style={{
                        color: "var(--heading)",
                        fontWeight: 600,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {p.name}
                    </span>
                  </span>
                  <ActionForm action={toggle} className="inline-form">
                    <SubmitButton
                      className={`btn btn-sm ${isEnabled ? "btn-danger" : "btn-primary"}`}
                      pendingText="Saving…"
                    >
                      {isEnabled ? "Remove" : "Assign"}
                    </SubmitButton>
                  </ActionForm>
                </li>
              );
            })}
          </ul>
        </div>
      </div>

      {voiceEnabled && (
        <div className="panel panel-block" style={{ marginBottom: 28 }}>
          <h2 className="panel-title">
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              <Mic size={16} /> Voice Agent provisioning
            </span>
          </h2>
          <p style={{ margin: "0 0 14px", fontSize: 13, color: "var(--body)" }}>
            Set it all up here before you send the invite — flip it live, set
            the number, link the ElevenLabs agent, and pre-fill what the
            receptionist knows. When the customer logs in, everything already
            works. Saving pushes the knowledge to the live ElevenLabs agent
            too. (Blank knowledge boxes are left as-is, never wiped.)
          </p>
          <ActionForm action={saveVoice}>
            <div
              style={{
                display: "grid",
                gap: 12,
                gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                alignItems: "end",
              }}
            >
              <div className="field" style={{ margin: 0 }}>
                <label htmlFor="va-status">Status</label>
                <select id="va-status" name="status" defaultValue={voiceStatus}>
                  <option value="provisioning">Setting up</option>
                  <option value="live">Live</option>
                  <option value="paused">Paused</option>
                </select>
              </div>
              <div className="field" style={{ margin: 0 }}>
                <label htmlFor="va-phone">Phone number</label>
                <input
                  id="va-phone"
                  type="text"
                  name="phone_number"
                  placeholder="+353 1 234 5678"
                  defaultValue={voiceConfig?.phone_number ?? ""}
                />
              </div>
              <div className="field" style={{ margin: 0 }}>
                <label htmlFor="va-agent">ElevenLabs agent ID</label>
                <input
                  id="va-agent"
                  type="text"
                  name="elevenlabs_agent_id"
                  placeholder="agent_xxxx…"
                  defaultValue={voiceConfig?.elevenlabs_agent_id ?? ""}
                />
              </div>
            </div>
            <div className="field" style={{ marginTop: 12 }}>
              <label htmlFor="va-greeting">Greeting (first line it says)</label>
              <input
                id="va-greeting"
                type="text"
                name="greeting"
                placeholder="Thanks for calling Castleknock Plumbing, how can I help?"
                defaultValue={voiceConfig?.greeting ?? ""}
              />
            </div>
            <div
              style={{
                display: "grid",
                gap: 12,
                gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                marginTop: 12,
              }}
            >
              <div className="field" style={{ margin: 0 }}>
                <label htmlFor="va-hours">Business hours</label>
                <input
                  id="va-hours"
                  type="text"
                  name="business_hours"
                  placeholder="Mon–Fri 8am–6pm, emergency 24/7"
                  defaultValue={voiceConfig?.business_hours ?? ""}
                />
              </div>
              <div className="field" style={{ margin: 0 }}>
                <label htmlFor="va-area">Service area</label>
                <input
                  id="va-area"
                  type="text"
                  name="service_area"
                  placeholder="Castleknock, Blanchardstown & Dublin 15"
                  defaultValue={voiceConfig?.service_area ?? ""}
                />
              </div>
            </div>
            <div className="field" style={{ marginTop: 12 }}>
              <label htmlFor="va-services">Services offered</label>
              <textarea
                id="va-services"
                name="services"
                rows={2}
                placeholder="Emergency callouts, boiler repair & servicing, leaks, bathroom installs…"
                defaultValue={voiceConfig?.services ?? ""}
              />
            </div>
            <div className="field" style={{ marginTop: 12 }}>
              <label htmlFor="va-knowledge">Anything else it should know (FAQs, what to say)</label>
              <textarea
                id="va-knowledge"
                name="knowledge"
                rows={4}
                placeholder="Never quote a price on the phone. If it's a gas leak, tell them to ring Gas Networks on 1800 20 50 50 first."
                defaultValue={voiceConfig?.knowledge ?? ""}
              />
            </div>
            <div className="form-actions" style={{ marginTop: 12 }}>
              <SubmitButton className="btn btn-primary btn-sm" pendingText="Saving…">
                Save &amp; sync receptionist
              </SubmitButton>
            </div>
          </ActionForm>
        </div>
      )}

      {aiAssistantEnabled && (
        <div className="panel panel-block" style={{ marginBottom: 28 }}>
          <h2 className="panel-title">
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              <Sparkles size={16} /> AI Assistant — pre-seed its knowledge
            </span>
          </h2>
          <p style={{ margin: "0 0 14px", fontSize: 13, color: "var(--body)" }}>
            Fill this in and the customer&apos;s AI Assistant is <b>online and
            already knows their business</b> the moment they log in — no blank
            first run. They can still edit it in their portal afterwards.
          </p>
          <ActionForm action={saveAssistant}>
            <div className="field">
              <label htmlFor="aa-tone">Tone</label>
              <input
                id="aa-tone"
                type="text"
                name="tone"
                placeholder="friendly and professional"
                defaultValue={assistant?.tone ?? "friendly and professional"}
              />
            </div>
            <div className="field" style={{ marginTop: 12 }}>
              <label htmlFor="aa-knowledge">What the assistant knows about the business</label>
              <textarea
                id="aa-knowledge"
                name="knowledge"
                rows={6}
                placeholder="Castleknock Plumbing — plumbing & heating in Dublin 15. Services: emergency callouts, boiler repair & servicing, leaks, bathroom installs. Hours: Mon–Fri 8–6, emergency 24/7. Owner: [name]. Never quote firm prices — the team confirms on site."
                defaultValue={assistant?.knowledge ?? ""}
              />
            </div>
            <div className="form-actions" style={{ marginTop: 12 }}>
              <SubmitButton className="btn btn-primary btn-sm" pendingText="Saving…">
                Save assistant knowledge
              </SubmitButton>
            </div>
          </ActionForm>
        </div>
      )}

      <div className="panel panel-block" style={{ marginBottom: 28 }}>
        <h2 className="panel-title">
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <FileText size={16} /> Documents
          </span>
        </h2>
        <p style={{ margin: "0 0 14px", fontSize: 13, color: "var(--body)" }}>
          Contracts and paperwork uploaded here appear in this customer&apos;s
          portal under Documents, ready to view and download.
        </p>

        <ActionForm action={uploadDocument.bind(null, id)}>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <input
              type="file"
              name="file"
              required
              style={{ fontSize: 13, color: "var(--body)", maxWidth: 260 }}
            />
            <input
              type="text"
              name="label"
              placeholder="Display name (optional)"
              style={{
                background: "var(--bg2)",
                border: "1px solid var(--line)",
                borderRadius: "var(--radius-sm)",
                padding: "9px 12px",
                color: "var(--heading)",
                fontSize: 13.5,
              }}
            />
            <SubmitButton className="btn btn-primary btn-sm" pendingText="Uploading…">
              Upload
            </SubmitButton>
          </div>
        </ActionForm>

        {(documents ?? []).length > 0 && (
          <ul className="feed-list" style={{ marginTop: 14 }}>
            {(documents ?? []).map((doc) => {
              async function removeDoc(_p: unknown, _f: FormData) {
                "use server";
                return deleteDocument(doc.id);
              }
              return (
                <li key={doc.id}>
                  <span
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      minWidth: 0,
                    }}
                  >
                    <FileText size={14} style={{ flex: "none", color: "var(--ac2)" }} />
                    <span
                      style={{
                        color: "var(--heading)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {doc.name}
                    </span>
                    <span style={{ flex: "none", fontSize: 11.5, color: "var(--faint)" }}>
                      {doc.file_size ? `${(doc.file_size / 1024 / 1024).toFixed(1)}MB` : ""}
                    </span>
                  </span>
                  <ActionForm action={removeDoc} className="inline-form">
                    <SubmitButton className="btn btn-danger btn-sm" pendingText="…">
                      Delete
                    </SubmitButton>
                  </ActionForm>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </>
  );
}
