import { KeyRound, Plug, Bell, ShieldCheck, Sparkles } from "lucide-react";
import { requireSession } from "@/lib/auth/require-session";
import { createClient } from "@/lib/supabase/server";
import { ActionForm } from "@/components/admin/action-form";
import { SubmitButton } from "@/components/admin/submit-button";
import { updateBusinessSettings } from "@/app/portal/review-agent/settings/actions";
import { changePassword, updateBusinessKnowledge } from "./actions";

export default async function SettingsPage() {
  const { profile } = await requireSession();
  const supabase = await createClient();

  const [{ data: business }, { data: userRes }, { data: knowledge }] =
    await Promise.all([
      supabase
        .from("businesses")
        .select("name, google_review_link, logo_url, email_signature")
        .eq("id", profile.business_id!)
        .single(),
      supabase.auth.getUser(),
      supabase
        .from("aa_assistants")
        .select("knowledge, tone")
        .eq("business_id", profile.business_id!)
        .maybeSingle(),
    ]);

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Settings</h1>
          <p>Your business profile, branding, security and integrations.</p>
        </div>
      </div>

      <div className="grid-main-side" style={{ marginBottom: 26 }}>
        <div className="panel form-card">
          <h2 className="panel-title" style={{ marginBottom: 16 }}>
            <span><span className="sys-index">01 /</span>Business profile &amp; branding</span>
          </h2>
          <ActionForm action={updateBusinessSettings}>
            <div className="field">
              <label htmlFor="businessName">Business Name</label>
              <input
                id="businessName"
                type="text"
                name="businessName"
                defaultValue={business?.name ?? ""}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="googleReviewLink">Google Review Link</label>
              <input
                id="googleReviewLink"
                type="url"
                name="googleReviewLink"
                placeholder="https://g.page/r/…/review"
                defaultValue={business?.google_review_link ?? ""}
              />
            </div>
            <div className="field">
              <label htmlFor="logoUrl">Company Logo (URL)</label>
              <input
                id="logoUrl"
                type="url"
                name="logoUrl"
                placeholder="https://…/logo.png"
                defaultValue={business?.logo_url ?? ""}
              />
            </div>
            <div className="field">
              <label htmlFor="emailSignature">Email Signature</label>
              <textarea
                id="emailSignature"
                name="emailSignature"
                rows={3}
                defaultValue={business?.email_signature ?? ""}
              />
            </div>
            <div className="form-actions">
              <SubmitButton pendingText="Saving…">Save changes</SubmitButton>
            </div>
          </ActionForm>
        </div>

        <div className="panel form-card">
          <h2 className="panel-title" style={{ marginBottom: 16 }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              <ShieldCheck size={15} /> Security
            </span>
          </h2>
          <p style={{ margin: "0 0 14px", fontSize: 13, color: "var(--body)" }}>
            Signed in as{" "}
            <strong style={{ color: "var(--heading)" }}>
              {userRes.user?.email}
            </strong>
          </p>
          <ActionForm action={changePassword}>
            <div className="field">
              <label htmlFor="newPassword">New password</label>
              <input
                id="newPassword"
                type="password"
                name="newPassword"
                minLength={8}
                autoComplete="new-password"
                required
              />
            </div>
            <div className="field">
              <label htmlFor="confirmPassword">Confirm new password</label>
              <input
                id="confirmPassword"
                type="password"
                name="confirmPassword"
                minLength={8}
                autoComplete="new-password"
                required
              />
            </div>
            <div className="form-actions">
              <SubmitButton pendingText="Updating…">Update password</SubmitButton>
            </div>
          </ActionForm>
        </div>
      </div>

      <div className="panel form-card" style={{ marginBottom: 26 }}>
        <h2 className="panel-title" style={{ marginBottom: 6 }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <Sparkles size={15} /> Business knowledge &amp; brand voice
          </span>
        </h2>
        <p style={{ margin: "0 0 12px", fontSize: 13, color: "var(--body)", maxWidth: "70ch" }}>
          The single source of truth your AI agents use to sound like you —
          services, prices, hours, service area, policies, and the tone you
          want. Your AI Assistant and Content Agent both read this, so the
          more detail here, the better everything they produce.
        </p>
        <ActionForm action={updateBusinessKnowledge}>
          <div className="field">
            <label htmlFor="knowledge">What your agents should know</label>
            <textarea
              id="knowledge"
              name="knowledge"
              rows={8}
              placeholder={
                "We're a plumbing company covering north Dublin.\nCall-out fee: €80. Hourly rate: €95.\nOpen Mon-Sat 8am-6pm, emergency service 24/7.\nWe don't do commercial jobs.\n..."
              }
              defaultValue={knowledge?.knowledge ?? ""}
            />
          </div>
          <div className="field">
            <label htmlFor="tone">Brand voice / tone</label>
            <input
              id="tone"
              type="text"
              name="tone"
              placeholder="friendly and professional"
              defaultValue={knowledge?.tone ?? "friendly and professional"}
            />
          </div>
          <div className="form-actions">
            <SubmitButton pendingText="Saving…">Save knowledge</SubmitButton>
          </div>
        </ActionForm>
      </div>

      <div className="grid-2">
        <div className="panel panel-block">
          <h2 className="panel-title">
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              <Bell size={15} /> Notifications
            </span>
          </h2>
          <p style={{ margin: 0, fontSize: 13, color: "var(--body)" }}>
            You currently receive email confirmations for review-request
            activity, and your customers receive one polite reminder three
            days after each request. Per-channel notification preferences are
            on the roadmap — to change anything now, email{" "}
            <a href="mailto:hello@automateiq.ie" style={{ color: "var(--ac2)" }}>
              hello@automateiq.ie
            </a>
            .
          </p>
        </div>

        <div className="panel panel-block">
          <h2 className="panel-title">
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              <Plug size={15} /> Integrations
            </span>
            <span className="badge badge-gray">Coming soon</span>
          </h2>
          <p style={{ margin: 0, fontSize: 13, color: "var(--body)" }}>
            Direct connections to Google Business Profile, WhatsApp, and your
            calendar are in development. Your AI Assistant and Website Agent
            already work out of the box with no setup required.
          </p>
        </div>

        <div className="panel panel-block">
          <h2 className="panel-title">
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              <KeyRound size={15} /> API keys
            </span>
            <span className="badge badge-gray">Coming soon</span>
          </h2>
          <p style={{ margin: 0, fontSize: 13, color: "var(--body)" }}>
            Programmatic access to your AutomateIQ data — leads, reviews and
            AI conversations — will be available here with scoped, revocable
            keys.
          </p>
        </div>
      </div>
    </>
  );
}
