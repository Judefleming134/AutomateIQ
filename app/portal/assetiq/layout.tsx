import { guardProduct } from "@/lib/auth/require-product";

/**
 * Entitlement gate for the AssetIQ tree. 404s for a business without the
 * product, exactly like every other module — the Server Actions re-check it
 * independently, because a layout is the UX gate and not the security
 * boundary.
 */
export default async function AssetIqLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await guardProduct("assetiq");
  return <>{children}</>;
}
