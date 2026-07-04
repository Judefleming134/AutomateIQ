import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth/require-session";
import { requireProductEnabled } from "@/lib/auth/require-product";

/**
 * Factory for product-page layouts: session + entitlement guard in one
 * line per module. Server Actions still re-check independently — this is
 * the UX gate, not the security boundary.
 */
export function productLayout(productKey: string) {
  return async function ProductLayout({
    children,
  }: {
    children: React.ReactNode;
  }) {
    const { profile } = await requireSession();
    const enabled = await requireProductEnabled(profile.business_id!, productKey);
    if (!enabled) notFound();
    return <>{children}</>;
  };
}
