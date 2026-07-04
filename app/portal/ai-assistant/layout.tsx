import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth/require-session";
import { requireProductEnabled } from "@/lib/auth/require-product";

export default async function AiAssistantLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { profile } = await requireSession();

  const enabled = await requireProductEnabled(
    profile.business_id!,
    "ai-assistant"
  );
  if (!enabled) notFound();

  return <>{children}</>;
}
