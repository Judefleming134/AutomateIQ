"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireTradesAccount } from "@/lib/trades/data";
import {
  computeTotals,
  nextDocumentNumber,
  dueDateFrom,
  type DocumentKind,
} from "@/lib/trades/core";

const lineSchema = z.object({
  description: z.string().trim().max(300),
  quantity: z.coerce.number().finite(),
  unitPrice: z.coerce.number().finite(),
});

const createSchema = z.object({
  customerId: z.string().uuid().optional().or(z.literal("")),
  customerName: z.string().trim().max(160).optional().or(z.literal("")),
  customerEmail: z.string().trim().email().max(200).optional().or(z.literal("")),
  customerPhone: z.string().trim().max(60).optional().or(z.literal("")),
  customerAddress: z.string().trim().max(400).optional().or(z.literal("")),
  notes: z.string().trim().max(2000).optional().or(z.literal("")),
  items: z.string(), // JSON array
});

/**
 * Create a quote from the editor. Finds/creates the customer, computes totals
 * against the account's VAT rate, assigns the next Q- number and stores the
 * document + line items. Redirects to the new document on success.
 */
export async function createDocument(
  _prev: { error?: string } | undefined,
  formData: FormData
): Promise<{ error?: string } | undefined> {
  const { supabase, account } = await requireTradesAccount();

  const parsed = createSchema.safeParse({
    customerId: formData.get("customerId") ?? "",
    customerName: formData.get("customerName") ?? "",
    customerEmail: formData.get("customerEmail") ?? "",
    customerPhone: formData.get("customerPhone") ?? "",
    customerAddress: formData.get("customerAddress") ?? "",
    notes: formData.get("notes") ?? "",
    items: String(formData.get("items") ?? "[]"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const d = parsed.data;

  let rawItems: unknown;
  try {
    rawItems = JSON.parse(d.items);
  } catch {
    return { error: "Could not read the line items." };
  }
  const itemsParsed = z.array(lineSchema).safeParse(rawItems);
  if (!itemsParsed.success) return { error: "Check the line items and try again." };
  const items = itemsParsed.data.filter(
    (it) => it.description.trim() || it.unitPrice > 0
  );
  if (items.length === 0) return { error: "Add at least one line with a price." };

  // Resolve the customer: an existing id, or create one from the typed fields.
  let customerId: string | null = d.customerId && d.customerId !== "" ? d.customerId : null;
  if (!customerId) {
    if (!d.customerName || !d.customerName.trim()) {
      return { error: "Add a customer name (or pick an existing customer)." };
    }
    const { data: cust, error: custErr } = await supabase
      .from("trades_customers")
      .insert({
        account_id: account.id,
        name: d.customerName.trim(),
        email: d.customerEmail || null,
        phone: d.customerPhone || null,
        address: d.customerAddress || null,
      })
      .select("id")
      .single();
    if (custErr || !cust) return { error: custErr?.message ?? "Could not save the customer." };
    customerId = cust.id;
  }

  const totals = computeTotals(items, account.vat_rate);
  const { number, nextSeq } = nextDocumentNumber("quote", account.quote_seq);
  const today = new Date();
  const issued = today.toISOString().slice(0, 10);

  const { data: doc, error: docErr } = await supabase
    .from("trades_documents")
    .insert({
      account_id: account.id,
      customer_id: customerId,
      kind: "quote" as DocumentKind,
      number,
      status: "draft",
      notes: d.notes || null,
      subtotal: totals.subtotal,
      vat_rate: account.vat_rate,
      vat_amount: totals.vatAmount,
      total: totals.total,
      issued_at: issued,
      due_at: dueDateFrom(today, account.payment_terms_days),
    })
    .select("id")
    .single();
  if (docErr || !doc) return { error: docErr?.message ?? "Could not create the quote." };

  const rows = totals.lines.map((l, i) => ({
    document_id: doc.id,
    description: l.description.trim(),
    quantity: l.quantity,
    unit_price: l.unitPrice,
    amount: l.amount,
    position: i,
  }));
  const { error: liErr } = await supabase.from("trades_line_items").insert(rows);
  if (liErr) return { error: liErr.message };

  // Advance the per-account quote counter so the next number is unique.
  await supabase.from("trades_accounts").update({ quote_seq: nextSeq }).eq("id", account.id);

  revalidatePath("/trades");
  redirect(`/trades/documents/${doc.id}`);
}

const settingsSchema = z.object({
  businessName: z.string().trim().min(1, "Business name is required").max(160),
  trade: z.string().trim().max(80).optional().or(z.literal("")),
  email: z.string().trim().email().max(200).optional().or(z.literal("")),
  phone: z.string().trim().max(60).optional().or(z.literal("")),
  address: z.string().trim().max(400).optional().or(z.literal("")),
  vatRate: z.coerce.number().min(0).max(100),
  vatNumber: z.string().trim().max(40).optional().or(z.literal("")),
  paymentTermsDays: z.coerce.number().int().min(0).max(120),
});

/** Save the tradesperson's business profile (used on every quote/invoice). */
export async function saveSettings(
  _prev: { error?: string; ok?: boolean } | undefined,
  formData: FormData
): Promise<{ error?: string; ok?: boolean }> {
  const { supabase, account } = await requireTradesAccount();
  const parsed = settingsSchema.safeParse({
    businessName: formData.get("businessName"),
    trade: formData.get("trade") ?? "",
    email: formData.get("email") ?? "",
    phone: formData.get("phone") ?? "",
    address: formData.get("address") ?? "",
    vatRate: formData.get("vatRate") ?? 0,
    vatNumber: formData.get("vatNumber") ?? "",
    paymentTermsDays: formData.get("paymentTermsDays") ?? 14,
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  const s = parsed.data;

  const { error } = await supabase
    .from("trades_accounts")
    .update({
      business_name: s.businessName,
      trade: s.trade || null,
      email: s.email || null,
      phone: s.phone || null,
      address: s.address || null,
      vat_rate: s.vatRate,
      vat_number: s.vatNumber || null,
      payment_terms_days: s.paymentTermsDays,
    })
    .eq("id", account.id);
  if (error) return { error: error.message };

  revalidatePath("/trades/settings");
  revalidatePath("/trades");
  return { ok: true };
}

/** Convert an accepted/sent quote into an invoice (new INV- number, links back). */
export async function convertToInvoice(
  _prev: { error?: string } | undefined,
  formData: FormData
): Promise<{ error?: string } | undefined> {
  const { supabase, account } = await requireTradesAccount();
  const quoteId = String(formData.get("id") ?? "");
  if (!quoteId) return { error: "Missing quote." };

  const { data: quote } = await supabase
    .from("trades_documents")
    .select("id, kind, customer_id, notes, subtotal, vat_rate, vat_amount, total, converted_to")
    .eq("id", quoteId)
    .maybeSingle();
  if (!quote || quote.kind !== "quote") return { error: "That isn't a quote." };
  if (quote.converted_to) redirect(`/trades/documents/${quote.converted_to}`);

  const { data: lines } = await supabase
    .from("trades_line_items")
    .select("description, quantity, unit_price, amount, position")
    .eq("document_id", quoteId)
    .order("position");

  const { number, nextSeq } = nextDocumentNumber("invoice", account.invoice_seq);
  const today = new Date();
  const { data: inv, error: invErr } = await supabase
    .from("trades_documents")
    .insert({
      account_id: account.id,
      customer_id: quote.customer_id,
      kind: "invoice",
      number,
      status: "draft",
      notes: quote.notes,
      subtotal: quote.subtotal,
      vat_rate: quote.vat_rate,
      vat_amount: quote.vat_amount,
      total: quote.total,
      issued_at: today.toISOString().slice(0, 10),
      due_at: dueDateFrom(today, account.payment_terms_days),
    })
    .select("id")
    .single();
  if (invErr || !inv) return { error: invErr?.message ?? "Could not create the invoice." };

  if (lines && lines.length > 0) {
    await supabase.from("trades_line_items").insert(
      lines.map((l) => ({ ...l, document_id: inv.id }))
    );
  }
  await supabase.from("trades_accounts").update({ invoice_seq: nextSeq }).eq("id", account.id);
  await supabase.from("trades_documents").update({ converted_to: inv.id }).eq("id", quoteId);

  revalidatePath("/trades");
  redirect(`/trades/documents/${inv.id}`);
}

const STATUSES = ["draft", "sent", "accepted", "declined", "paid", "void"] as const;

/** Move a document's status (mark sent / accepted / paid / void). */
export async function setDocumentStatus(
  _prev: { error?: string } | undefined,
  formData: FormData
): Promise<{ error?: string } | undefined> {
  const { supabase } = await requireTradesAccount();
  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!id || !(STATUSES as readonly string[]).includes(status)) {
    return { error: "Invalid update." };
  }
  const patch: Record<string, unknown> = { status, updated_at: new Date().toISOString() };
  if (status === "paid") patch.paid_at = new Date().toISOString();
  const { error } = await supabase.from("trades_documents").update(patch).eq("id", id);
  if (error) return { error: error.message };
  revalidatePath(`/trades/documents/${id}`);
  revalidatePath("/trades");
  return undefined;
}
