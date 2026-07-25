import Link from "next/link";
import { notFound } from "next/navigation";
import { requireTradesAccount } from "@/lib/trades/data";
import { DocumentView } from "@/components/trades/document-view";
import { DocToolbar } from "@/components/trades/doc-toolbar";

export const metadata = { title: "Document · AutomateIQ Trades" };

export default async function TradesDocumentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { supabase, account } = await requireTradesAccount();

  const { data: doc } = await supabase
    .from("trades_documents")
    .select(
      "id, kind, number, status, issued_at, due_at, subtotal, vat_rate, vat_amount, total, notes, public_token, converted_to, trades_customers(name, email, phone, address)"
    )
    .eq("id", id)
    .maybeSingle();
  if (!doc) notFound();

  const { data: lines } = await supabase
    .from("trades_line_items")
    .select("description, quantity, unit_price, amount, position")
    .eq("document_id", id)
    .order("position");

  const publicUrl = `${(process.env.NEXT_PUBLIC_SITE_URL || "https://automateiq.ie").replace(/\/$/, "")}/trades/doc/${doc.public_token}`;

  return (
    <>
      <div className="page-header trades-noprint">
        <div>
          <p style={{ margin: 0 }}>
            <Link href="/trades">← Dashboard</Link>
          </p>
          <h1 style={{ marginTop: 4 }}>
            {doc.kind === "quote" ? "Quote" : "Invoice"} {doc.number}
          </h1>
        </div>
      </div>

      <DocToolbar
        docId={doc.id}
        kind={doc.kind as "quote" | "invoice"}
        status={doc.status}
        publicUrl={publicUrl}
        convertedTo={doc.converted_to}
      />

      {doc.converted_to && doc.kind === "quote" && (
        <div className="panel panel-block trades-noprint" style={{ marginBottom: 14, borderLeft: "3px solid var(--green, #34d399)" }}>
          <p style={{ margin: 0, fontSize: 13.5 }}>
            This quote was converted to an invoice.{" "}
            <Link href={`/trades/documents/${doc.converted_to}`}>Open the invoice →</Link>
          </p>
        </div>
      )}

      <DocumentView
        account={account}
        customer={doc.trades_customers as never}
        doc={doc as never}
        lines={(lines ?? []) as never}
      />
    </>
  );
}
