import Link from "next/link";
import { FilePlus2 } from "lucide-react";
import { requireTradesAccount } from "@/lib/trades/data";

export const metadata = { title: "Customers · TradeIQ" };

type CustomerRow = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  created_at: string;
};

export default async function TradesCustomersPage() {
  const { supabase } = await requireTradesAccount();
  const { data: customers } = await supabase
    .from("trades_customers")
    .select("id, name, email, phone, created_at")
    .order("name");
  const rows = (customers ?? []) as CustomerRow[];

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Customers</h1>
          <p>Everyone you&apos;ve quoted or invoiced. New customers are added as you create quotes.</p>
        </div>
        <Link href="/tradeos/new" className="btn btn-primary">
          <FilePlus2 size={15} /> New quote
        </Link>
      </div>

      <section className="panel panel-block">
        {rows.length === 0 ? (
          <p className="empty-state">
            No customers yet. <Link href="/tradeos/new">Create a quote →</Link> and the customer is saved here automatically.
          </p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Phone</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id}>
                    <td><strong>{c.name}</strong></td>
                    <td style={{ fontSize: 13 }}>{c.email ?? "—"}</td>
                    <td style={{ fontSize: 13 }}>
                      {c.phone ? <a href={`tel:${c.phone.replace(/[^\d+]/g, "")}`}>{c.phone}</a> : "—"}
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <Link href="/tradeos/new" className="btn btn-ghost btn-sm">Quote →</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
