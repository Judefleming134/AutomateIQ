import { requireSession } from "@/lib/auth/require-session";
import { createClient } from "@/lib/supabase/server";
import { ActionForm } from "@/components/admin/action-form";
import { SubmitButton } from "@/components/admin/submit-button";
import { CheckCircle2, AlertTriangle } from "lucide-react";
import { reviewLinkStatus } from "@/lib/review-agent/review-hosts";
import {
  MAX_JOB_AGE_DAYS,
  ASK_COOLDOWN_DAYS,
} from "@/lib/review-agent/auto-request";
import { updateBusinessSettings } from "./actions";

export default async function ReviewAgentSettingsPage() {
  const { profile } = await requireSession();
  const supabase = await createClient();

  const { data: business } = await supabase
    .from("businesses")
    .select("*")
    .eq("id", profile.business_id!)
    .single();

  // The status of the link ALREADY saved, judged by the same parser the
  // redirect uses. Previously nothing on this page said whether the link
  // worked — the first thing to find out was a customer clicking it.
  const link = reviewLinkStatus(business?.google_review_link);

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Settings</h1>
          <p>
            These values automatically populate every review request email —
            business name, logo, review link and signature.
          </p>
        </div>
      </div>

      <div className="grid-main-side">
        <ActionForm action={updateBusinessSettings} className="panel form-card">
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
              /* type="text", not "url": the browser's own URL validation
                 rejects "g.page/r/xyz/review" before the form is even
                 submitted, and that is the commonest correct paste. The
                 server checks it properly with the redirect's own parser. */
              type="text"
              name="googleReviewLink"
              placeholder="g.page/r/…/review"
              defaultValue={business?.google_review_link ?? ""}
              maxLength={2000}
            />
            {/* What a customer clicking this link will actually experience. */}
            <p
              style={{
                display: "flex",
                gap: 7,
                alignItems: "flex-start",
                margin: "8px 0 0",
                fontSize: 12.5,
                lineHeight: 1.55,
                color: link.ok && link.known
                  ? "var(--green, #34d399)"
                  : "var(--orange, #fb923c)",
              }}
            >
              {link.ok && link.known ? (
                <>
                  <CheckCircle2 size={13} style={{ flexShrink: 0, marginTop: 2 }} />
                  <span>
                    Recognised review site — customers go straight through to{" "}
                    {link.url.hostname}.
                  </span>
                </>
              ) : (
                <>
                  <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 2 }} />
                  <span>{link.message}</span>
                </>
              )}
            </p>
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
          {/* The whole promise of the product — "ask while the job is still
              fresh" — used to depend on remembering to press Send on the day.
              Off by default; nothing changes for anyone until they tick it. */}
          <div className="field" style={{ gap: 8 }}>
            <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <input
                id="autoRequests"
                type="checkbox"
                name="autoRequests"
                defaultChecked={Boolean(business?.auto_review_requests)}
                style={{ width: 16, height: 16 }}
              />
              <label htmlFor="autoRequests" style={{ margin: 0 }}>
                Ask automatically when a job is paid
              </label>
            </span>
            <span style={{ fontSize: 11.5, color: "var(--faint)", maxWidth: "62ch" }}>
              When you mark a QuoteIQ invoice paid, the review request goes out
              on the next morning run — while the job is still fresh, without
              anyone having to remember. Only jobs paid in the last{" "}
              {MAX_JOB_AGE_DAYS} days, never the same person twice in{" "}
              {ASK_COOLDOWN_DAYS} days, and never anyone who has already
              reviewed you. Switching this on does not reach back over older
              invoices.
            </span>
          </div>
          <div className="form-actions">
            <SubmitButton pendingText="Saving…">Save changes</SubmitButton>
          </div>
        </ActionForm>

        <div className="panel panel-block">
          <h2 className="panel-title">Where these appear</h2>
          <ol className="timeline">
            <li>
              <h3>Business Name</h3>
              <p>The email&apos;s heading and subject — who the request is from.</p>
            </li>
            <li>
              <h3>Google Review Link</h3>
              <p>
                Where the &quot;Leave a review&quot; button sends your customer.
                Required before you can send requests.
              </p>
            </li>
            <li>
              <h3>Company Logo</h3>
              <p>Shown at the top of the email instead of plain text.</p>
            </li>
            <li>
              <h3>Email Signature</h3>
              <p>The sign-off at the bottom of every email.</p>
            </li>
          </ol>
        </div>
      </div>
    </>
  );
}
