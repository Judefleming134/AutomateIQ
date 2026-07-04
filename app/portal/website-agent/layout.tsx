import { notFound } from "next/navigation";
import { WebsiteAgentSubnav } from "./subnav";
import { requireSession } from "@/lib/auth/require-session";
import { requireProductEnabled } from "@/lib/auth/require-product";

export default async function WebsiteAgentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { profile } = await requireSession();

  const enabled = await requireProductEnabled(
    profile.business_id!,
    "website-agent"
  );
  if (!enabled) notFound();

  return (
    <>
      <WebsiteAgentSubnav />
      {children}
    </>
  );
}
