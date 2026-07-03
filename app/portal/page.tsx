import { requireSession } from "@/lib/auth/require-session";

export default async function PortalHome() {
  const { profile } = await requireSession();

  return (
    <main style={{ padding: 40 }}>
      <h1>Portal placeholder</h1>
      <p>Signed in. business_id: {profile.business_id}</p>
    </main>
  );
}
