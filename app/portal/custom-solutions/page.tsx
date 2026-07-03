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
    <main style={{ padding: 40 }}>
      <h1>Custom Solutions</h1>
      <p>
        Bespoke AI modules built specifically for your business — quote
        generators, invoicing tools, custom CRMs, and more. Get in touch to
        discuss what you need.
      </p>

      {modules && modules.length > 0 ? (
        <ul style={{ marginTop: 24 }}>
          {modules.map((m) => (
            <li key={m.id}>
              <strong>{m.name}</strong>
              {m.description ? ` — ${m.description}` : null}
            </li>
          ))}
        </ul>
      ) : (
        <p style={{ marginTop: 24, fontStyle: "italic" }}>
          No custom modules assigned yet.
        </p>
      )}
    </main>
  );
}
