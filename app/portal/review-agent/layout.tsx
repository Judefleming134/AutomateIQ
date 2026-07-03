import { notFound } from "next/navigation";
import Link from "next/link";
import { requireSession } from "@/lib/auth/require-session";
import { requireProductEnabled } from "@/lib/auth/require-product";

export default async function ReviewAgentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { profile } = await requireSession();

  const enabled = await requireProductEnabled(
    profile.business_id!,
    "review-agent"
  );
  if (!enabled) notFound();

  return (
    <div>
      <nav style={{ display: "flex", gap: 16, padding: "12px 40px", borderBottom: "1px solid var(--line)" }}>
        <Link href="/portal/review-agent">Overview</Link>
        <Link href="/portal/review-agent/send">Send Request</Link>
        <Link href="/portal/review-agent/customers">Customers</Link>
        <Link href="/portal/review-agent/history">History</Link>
        <Link href="/portal/review-agent/settings">Settings</Link>
      </nav>
      {children}
    </div>
  );
}
