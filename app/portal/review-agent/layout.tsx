import { notFound } from "next/navigation";
import { ReviewAgentSubnav } from "./subnav";
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
    <>
      <ReviewAgentSubnav />
      {children}
    </>
  );
}
