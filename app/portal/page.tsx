import Link from "next/link";
import { Lock } from "lucide-react";
import { requireSession } from "@/lib/auth/require-session";
import { createClient } from "@/lib/supabase/server";
import { PRODUCT_REGISTRY } from "@/lib/products/registry";
import { ProductIcon } from "@/lib/products/icons";

export default async function PortalHome() {
  const { profile } = await requireSession();
  const supabase = await createClient();

  const [{ data: business }, { data: enabledRows }] = await Promise.all([
    supabase
      .from("businesses")
      .select("name")
      .eq("id", profile.business_id)
      .single(),
    // RLS already scopes this to the caller's own business — no need to
    // filter by business_id again here.
    supabase.from("business_products").select("products(key)"),
  ]);

  const enabledKeys = new Set(
    (enabledRows ?? [])
      .map((r) => (r.products as unknown as { key: string } | null)?.key)
      .filter((k): k is string => Boolean(k))
  );

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Welcome back, {business?.name ?? "there"}</h1>
          <p>Here&apos;s what&apos;s happening with your AutomateIQ platform today.</p>
        </div>
      </div>

      <div className="product-grid">
        {PRODUCT_REGISTRY.map((product) => {
          const isEnabled = enabledKeys.has(product.key);
          const style = { "--tile-accent": product.accent } as React.CSSProperties;

          const tile = (
            <>
              <div className="product-tile-icon">
                <ProductIcon name={product.iconName} size={21} />
              </div>
              <h3>{product.name}</h3>
              <p>{product.description}</p>
              {isEnabled ? (
                <span className="badge badge-green">Active</span>
              ) : product.status === "coming_soon" ? (
                <span className="badge badge-gray">
                  <Lock size={11} /> Coming soon
                </span>
              ) : (
                <span className="badge badge-gray">
                  <Lock size={11} /> Not enabled
                </span>
              )}
            </>
          );

          return isEnabled ? (
            <Link
              key={product.key}
              href={product.href}
              className="product-tile panel"
              style={style}
            >
              {tile}
            </Link>
          ) : (
            <div
              key={product.key}
              className="product-tile panel is-disabled"
              style={style}
            >
              {tile}
            </div>
          );
        })}
      </div>
    </>
  );
}
