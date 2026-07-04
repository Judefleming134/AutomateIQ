import { requireSession } from "@/lib/auth/require-session";
import { createClient } from "@/lib/supabase/server";

export default async function WebsiteAgentLeadsPage() {
  await requireSession();
  const supabase = await createClient();

  // RLS scopes this to the caller's own business automatically.
  const { data: leads } = await supabase
    .from("wa_leads")
    .select("id, name, contact, message, created_at")
    .order("created_at", { ascending: false })
    .limit(200);

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Leads</h1>
          <p>Every enquiry submitted through your public page.</p>
        </div>
      </div>

      <div className="table-wrap">
        {(leads ?? []).length === 0 ? (
          <p className="empty-state">
            No leads yet — publish your page and share the link to start
            collecting enquiries.
          </p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Contact</th>
                <th>Message</th>
                <th>Received</th>
              </tr>
            </thead>
            <tbody>
              {(leads ?? []).map((lead) => (
                <tr key={lead.id}>
                  <td style={{ color: "var(--heading)", fontWeight: 600 }}>{lead.name}</td>
                  <td>{lead.contact}</td>
                  <td style={{ maxWidth: 340 }}>{lead.message || "—"}</td>
                  <td>{new Date(lead.created_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
