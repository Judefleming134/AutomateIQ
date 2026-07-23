import { Users, CalendarDays, Sun, Mail, Phone } from "lucide-react";
import { requireSession } from "@/lib/auth/require-session";
import { createClient } from "@/lib/supabase/server";
import { StatCard } from "@/components/portal/stat-card";
import { escapeLike } from "@/lib/growth/db";

function contactAction(contact: string) {
  const trimmed = contact.trim();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    return { href: `mailto:${trimmed}`, label: "Reply", icon: "mail" as const };
  }
  const digits = trimmed.replace(/[\s\-().]/g, "");
  if (/^\+?\d{6,15}$/.test(digits)) {
    return { href: `tel:${digits}`, label: "Call", icon: "phone" as const };
  }
  return null;
}

export default async function WebsiteAgentLeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  await requireSession();
  const supabase = await createClient();
  const { q = "" } = await searchParams;
  const rawQ = q.trim();
  // Sanitise before the term goes into a PostgREST .or() filter (same guard as
  // the growth prospects search): strip the clause delimiters that would break
  // out of the intended filter (comma/parens), then escape LIKE wildcards — so
  // "O'Brien (plumbing)" or an email with "_" searches literally instead of
  // erroring or matching everything.
  const term = escapeLike(rawQ.replace(/[,()]/g, " ").trim());

  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);

  // RLS scopes all of these to the caller's own business automatically.
  let leadQuery = supabase
    .from("wa_leads")
    .select("id, name, contact, message, created_at")
    .order("created_at", { ascending: false })
    .limit(200);
  if (term) {
    leadQuery = leadQuery.or(
      `name.ilike.%${term}%,contact.ilike.%${term}%`
    );
  }

  const [{ data: leads }, { count: total }, { count: thisWeek }, { count: today }] =
    await Promise.all([
      leadQuery,
      supabase.from("wa_leads").select("id", { count: "exact", head: true }),
      supabase
        .from("wa_leads")
        .select("id", { count: "exact", head: true })
        .gte("created_at", weekAgo),
      supabase
        .from("wa_leads")
        .select("id", { count: "exact", head: true })
        .gte("created_at", dayStart.toISOString()),
    ]);

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Leads</h1>
          <p>Every enquiry submitted through your public page.</p>
        </div>
      </div>

      <div className="stat-grid">
        <StatCard
          label="Total leads"
          value={total ?? 0}
          icon={<Users />}
          accent="#0891B2"
          hint="all time"
        />
        <StatCard
          label="This week"
          value={thisWeek ?? 0}
          icon={<CalendarDays />}
          accent="#3B82F6"
          hint="last 7 days"
        />
        <StatCard
          label="Today"
          value={today ?? 0}
          icon={<Sun />}
          accent="#059669"
        />
      </div>

      <form method="get" className="search-bar">
        <input
          type="text"
          name="q"
          placeholder="Search by name or contact…"
          defaultValue={q}
        />
        <button type="submit" className="btn btn-secondary">
          Search
        </button>
      </form>

      <div className="table-wrap">
        {(leads ?? []).length === 0 ? (
          <p className="empty-state">
            {rawQ
              ? "No leads match that search."
              : "No leads yet — publish your page and share the link to start collecting enquiries."}
          </p>
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Contact</th>
                <th>Message</th>
                <th>Received</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {(leads ?? []).map((lead) => {
                const action = contactAction(lead.contact);
                return (
                  <tr key={lead.id}>
                    <td style={{ color: "var(--heading)", fontWeight: 600 }}>
                      {lead.name}
                    </td>
                    <td>{lead.contact}</td>
                    <td style={{ maxWidth: 340 }}>{lead.message || "—"}</td>
                    <td>
                      {new Date(lead.created_at).toLocaleDateString("en-IE", {
                        day: "numeric",
                        month: "short",
                      })}{" "}
                      {new Date(lead.created_at).toLocaleTimeString("en-IE", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>
                    <td>
                      {action && (
                        <a href={action.href} className="btn btn-secondary btn-sm">
                          {action.icon === "mail" ? (
                            <Mail size={13} />
                          ) : (
                            <Phone size={13} />
                          )}{" "}
                          {action.label}
                        </a>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
