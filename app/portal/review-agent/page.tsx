import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth/require-session";
import { requireProductEnabled } from "@/lib/auth/require-product";

export default async function ReviewAgentPage() {
  const { profile } = await requireSession();

  const enabled = await requireProductEnabled(
    profile.business_id!,
    "review-agent"
  );
  if (!enabled) notFound();

  return (
    <main style={{ padding: 40 }}>
      <h1>Review Agent</h1>
      <p>Dashboard coming in Stage 5.</p>
    </main>
  );
}
