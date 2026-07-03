import Link from "next/link";
import { requireAdmin } from "@/lib/auth/require-admin";

export default async function AdminHome() {
  const user = await requireAdmin();

  return (
    <main style={{ padding: 40 }}>
      <h1>Admin</h1>
      <p>Signed in as admin: {user.email}</p>
      <p>
        <Link href="/admin/customers">Manage customers →</Link>
      </p>
    </main>
  );
}
