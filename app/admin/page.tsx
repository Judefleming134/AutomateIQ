import { requireAdmin } from "@/lib/auth/require-admin";

export default async function AdminHome() {
  const user = await requireAdmin();

  return (
    <main style={{ padding: 40 }}>
      <h1>Admin placeholder</h1>
      <p>Signed in as admin: {user.email}</p>
    </main>
  );
}
