import { Building2, CheckCircle2, PauseCircle } from "lucide-react";
import { requireAdmin } from "@/lib/auth/require-admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { StatCard } from "@/components/portal/stat-card";

export default async function AdminHome() {
  const user = await requireAdmin();
  const supabase = createAdminClient();

  const [{ count: total }, { count: active }, { count: suspended }] =
    await Promise.all([
      supabase
        .from("businesses")
        .select("id", { count: "exact", head: true })
        .is("deleted_at", null),
      supabase
        .from("businesses")
        .select("id", { count: "exact", head: true })
        .is("deleted_at", null)
        .eq("status", "active"),
      supabase
        .from("businesses")
        .select("id", { count: "exact", head: true })
        .is("deleted_at", null)
        .eq("status", "suspended"),
    ]);

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Platform overview</h1>
          <p>Signed in as admin: {user.email}</p>
        </div>
      </div>

      <div className="stat-grid">
        <StatCard label="Total customers" value={total ?? 0} icon={<Building2 />} accent="#3B82F6" />
        <StatCard label="Active" value={active ?? 0} icon={<CheckCircle2 />} accent="#34D399" />
        <StatCard label="Suspended" value={suspended ?? 0} icon={<PauseCircle />} accent="#FB923C" />
      </div>
    </>
  );
}
