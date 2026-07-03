import Link from "next/link";
import { requireSession } from "@/lib/auth/require-session";
import { createClient } from "@/lib/supabase/server";
import { PRODUCT_REGISTRY } from "@/lib/products/registry";

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
    <main style={{ padding: 40 }}>
      <h1>Welcome back, {business?.name ?? "there"} 👋</h1>
      <p>Here&apos;s what&apos;s happening with your AutomateIQ platform today.</p>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
          gap: 16,
          marginTop: 24,
        }}
      >
        {PRODUCT_REGISTRY.map((product) => {
          const isEnabled = enabledKeys.has(product.key);
          const tile = (
            <div
              style={{
                border: "1px solid var(--line)",
                borderRadius: 14,
                padding: 20,
                background: "var(--panel)",
                opacity: isEnabled ? 1 : 0.55,
              }}
            >
              <h3 style={{ color: product.accent }}>{product.name}</h3>
              <p style={{ fontSize: 13 }}>{product.description}</p>
              <p style={{ fontSize: 12, marginTop: 8 }}>
                {isEnabled ? "Active" : "Not enabled for your account"}
              </p>
            </div>
          );
          return isEnabled ? (
            <Link key={product.key} href={product.href} style={{ textDecoration: "none", color: "inherit" }}>
              {tile}
            </Link>
          ) : (
            <div key={product.key}>{tile}</div>
          );
        })}
      </div>
    </main>
  );
}
