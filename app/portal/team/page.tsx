import { UserPlus } from "lucide-react";
import { requireSession } from "@/lib/auth/require-session";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export default async function TeamPage() {
  const { profile } = await requireSession();
  const supabase = await createClient();

  // RLS note: profiles policy only exposes the caller's own row, so team
  // listing goes through the service-role client AFTER the session check,
  // strictly filtered to the caller's own business.
  const { data: ownProfile } = await supabase
    .from("profiles")
    .select("business_id")
    .maybeSingle();

  const admin = createAdminClient();
  const { data: members } = await admin
    .from("profiles")
    .select("id, role, created_at")
    .eq("business_id", ownProfile?.business_id ?? profile.business_id!);

  const withEmails = await Promise.all(
    (members ?? []).map(async (m) => {
      // A blip in the auth-admin email lookup must never white-screen a
      // customer's Team page — degrade this one row instead of throwing.
      try {
        const { data } = await admin.auth.admin.getUserById(m.id);
        return { ...m, email: data?.user?.email ?? "(unknown)" };
      } catch (err) {
        console.error("Team page getUserById failed for", m.id, err);
        return { ...m, email: "(unavailable)" };
      }
    })
  );

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Team</h1>
          <p>Everyone with access to your business on AutomateIQ.</p>
        </div>
        <a
          href="mailto:hello@automateiq.ie?subject=Add a team member"
          className="btn btn-primary"
        >
          <UserPlus size={15} /> Invite a team member
        </a>
      </div>

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Email</th>
              <th>Role</th>
              <th>Member since</th>
            </tr>
          </thead>
          <tbody>
            {withEmails.map((m) => (
              <tr key={m.id}>
                <td style={{ color: "var(--heading)", fontWeight: 600 }}>{m.email}</td>
                <td>
                  <span className="badge badge-blue">
                    {m.role === "customer" ? "member" : m.role}
                  </span>
                </td>
                <td>{new Date(m.created_at).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p style={{ fontSize: 12.5, color: "var(--faint)", marginTop: 14 }}>
        New team members are added by AutomateIQ for security — tap Invite and
        we&apos;ll set them up, usually the same day. Granular roles &amp;
        permissions are on the roadmap.
      </p>
    </>
  );
}
