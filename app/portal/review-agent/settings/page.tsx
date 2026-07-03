import { requireSession } from "@/lib/auth/require-session";
import { createClient } from "@/lib/supabase/server";
import { ActionForm } from "@/components/admin/action-form";
import { SubmitButton } from "@/components/admin/submit-button";
import { updateBusinessSettings } from "./actions";

export default async function ReviewAgentSettingsPage() {
  const { profile } = await requireSession();
  const supabase = await createClient();

  const { data: business } = await supabase
    .from("businesses")
    .select("name, google_review_link, logo_url, email_signature")
    .eq("id", profile.business_id!)
    .single();

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
    </>
  );
}
