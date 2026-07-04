import { Contact, Star, Globe } from "lucide-react";
import { requireSession } from "@/lib/auth/require-session";
import { createClient } from "@/lib/supabase/server";
import { StatCard } from "@/components/portal/stat-card";

function sanitize(q: string) {
  return q.replace(/[,()%]/g, " ").trim();
}

type UnifiedContact = {
  key: string;
  name: string;
  detail: string;
  source: "review" | "lead";
  note?: string;
  createdAt: string;
};

export default async function CrmAgentPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  await requireSession();
  const supabase = await createClient();
  const { q: rawQ = "" } = await searchParams;
  const q = sanitize(rawQ);

  // RLS scopes both sources to the caller's own business.
  let customerQuery = supabase
    .from("ra_customers")
    .select("id, name, email, created_at")
    .order("created_at", { ascending: false })
    .limit(100);
  let leadQuery = supabase
    .from("wa_leads")
    .select("id, name, contact, message, created_at")
    .order("created_at", { ascending: false })
    .limit(100);
  if (q) {
    customerQuery = customerQuery.or(`name.ilike.%${q}%,email.ilike.%${q}%`);
    leadQuery = leadQuery.or(`name.ilike.%${q}%,contact.ilike.%${q}%`);
  }

  const [
    { data: customers },
    { data: leads },
    { count: customerCount },
    { count: leadCount },
  ] = await Promise.all([
    customerQuery,
    leadQuery,
    supabase.from("ra_customers").select("id", { count: "exact", head: true }),
    supabase.from("wa_leads").select("id", { count: "exact", head: true }),
  ]);

  const contacts: UnifiedContact[] = [
    ...(customers ?? []).map((c) => ({
      key: `c-${c.id}`,
      name: c.name,
      detail: c.email,
      source: "review" as const,
      createdAt: c.created_at,
    })),
    ...(leads ?? []).map((l) => ({
      key: `l-${l.id}`,
      name: l.name,
      detail: l.contact,
      source: "lead" as const,
      note: l.message ?? undefined,
      createdAt: l.created_at,
    })),
  ].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

  return (
    <>
      <div className="page-header">
        <div>
          <h1>CRM Agent</h1>
          <p>
            Every contact from every agent in one place — review customers
            and website leads, merged and searchable.
          </p>
        </div>
      </div>

      <div className="stat-grid">
        <StatCard
          label="Total contacts"
          value={(customerCount ?? 0) + (leadCount ?? 0)}
          icon={<Contact />}
          accent="#3B82F6"
          hint="all sources"
        />
        <StatCard
          label="Review customers"
          value={customerCount ?? 0}
          icon={<Star />}
          accent="#7C3AED"
        />
        <StatCard
          label="Website leads"
          value={leadCount ?? 0}
          icon={<Globe />}
          accent="#0891B2"
        />
      </div>

      <form method="get" className="search-bar">
        <input
          type="text"
          name="q"
          placeholder="Search all contacts by name, email or phone…"
          defaultValue={rawQ}
        />
        <button type="submit" className="btn btn-secondary">
          Search
        </button>
      </form>

      <div className="table-wrap">
        {contacts.length === 0 ? (
          <p className="empty-state">
            {q
              ? "No contacts match that search."
              : "No contacts yet — they appear here automatically as your agents collect them."}
          </p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Contact</th>
                <th>Source</th>
                <th>Note</th>
                <th>Added</th>
              </tr>
            </thead>
            <tbody>
              {contacts.map((c) => (
                <tr key={c.key}>
                  <td style={{ color: "var(--heading)", fontWeight: 600 }}>{c.name}</td>
                  <td>{c.detail}</td>
                  <td>
                    <span className={`badge ${c.source === "review" ? "badge-blue" : "badge-green"}`}>
                      {c.source === "review" ? "review customer" : "website lead"}
                    </span>
                  </td>
                  <td style={{ maxWidth: 280 }}>{c.note ?? "—"}</td>
                  <td>
                    {new Date(c.createdAt).toLocaleDateString("en-IE", {
                      day: "numeric",
                      month: "short",
                    })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <p style={{ fontSize: 12.5, color: "var(--faint)", marginTop: 14 }}>
        The AI Assistant can search this too — just ask &quot;find John&apos;s
        contact details&quot;.
      </p>
    </>
  );
}
