"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { getResendClient, getFromAddress } from "@/lib/email/resend";
import { isStripeConfigured, createInvoiceCheckoutSession } from "@/lib/billing/stripe";
import { aiComplete } from "@/lib/ai/complete";
import { createClient } from "@/lib/supabase/server";
import { requireTradesAccount } from "@/lib/trades/data";
import { linkDocumentToFinance, syncLinkedExpensesPaid } from "@/lib/trades/network";
import { formatEuro } from "@/lib/trades/core";
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

  revalidatePath("/tradeos");
  redirect(`/tradeos/documents/${doc.id}`);
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

  revalidatePath("/tradeos/settings");
  revalidatePath("/tradeos");
  revalidatePath("/finance/settings");
  revalidatePath("/finance");
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
  if (quote.converted_to) redirect(`/tradeos/documents/${quote.converted_to}`);

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
  // Claim the conversion atomically: only the first click gets to stamp
  // converted_to. A double-click raced past the read above and created TWO
  // invoices — the loser now deletes its orphan draft and lands on the winner.
  const { data: claimed } = await supabase
    .from("trades_documents")
    .update({ converted_to: inv.id })
    .eq("id", quoteId)
    .is("converted_to", null)
    .select("id");
  if (!claimed || claimed.length === 0) {
    await supabase.from("trades_line_items").delete().eq("document_id", inv.id);
    await supabase.from("trades_documents").delete().eq("id", inv.id).eq("status", "draft");
    const { data: winner } = await supabase
      .from("trades_documents")
      .select("converted_to")
      .eq("id", quoteId)
      .maybeSingle();
    redirect(`/tradeos/documents/${winner?.converted_to ?? quoteId}`);
  }

  revalidatePath("/tradeos");
  redirect(`/tradeos/documents/${inv.id}`);
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
  // Paid here → paid in any connected account's Finance too (network bills
  // belong to the OTHER account, so this goes through the admin client).
  if (status === "paid") await syncLinkedExpensesPaid(createAdminClient(), id);
  revalidatePath(`/tradeos/documents/${id}`);
  revalidatePath("/tradeos");
  return undefined;
}

function siteUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL || "https://automateiq.ie").replace(/\/$/, "");
}

/**
 * Email the customer a link to the public quote/invoice page, replying to the
 * tradesperson so responses land with them. Marks the document 'sent'. The
 * document is already saved, so a mail failure reports but never loses it.
 */
export async function sendDocument(
  _prev: { error?: string; ok?: boolean } | undefined,
  formData: FormData
): Promise<{ error?: string; ok?: boolean }> {
  const { supabase, account } = await requireTradesAccount();
  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "Missing document." };

  const { data: doc } = await supabase
    .from("trades_documents")
    .select("id, kind, number, total, public_token, trades_customers(name, email)")
    .eq("id", id)
    .maybeSingle();
  if (!doc) return { error: "Document not found." };
  const customer = doc.trades_customers as unknown as { name: string; email: string | null } | null;
  if (!customer?.email) {
    return { error: "This customer has no email. Add one, or send them the link yourself." };
  }

  const label = doc.kind === "quote" ? "Quote" : "Invoice";
  const from = account.business_name || "TradeIQ";
  const link = `${siteUrl()}/tradeos/doc/${doc.public_token}`;
  const text = [
    `Hi ${customer.name || "there"},`,
    "",
    `Please find your ${label.toLowerCase()} ${doc.number} for ${formatEuro(Number(doc.total))}.`,
    "",
    `View it here: ${link}`,
    "",
    `Thanks,`,
    from,
  ].join("\n");

  try {
    const resend = getResendClient();
    const { error } = await resend.emails.send({
      from: getFromAddress(),
      to: customer.email,
      replyTo: account.email || undefined,
      subject: `${label} ${doc.number} from ${from}`,
      text,
    });
    if (error) return { error: `Couldn't send the email: ${error.message}` };
  } catch (err) {
    return { error: `Couldn't send the email: ${err instanceof Error ? err.message : "unknown"}` };
  }

  await supabase
    .from("trades_documents")
    .update({ status: "sent", updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "draft");

  // NETWORK: if the recipient's email belongs to another TradeIQ account, the
  // document lands straight in THEIR Finance and the two businesses connect —
  // no scanning on their side. Best-effort; the send already succeeded.
  try {
    const admin = createAdminClient();
    const pattern = customer.email.replace(/([%_\\])/g, "\\$1");
    const { data: peer } = await admin
      .from("trades_accounts")
      .select("id")
      .ilike("email", pattern)
      .neq("id", account.id)
      .limit(1)
      .maybeSingle();
    if (peer) await linkDocumentToFinance(admin, id, peer.id);
  } catch (err) {
    console.error("TradeIQ network auto-link failed (non-fatal):", err);
  }

  revalidatePath(`/tradeos/documents/${id}`);
  revalidatePath("/tradeos");
  return { ok: true };
}

/**
 * Public claim from the customer-facing document page: "I'm on TradeIQ too —
 * add this to my Finance." Signs the viewer in first if needed (and signup
 * bootstraps their account), then links the document + connects the accounts.
 * Errors round-trip as ?claim= codes on the public page.
 */
export async function claimDocumentToFinance(formData: FormData): Promise<void> {
  const token = String(formData.get("token") ?? "");
  if (!token) redirect("/tradeos");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect(`/tradeos/login?next=${encodeURIComponent(`/tradeos/doc/${token}`)}`);
  }
  const { account } = await requireTradesAccount();
  const admin = createAdminClient();
  const { data: doc } = await admin
    .from("trades_documents")
    .select("id")
    .eq("public_token", token)
    .maybeSingle();
  if (!doc) redirect(`/tradeos/doc/${token}?claim=notfound`);
  const res = await linkDocumentToFinance(admin, doc!.id, account.id);
  if (!res.ok) redirect(`/tradeos/doc/${token}?claim=own`);
  redirect("/finance?claimed=1");
}

/**
 * Public accept, from the customer-facing page — no session, so it looks the
 * document up by its unguessable token with the service-role client and only
 * moves a quote from draft/sent to accepted. Never touches invoices.
 */
export async function acceptQuoteByToken(
  _prev: { error?: string; ok?: boolean } | undefined,
  formData: FormData
): Promise<{ error?: string; ok?: boolean }> {
  const token = String(formData.get("token") ?? "");
  if (!token) return { error: "Missing token." };
  const admin = createAdminClient();
  const { data: doc } = await admin
    .from("trades_documents")
    .select("id, kind, status")
    .eq("public_token", token)
    .maybeSingle();
  if (!doc || doc.kind !== "quote") return { error: "Not found." };
  if (!["draft", "sent"].includes(doc.status)) return { ok: true }; // already actioned
  const { error } = await admin
    .from("trades_documents")
    .update({ status: "accepted", updated_at: new Date().toISOString() })
    .eq("id", doc.id);
  if (error) return { error: error.message };
  revalidatePath(`/tradeos/doc/${token}`);
  return { ok: true };
}

/**
 * Public "pay online" — the customer pays a specific invoice by its token.
 * Builds a one-off Stripe Checkout for that invoice's exact total and sends
 * them there. The invoice is only marked paid by the signature-verified
 * webhook (never trusted from the browser). Inert until STRIPE_SECRET_KEY is
 * set, so it fails politely rather than erroring.
 */
export async function startInvoicePayment(
  _prev: { error?: string } | undefined,
  formData: FormData
): Promise<{ error?: string } | undefined> {
  const token = String(formData.get("token") ?? "");
  if (!token) return { error: "Missing document." };
  if (!isStripeConfigured()) {
    return { error: "Online payment isn't switched on yet — pay by the usual method." };
  }
  const admin = createAdminClient();
  const { data: doc } = await admin
    .from("trades_documents")
    .select("id, kind, number, status, total, currency, trades_customers(email)")
    .eq("public_token", token)
    .maybeSingle();
  if (!doc || doc.kind !== "invoice") return { error: "This isn't a payable invoice." };
  if (doc.status === "paid") redirect(`/tradeos/doc/${token}?paid=1`);
  if (doc.status === "void") return { error: "This invoice has been voided." };

  const cents = Math.round(Number(doc.total) * 100);
  if (cents < 50) return { error: "Amount is too small to charge online." };

  const customer = doc.trades_customers as unknown as { email: string | null } | null;
  let url: string;
  try {
    const res = await createInvoiceCheckoutSession({
      amountCents: cents,
      currency: doc.currency || "eur",
      label: `Invoice ${doc.number}`,
      customerEmail: customer?.email ?? null,
      successUrl: `${siteUrl()}/tradeos/doc/${token}?paid=1`,
      cancelUrl: `${siteUrl()}/tradeos/doc/${token}`,
      metadata: { tradeos_document_id: doc.id },
    });
    url = res.url;
  } catch (err) {
    return { error: `Couldn't start the payment: ${err instanceof Error ? err.message : "unknown"}` };
  }
  redirect(url); // to Stripe's hosted checkout
}

/* ══════════════════════ Scan & Finance ══════════════════════ */

export type ScannedFields = {
  direction: "payable" | "receivable";
  counterparty: string;
  counterparty_email: string;
  doc_number: string;
  category: string;
  issued_at: string;
  due_at: string;
  subtotal: number;
  vat_amount: number;
  total: number;
  currency: string;
  summary: string;
  confidence: string;
};

const SCAN_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
const SCAN_MAX_BYTES = 4_500_000; // stays inside both providers' inline limits

const asDate = (v: unknown): string =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "";
const asNum = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : 0;
};

/**
 * Read a photographed/scanned invoice with the AI and return the extracted
 * fields for review — nothing is saved here; the tradesperson always confirms
 * what the scanner read before it becomes a record (transparency by design).
 */
export async function scanInvoice(
  _prev: { error?: string; fields?: ScannedFields; duplicateWarning?: string } | undefined,
  formData: FormData
): Promise<{ error?: string; fields?: ScannedFields; duplicateWarning?: string }> {
  const { supabase, account } = await requireTradesAccount();
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Choose a photo or PDF of the invoice first." };
  }
  if (!SCAN_TYPES.includes(file.type)) {
    return { error: "Use a JPG, PNG, WebP photo or a PDF (iPhone: change camera format to 'Most compatible', or screenshot the invoice)." };
  }
  if (file.size > SCAN_MAX_BYTES) {
    return { error: "That file is over 4.5MB — take the photo a bit smaller or screenshot it." };
  }
  const dataBase64 = Buffer.from(await file.arrayBuffer()).toString("base64");

  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      direction: { type: "string", enum: ["payable", "receivable"] },
      counterparty: { type: "string" },
      counterparty_email: { type: "string" },
      doc_number: { type: "string" },
      category: { type: "string" },
      issued_at: { type: "string" },
      due_at: { type: "string" },
      subtotal: { type: "number" },
      vat_amount: { type: "number" },
      total: { type: "number" },
      currency: { type: "string" },
      summary: { type: "string" },
      confidence: { type: "string", enum: ["high", "medium", "low"] },
    },
    required: [
      "direction", "counterparty", "counterparty_email", "doc_number",
      "category", "issued_at", "due_at", "subtotal", "vat_amount", "total",
      "currency", "summary", "confidence",
    ],
  };

  let raw: string;
  try {
    raw = await aiComplete(
      [
        "You read photographed or scanned invoices/receipts for an Irish tradesperson's bookkeeping. Extract ONLY what is actually on the document — never invent numbers. Use empty string for anything you cannot read, 0 for unknown amounts.",
        `The tradesperson's business is "${account.business_name || "unknown"}". If the document was issued TO that business (they must pay it) direction is "payable"; if it was issued BY that business to a customer, direction is "receivable". Default to "payable" when unsure.`,
        "Dates as YYYY-MM-DD. category is one or two words (e.g. materials, fuel, insurance, tools, subcontractor). summary is one short line saying what the document is for. Respond with ONLY the JSON object.",
      ].join("\n"),
      "Read this document and return the JSON.",
      1500,
      {
        json: true,
        effort: "low",
        timeoutMs: 50_000,
        schema,
        attachment: { mimeType: file.type, dataBase64 },
      }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "";
    if (msg === "NO_PROVIDER") return { error: "No AI key is configured yet." };
    return { error: "Couldn't read the document — try a clearer, straight-on photo." };
  }

  let parsed: Record<string, unknown>;
  try {
    const j = raw.trim().replace(/^```json\s*/i, "").replace(/```\s*$/i, "");
    parsed = JSON.parse(j) as Record<string, unknown>;
  } catch {
    return { error: "The scanner returned something unreadable — try again." };
  }

  const fields: ScannedFields = {
    direction: parsed.direction === "receivable" ? "receivable" : "payable",
    counterparty: String(parsed.counterparty ?? "").slice(0, 160),
    counterparty_email: String(parsed.counterparty_email ?? "").slice(0, 200),
    doc_number: String(parsed.doc_number ?? "").slice(0, 80),
    category: String(parsed.category ?? "").slice(0, 60),
    issued_at: asDate(parsed.issued_at),
    due_at: asDate(parsed.due_at),
    subtotal: asNum(parsed.subtotal),
    vat_amount: asNum(parsed.vat_amount),
    total: asNum(parsed.total),
    currency: String(parsed.currency || "EUR").slice(0, 8).toUpperCase(),
    summary: String(parsed.summary ?? "").slice(0, 300),
    confidence: ["high", "medium", "low"].includes(String(parsed.confidence)) ? String(parsed.confidence) : "low",
  };

  // Duplicate guard (the enterprise-AP staple): same counterparty + same total
  // already on file, issued within a week of this one → warn BEFORE saving.
  // Non-blocking — the reviewer decides; the warning just stops a silent
  // double-booking.
  let duplicateWarning: string | undefined;
  if (fields.counterparty && fields.total > 0) {
    let q = supabase
      .from("trades_expenses")
      .select("doc_number, issued_at, total")
      .ilike("counterparty", fields.counterparty.replace(/([%_\\])/g, "\\$1"))
      .eq("total", fields.total)
      .limit(1);
    if (fields.issued_at) {
      const d = new Date(`${fields.issued_at}T00:00:00Z`);
      const lo = new Date(d.getTime() - 7 * 86_400_000).toISOString().slice(0, 10);
      const hi = new Date(d.getTime() + 7 * 86_400_000).toISOString().slice(0, 10);
      q = q.gte("issued_at", lo).lte("issued_at", hi);
    }
    const { data: dupe } = await q.maybeSingle();
    if (dupe) {
      duplicateWarning = `Possible duplicate: you already have a ${formatEuro(Number(dupe.total))} bill from ${fields.counterparty}${dupe.issued_at ? ` issued ${dupe.issued_at}` : ""}${dupe.doc_number ? ` (ref ${dupe.doc_number})` : ""}. Check before saving.`;
    }
  }
  return { fields, duplicateWarning };
}

const expenseSchema = z.object({
  direction: z.enum(["payable", "receivable"]),
  counterparty: z.string().trim().min(1, "Who is this from / to?").max(160),
  counterpartyEmail: z.string().trim().email().max(200).optional().or(z.literal("")),
  docNumber: z.string().trim().max(80).optional().or(z.literal("")),
  category: z.string().trim().max(60).optional().or(z.literal("")),
  issuedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")),
  dueAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")),
  subtotal: z.coerce.number().min(0),
  vatAmount: z.coerce.number().min(0),
  total: z.coerce.number().min(0),
  summary: z.string().trim().max(300).optional().or(z.literal("")),
  extracted: z.string().max(20000).optional().or(z.literal("")),
});

/** Save the reviewed scan as a finance record. Returns the id so the flow can
 *  move straight to "draft the email" without losing context. */
export async function saveScannedExpense(
  _prev: { error?: string; savedId?: string } | undefined,
  formData: FormData
): Promise<{ error?: string; savedId?: string }> {
  const { supabase, account } = await requireTradesAccount();
  const parsed = expenseSchema.safeParse({
    direction: formData.get("direction"),
    counterparty: formData.get("counterparty"),
    counterpartyEmail: formData.get("counterpartyEmail") ?? "",
    docNumber: formData.get("docNumber") ?? "",
    category: formData.get("category") ?? "",
    issuedAt: formData.get("issuedAt") ?? "",
    dueAt: formData.get("dueAt") ?? "",
    subtotal: formData.get("subtotal") ?? 0,
    vatAmount: formData.get("vatAmount") ?? 0,
    total: formData.get("total") ?? 0,
    summary: formData.get("summary") ?? "",
    extracted: formData.get("extracted") ?? "",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the fields." };
  const d = parsed.data;
  if (d.total <= 0) return { error: "The total must be above zero." };

  let extractedJson: unknown = null;
  if (d.extracted) {
    try { extractedJson = JSON.parse(d.extracted); } catch { extractedJson = null; }
  }

  const { data: row, error } = await supabase
    .from("trades_expenses")
    .insert({
      account_id: account.id,
      direction: d.direction,
      counterparty: d.counterparty,
      counterparty_email: d.counterpartyEmail || null,
      doc_number: d.docNumber || null,
      category: d.category || null,
      issued_at: d.issuedAt || null,
      due_at: d.dueAt || null,
      subtotal: d.subtotal,
      vat_amount: d.vatAmount,
      total: d.total,
      summary: d.summary || null,
      extracted: extractedJson,
      source: "scan",
    })
    .select("id")
    .single();
  if (error || !row) return { error: error?.message ?? "Could not save it." };

  revalidatePath("/tradeos/finance");
  revalidatePath("/finance");
  return { savedId: row.id };
}

/** Mark a bill paid / unpaid / disputed from the Finance page. */
export async function setExpenseStatus(
  _prev: { error?: string } | undefined,
  formData: FormData
): Promise<{ error?: string } | undefined> {
  const { supabase } = await requireTradesAccount();
  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "");
  if (!id || !["unpaid", "paid", "disputed"].includes(status)) return { error: "Invalid update." };
  const patch: Record<string, unknown> = { status, updated_at: new Date().toISOString() };
  patch.paid_at = status === "paid" ? new Date().toISOString() : null;
  const { error } = await supabase.from("trades_expenses").update(patch).eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/tradeos/finance");
  revalidatePath("/finance");
  return undefined;
}

const EMAIL_INTENTS = {
  remittance: "Tell the supplier this bill is being paid: confirm the invoice number and amount, say payment is being made by bank transfer and the remittance follows, thank them.",
  query: "Politely QUERY this bill before paying: ask them to confirm/itemise the charge, flag that it looks higher than expected, ask for a corrected invoice if anything is off. Firm but friendly — you want to keep the relationship.",
  chase: "Politely chase the customer for payment of this invoice: reference the invoice number, amount and due date, ask when payment will be made, offer to resend the invoice.",
  send: "Send/cover-note this invoice to the customer: reference the invoice number and amount, say how to pay and by when, thank them for the business.",
} as const;

/**
 * Draft the email for a scanned record — remittance/query to a supplier, or
 * send/chase to a customer. Returns subject + body for the tradesperson to
 * review and send from their OWN email (their relationship, their address —
 * nothing is auto-sent).
 */
export async function draftExpenseEmail(
  _prev: { error?: string; subject?: string; body?: string; to?: string } | undefined,
  formData: FormData
): Promise<{ error?: string; subject?: string; body?: string; to?: string }> {
  const { supabase, account } = await requireTradesAccount();
  const id = String(formData.get("id") ?? "");
  const intent = String(formData.get("intent") ?? "") as keyof typeof EMAIL_INTENTS;
  if (!id || !EMAIL_INTENTS[intent]) return { error: "Invalid request." };

  const { data: exp } = await supabase
    .from("trades_expenses")
    .select("counterparty, counterparty_email, doc_number, category, issued_at, due_at, total, summary, direction, status")
    .eq("id", id)
    .maybeSingle();
  if (!exp) return { error: "Record not found." };

  let raw: string;
  try {
    raw = await aiComplete(
      [
        `You write short, plain-spoken business emails for ${account.business_name || "an Irish tradesperson"}${account.trade ? ` (${account.trade})` : ""}. One busy professional writing to another: specific, courteous, no fluff, no invented facts — use ONLY the details given. Sign off with the business name${account.phone ? ` and phone ${account.phone}` : ""}.`,
        'Respond with ONLY JSON: {"subject": "...", "body": "..."} — body 60-140 words.',
      ].join("\n"),
      [
        `TASK: ${EMAIL_INTENTS[intent]}`,
        `DETAILS: counterparty ${exp.counterparty || "unknown"}; invoice/ref ${exp.doc_number || "n/a"}; amount ${formatEuro(Number(exp.total))}; issued ${exp.issued_at ?? "n/a"}; due ${exp.due_at ?? "n/a"}; about: ${exp.summary || exp.category || "n/a"}.`,
      ].join("\n"),
      900,
      { json: true, effort: "low", timeoutMs: 45_000 }
    );
  } catch {
    return { error: "Couldn't draft it just now — try again in a minute." };
  }
  try {
    const j = JSON.parse(raw.trim().replace(/^```json\s*/i, "").replace(/```\s*$/i, "")) as { subject?: string; body?: string };
    if (!j.subject || !j.body) return { error: "Draft came back empty — try again." };
    return {
      subject: String(j.subject).slice(0, 200),
      body: String(j.body).slice(0, 4000),
      // Echo the recipient so "Open in my email app" pre-fills the To: field.
      to: exp.counterparty_email ?? undefined,
    };
  } catch {
    return { error: "Draft came back unreadable — try again." };
  }
}

/**
 * The finance audit: reads the account's real records (expenses + invoices)
 * and writes ranked, hedged cost-saving recommendations. Read-only — it
 * changes nothing; complete transparency is the whole point.
 */
export async function runFinanceAudit(
  _prev: { error?: string; report?: string } | undefined,
  _formData: FormData
): Promise<{ error?: string; report?: string }> {
  const { supabase, account } = await requireTradesAccount();

  const [{ data: expenses }, { data: invoices }] = await Promise.all([
    supabase
      .from("trades_expenses")
      .select("direction, counterparty, category, issued_at, due_at, total, status")
      .order("created_at", { ascending: false })
      .limit(200),
    supabase
      .from("trades_documents")
      .select("kind, status, total, issued_at")
      .eq("kind", "invoice")
      .order("created_at", { ascending: false })
      .limit(200),
  ]);

  const bills = (expenses ?? []).filter((e) => e.direction === "payable");
  if (bills.length === 0) {
    return { error: "No bills tracked yet — scan a few supplier invoices first, then run the audit." };
  }
  const lines = bills.map(
    (e) => `${e.issued_at ?? "?"} | ${e.counterparty} | ${e.category ?? "?"} | €${e.total} | ${e.status}`
  );
  const income = (invoices ?? []).map((i) => `${i.issued_at ?? "?"} | €${i.total} | ${i.status}`);

  let report: string;
  try {
    report = await aiComplete(
      [
        `You are a blunt, honest bookkeeping analyst for ${account.business_name || "an Irish trades business"}${account.trade ? ` (${account.trade})` : ""}. You see their real bills and invoices below.`,
        "Write a short cost-saving audit in plain text (no markdown tables): 1) WHERE THE MONEY GOES — top spend areas with € totals from the data. 2) SAVINGS OPPORTUNITIES — ranked, each with the evidence line(s) and a HEDGED estimated saving (\"typically 5-15%\" style, never a promise). Flag repeat suppliers worth renegotiating, rising or duplicate charges, and anything unpaid past due. 3) CASH POSITION — money owed to them vs bills to pay. 4) THREE ACTIONS THIS WEEK — concrete, small. Use ONLY the data given; if the data is thin, say so.",
      ].join("\n"),
      [
        `BILLS (date | supplier | category | total | status):\n${lines.join("\n")}`,
        `THEIR INVOICES OUT (date | total | status):\n${income.join("\n") || "none recorded"}`,
      ].join("\n\n"),
      1600,
      { effort: "low", timeoutMs: 50_000 }
    );
  } catch {
    return { error: "The audit couldn't run just now — try again in a minute." };
  }
  return { report: report.trim() };
}

/* ══════════════════════ Finance product: balance + budgets ══════════════════════ */

/**
 * Set the current bank balance the 13-week forecast starts from. Manual for
 * now — the open-banking feed will replace this; the set-at stamp keeps the
 * staleness honest on screen.
 */
export async function setBankBalance(
  _prev: { error?: string; ok?: boolean } | undefined,
  formData: FormData
): Promise<{ error?: string; ok?: boolean }> {
  const { supabase, account } = await requireTradesAccount();
  const raw = String(formData.get("balance") ?? "").replace(/[€,\s]/g, "");
  const balance = Number(raw);
  if (!Number.isFinite(balance) || Math.abs(balance) > 99_000_000) {
    return { error: "Enter the balance as a number, e.g. 12500.50" };
  }
  const { error } = await supabase
    .from("trades_accounts")
    .update({
      bank_balance: Math.round(balance * 100) / 100,
      bank_balance_set_at: new Date().toISOString(),
    })
    .eq("id", account.id);
  if (error) return { error: error.message };
  revalidatePath("/finance/forecast");
  revalidatePath("/finance/bank");
  revalidatePath("/finance");
  return { ok: true };
}

/** Create/update a monthly budget for a category (upsert by category name). */
export async function saveBudget(
  _prev: { error?: string; ok?: boolean } | undefined,
  formData: FormData
): Promise<{ error?: string; ok?: boolean }> {
  const { supabase, account } = await requireTradesAccount();
  const category = String(formData.get("category") ?? "").trim().toLowerCase().slice(0, 60);
  const limit = Number(String(formData.get("limit") ?? "").replace(/[€,\s]/g, ""));
  if (!category) return { error: "Give the budget a category (e.g. materials)." };
  if (!Number.isFinite(limit) || limit <= 0) return { error: "Set a monthly limit above zero." };
  const { error } = await supabase
    .from("trades_budgets")
    .upsert(
      { account_id: account.id, category, monthly_limit: Math.round(limit * 100) / 100 },
      { onConflict: "account_id,category" }
    );
  if (error) return { error: error.message };
  revalidatePath("/finance/budgets");
  return { ok: true };
}

/** Remove a budget line. */
export async function deleteBudget(
  _prev: { error?: string } | undefined,
  formData: FormData
): Promise<{ error?: string } | undefined> {
  const { supabase } = await requireTradesAccount();
  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "Missing budget." };
  const { error } = await supabase.from("trades_budgets").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/finance/budgets");
  return undefined;
}
