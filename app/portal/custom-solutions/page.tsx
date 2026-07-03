import { Box } from "lucide-react";
import { requireSession } from "@/lib/auth/require-session";
import { createClient } from "@/lib/supabase/server";

export default async function CustomSolutionsPage() {
  await requireSession();
  const supabase = await createClient();

  // RLS scopes this to the caller's own business automatically.
  const { data: modules } = await supabase
    .from("custom_modules")
    .select("id, name, description, route_slug");

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Custom Solutions</h1>
          <p>
            Bespoke AI modules built specifically for your business — quote
            generators, invoicing tools, custom CRMs, and more. Get in touch
            to discuss what you need.
          </p>
        </div>
      </div>

      {modules && modules.length > 0 ? (
        <div className="product-grid">
          {modules.map((m) => (
            <div key={m.id} className="panel product-tile" style={{ "--tile-accent": "#F472B6" } as React.CSSProperties}>
              <div className="product-tile-icon">
                <Box size={21} />
              </div>
              <h3>{m.name}</h3>
              {m.description && <p>{m.description}</p>}
            </div>
          ))}
        </div>
      ) : (
        <div className="panel empty-state" style={{ borderRadius: "var(--radius)" }}>
          No custom modules assigned yet.
        </div>
      )}
    </>
  );
}
