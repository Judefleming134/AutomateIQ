import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { DocumentView } from "@/components/trades/document-view";
import { PublicActions } from "@/components/trades/public-actions";
import { claimDocumentToFinance } from "@/app/tradeos/actions";

export const metadata: Metadata = {
  title: "Your document · AutomateIQ",
  robots: { index: false, follow: false },
};

// Public — a customer opening the link has no session. Read by unguessable
// token with the service-role client (RLS-bypass, exactly like the booking
// page), exposing only what belongs on the document itself.
export default async function PublicTradesDoc({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ paid?: string; claim?: string }>;
}) {
  const { token } = await params;
  const { paid, claim } = await searchParams;
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
      {paid === "1" && (
        <div
          className="panel panel-block trades-noprint"
          style={{ marginBottom: 16, borderLeft: "3px solid var(--green, #34d399)" }}
        >
          <p style={{ margin: 0, fontSize: 14 }}>
            <strong>Payment received — thank you.</strong> Your receipt is on its way by email.
          </p>
        </div>
      )}

      <div className="trades-public-bar">
        <span style={{ fontSize: 13, color: "var(--faint)" }}>
          {doc.kind === "quote" ? "Quote" : "Invoice"} {doc.number}
          {account?.business_name ? ` · ${account.business_name}` : ""}
        </span>
        <PublicActions
          token={token}
          kind={doc.kind as "quote" | "invoice"}
          status={doc.status}
          total={Number(doc.total)}
        />
      </div>

      <DocumentView
        account={(account ?? { business_name: "", trade: null, email: null, phone: null, address: null, vat_number: null }) as never}
        customer={(customer ?? null) as never}
        doc={doc as never}
        lines={(lines ?? []) as never}
      />

      {/* The network hook: a viewer who runs a trade themselves can claim this
          document into their OWN TradeOS Finance — which also connects the two
          businesses so future invoices flow between books automatically. */}
      {await (async () => {
        const supabase = await createClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();
        let viewerIsOwner = false;
        if (user) {
          const { data: acc } = await admin
            .from("trades_accounts")
            .select("id")
            .eq("user_id", user.id)
            .maybeSingle();
          viewerIsOwner = acc?.id === doc.account_id;
        }
        if (viewerIsOwner) return null;
        const loginHref = `/tradeos/login?next=${encodeURIComponent(`/tradeos/doc/${token}`)}`;
        return (
          <div
            className="panel panel-block trades-noprint"
            style={{ marginTop: 20, borderLeft: "3px solid var(--ac2, #3b82f6)" }}
          >
            <p style={{ margin: "0 0 6px", fontSize: 14 }}>
              <strong>
                {account?.business_name || "This business"} runs on TradeOS —
                free quotes, invoicing and finance for trades.
              </strong>
            </p>
            <p style={{ margin: "0 0 12px", fontSize: 13, color: "var(--faint)" }}>
              In a trade yourself? Add this to your own TradeOS Finance — it
              files itself, and once your accounts are linked, future invoices
              between you land in each other&apos;s books automatically.
            </p>
            {claim === "own" && (
              <p style={{ margin: "0 0 10px", fontSize: 13, color: "var(--orange, #fb923c)" }}>
                This document is already yours — nothing to add.
              </p>
            )}
            {claim === "notfound" && (
              <p style={{ margin: "0 0 10px", fontSize: 13, color: "var(--orange, #fb923c)" }}>
                Couldn&apos;t find that document — reload the page and try again.
              </p>
            )}
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
              {user ? (
                <form action={claimDocumentToFinance}>
                  <input type="hidden" name="token" value={token} />
                  <button type="submit" className="btn btn-primary btn-sm">
                    Add this to my TradeOS Finance
                  </button>
                </form>
              ) : (
                <>
                  <Link href={loginHref} className="btn btn-primary btn-sm">
                    Sign up free &amp; link accounts
                  </Link>
                  <Link href={loginHref} className="btn btn-ghost btn-sm">
                    Already on TradeOS? Sign in
                  </Link>
                </>
              )}
            </div>
          </div>
        );
      })()}

      <p style={{ textAlign: "center", marginTop: 26, fontSize: 12, color: "var(--faint)" }}>
        Sent with AutomateIQ
      </p>
    </main>
  );
}
