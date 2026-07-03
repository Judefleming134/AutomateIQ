import { requireSession } from "@/lib/auth/require-session";
import { createClient } from "@/lib/supabase/server";
import { ActionForm } from "@/components/admin/action-form";
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
    <main style={{ padding: 40, maxWidth: 480 }}>
      <h1>Settings</h1>
      <p>
        These values automatically populate every review request email —
        business name, logo, review link and signature.
      </p>

      <ActionForm action={updateBusinessSettings} className="settings-form">
        <label>
          Business Name
          <input type="text" name="businessName" defaultValue={business?.name ?? ""} required />
        </label>
        <label>
          Google Review Link
          <input
            type="url"
            name="googleReviewLink"
            placeholder="https://g.page/r/…/review"
            defaultValue={business?.google_review_link ?? ""}
          />
        </label>
        <label>
          Company Logo (URL)
          <input
            type="url"
            name="logoUrl"
            placeholder="https://…/logo.png"
            defaultValue={business?.logo_url ?? ""}
          />
        </label>
        <label>
          Email Signature
          <textarea name="emailSignature" rows={3} defaultValue={business?.email_signature ?? ""} />
        </label>
        <button type="submit">Save changes</button>
      </ActionForm>
    </main>
  );
}
