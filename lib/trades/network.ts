import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The TradeIQ network: land a document in ANOTHER account's Finance as a bill
 * and connect the two businesses (both directions). Used by the public
 * "Add to my TradeIQ Finance" claim and by sendDocument's automatic match on
 * the recipient's signup email.
 *
 * Idempotent by construction: the partial unique index on
 * (account_id, linked_document_id) makes a re-claim a no-op, and duplicate
 * connections hit their unique constraint and are ignored — so claiming twice,
 * or claiming after an auto-link, never double-books a bill.
 */
export async function linkDocumentToFinance(
  admin: SupabaseClient,
  documentId: string,
  recipientAccountId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: doc } = await admin
    .from("trades_documents")
    .select("id, account_id, kind, number, status, issued_at, due_at, subtotal, vat_amount, total")
    .eq("id", documentId)
    .maybeSingle();
  if (!doc) return { ok: false, error: "Document not found." };
  if (doc.account_id === recipientAccountId) {
    return { ok: false, error: "That's your own document." };
  }

  const { data: sender } = await admin
    .from("trades_accounts")
    .select("business_name, email")
    .eq("id", doc.account_id)
    .maybeSingle();

  const { error: expErr } = await admin.from("trades_expenses").insert({
    account_id: recipientAccountId,
    direction: "payable",
    counterparty: sender?.business_name || "TradeIQ business",
    counterparty_email: sender?.email ?? null,
    doc_number: doc.number,
    issued_at: doc.issued_at,
    due_at: doc.due_at,
    subtotal: doc.subtotal,
    vat_amount: doc.vat_amount,
    total: doc.total,
    status: doc.status === "paid" ? "paid" : "unpaid",
    paid_at: doc.status === "paid" ? new Date().toISOString() : null,
    summary: `${doc.kind === "quote" ? "Quote" : "Invoice"} ${doc.number} received via TradeIQ`,
    source: "network",
    linked_document_id: doc.id,
  });
  // 23505 = already claimed/linked — success, not an error.
  if (expErr && expErr.code !== "23505") return { ok: false, error: expErr.message };

  for (const [a, b] of [
    [doc.account_id, recipientAccountId],
    [recipientAccountId, doc.account_id],
  ]) {
    const { error } = await admin
      .from("trades_connections")
      .insert({ account_id: a, peer_account_id: b });
    if (error && error.code !== "23505") {
      console.error("TradeIQ connection insert failed:", error.message);
    }
  }
  return { ok: true };
}

/**
 * Paid on the sender's side → paid in every connected book. Best-effort: a
 * failure here never blocks the actual status change.
 */
export async function syncLinkedExpensesPaid(
  admin: SupabaseClient,
  documentId: string
): Promise<void> {
  try {
    await admin
      .from("trades_expenses")
      .update({
        status: "paid",
        paid_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("linked_document_id", documentId);
  } catch (err) {
    console.error("TradeIQ linked-expense paid sync failed (non-fatal):", err);
  }
}
