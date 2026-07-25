import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { createAdminClient } from "@/lib/supabase/admin";
import { DocumentView } from "@/components/trades/document-view";
import { PublicActions } from "@/components/trades/public-actions";

export const metadata: Metadata = {
  title: "Your document · AutomateIQ",
  robots: { index: false, follow: false },
};

// Public — a customer opening the link has no session. Read by unguessable
// token with the service-role client (RLS-bypass, exactly like the booking
// page), exposing only what belongs on the document itself.
export default async function PublicTradesDoc({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const admin = createAdminClient();

  const { data: doc } = await admin
    .from("trades_documents")
    .select(
      "id, kind, number, status, issued_at, due_at, subtotal, vat_rate, vat_amount, total, notes, account_id, customer_id"
    )
    .eq("public_token", token)
    .maybeSingle();
  if (!doc) notFound();

  const [{ data: account }, { data: customer }, { data: lines }] = await Promise.all([
    admin
      .from("trades_accounts")
      .select("business_name, trade, email, phone, address, vat_number")
      .eq("id", doc.account_id)
      .maybeSingle(),
    doc.customer_id
      ? admin
          .from("trades_customers")
          .select("name, email, phone, address")
          .eq("id", doc.customer_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    admin
      .from("trades_line_items")
      .select("description, quantity, unit_price, amount, position")
      .eq("document_id", doc.id)
      .order("position"),
  ]);

  return (
    <main className="trades-public">
      <div className="trades-public-bar">
        <span style={{ fontSize: 13, color: "var(--faint)" }}>
          {doc.kind === "quote" ? "Quote" : "Invoice"} {doc.number}
          {account?.business_name ? ` · ${account.business_name}` : ""}
        </span>
        <PublicActions token={token} kind={doc.kind as "quote" | "invoice"} status={doc.status} />
      </div>

      <DocumentView
        account={(account ?? { business_name: "", trade: null, email: null, phone: null, address: null, vat_number: null }) as never}
        customer={(customer ?? null) as never}
        doc={doc as never}
        lines={(lines ?? []) as never}
      />

      <p style={{ textAlign: "center", marginTop: 26, fontSize: 12, color: "var(--faint)" }}>
        Sent with AutomateIQ
      </p>
    </main>
  );
}
