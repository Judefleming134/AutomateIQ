import { guardProduct } from "@/lib/auth/require-product";

/**
 * Factory for product-page layouts: session + entitlement guard in one line
 * per module. Server Actions still re-check independently — this is the UX
 * gate, not the security boundary.
 */
export function productLayout(productKey: string) {
  return async function ProductLayout({
    children,
  }: {
    children: React.ReactNode;
  }) {
    await guardProduct(productKey);
    return <>{children}</>;
  };
}
