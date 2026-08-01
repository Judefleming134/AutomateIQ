"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/require-session";
import { requireProductEnabled } from "@/lib/auth/require-product";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isMissingTableError, reportMissingTable } from "@/lib/db/errors";
import { getResendClient, getFromAddress } from "@/lib/email/resend";
import {
  buildInvoiceFromQuote,
  parseMoneyToCents,
  formatCents,
  outstandingCents,
  type InvoiceLine,
} from "@/lib/quote-agent/invoice";

/**
 * Invoicing actions — the "in one step" the TradeIQ page has been promising.
 *
 * Every one of these guards the same three things, in the same order:
 *   1. the caller is signed in and QuoteIQ is enabled for their business;
 *   2. the row belongs to THEIR business (RLS enforces it, and the queries
 *      are written so a foreign id simply matches nothing);
 *   3. money is never invented — an amount that cannot be established
 *      exactly is refused rather than guessed.
 */

type Result = { ok?: boolean; error?: string; notice?: string; invoiceId?: string };

async function ctx() {
  const { profile, user } = await requireSession();
  const businessId = profile.business_id!;
  const enabled = await requireProductEnabled(businessId, "instant-quote-agent");
  if (!enabled) return { error: "QuoteIQ is not enabled for your account." as const };
  return { businessId, user, supabase: await createClient() };
}

/**
 * Raises the invoice for an accepted quote.
 *
 * The unique partial index on quote_id is the real guarantee against
 * double-billing — a double-click cannot produce two invoices for the same
 * job, because the database refuses the second one. This checks first for a
 * friendly message, and treats the constraint violation as success so the
 * second click lands the user on the invoice that already exists.
 */
export async function createInvoiceFromQuote(
  _prev: Result | undefined,
  formData: FormData
): Promise<Result> {
  const c = await ctx();
  if ("error" in c) return { error: c.error };
  const { businessId, supabase } = c;

  const quoteId = String(formData.get("quote_id") ?? "").trim();
  if (!quoteId) return { error: "Missing quote." };

  const { data: quote, error: quoteError } = await supabase
    .from("qa_quotes")
    .select("id, business_id, customer_name, customer_email, quote_lines, total, status")
    .eq("id", quoteId)
    .eq("business_id", businessId)
    .maybeSingle();
  if (quoteError) return { error: quoteError.message };
  if (!quote) return { error: "Quote not found." };

  // Already invoiced? Send them there instead of refusing blankly.
  const { data: existing, error: existingError } = await supabase
    .from("qa_invoices")
    .select("id, number")
    .eq("quote_id", quoteId)
    .maybeSingle();
  if (existingError && isMissingTableError(existingError)) {
    return { error: reportMissingTable(
        "Invoicing",
        "supabase/migrations/0037_invoices.sql",
        existingError
      ) };
  }
  if (existing) {
    return {
      ok: true,
      invoiceId: existing.id,
      notice: `${existing.number} was already raised for this quote.`,
    };
  }

  // Numbering is per business and derived from the highest existing number,
  // so a voided invoice never causes a reference to be reused.
  const { data: numbers } = await supabase
    .from("qa_invoices")
    .select("number")
    .eq("business_id", businessId);

  const built = buildInvoiceFromQuote(quote, {
    existingNumbers: (numbers ?? []).map((n) => String(n.number)),
    today: new Date().toISOString().slice(0, 10),
  });
  if (!built.ok) return { error: built.error };

  const { data: created, error } = await supabase
    .from("qa_invoices")
    .insert(built.row)
    .select("id, number")
    .single();
  if (error) {
    if (isMissingTableError(error)) {
      return { error: reportMissingTable(
        "Invoicing",
        "supabase/migrations/0037_invoices.sql",
        error
      ) };
    }
    // The unique index did its job — another click won the race.
    if (error.code === "23505") {
      const { data: raced } = await supabase
        .from("qa_invoices")
        .select("id, number")
        .eq("quote_id", quoteId)
        .maybeSingle();
      return raced
        ? { ok: true, invoiceId: raced.id, notice: `${raced.number} was already raised.` }
        : { error: "That quote has already been invoiced." };
    }
    return { error: error.message };
  }

  revalidatePath("/portal/instant-quote-agent");
  return {
    ok: true,
    invoiceId: created.id,
    notice: built.warnings[0] ?? `${created.number} raised as a draft — check it, then send it.`,
  };
}

const amountSchema = z.object({ amount: z.string().trim().max(40) });

/** Overwrites the amount when the quote's figure couldn't be read, or was wrong. */
export async function setInvoiceAmount(
  _prev: Result | undefined,
  formData: FormData
): Promise<Result> {
  const c = await ctx();
  if ("error" in c) return { error: c.error };
  const { businessId, supabase } = c;

  const id = String(formData.get("invoice_id") ?? "").trim();
  const parsed = amountSchema.safeParse({ amount: formData.get("amount") ?? "" });
  if (!id || !parsed.success) return { error: "Enter an amount." };

  const cents = parseMoneyToCents(parsed.data.amount);
  if (cents === null) {
    return { error: "That isn't a clear amount — enter a figure like 1250 or 1,250.00." };
  }

  // Only a draft may be repriced. Changing the amount of an invoice a customer
  // has already been sent is a different document, not an edit.
  const { data, error } = await supabase
    .from("qa_invoices")
    .update({ amount_cents: cents })
    .eq("id", id)
    .eq("business_id", businessId)
    .eq("status", "draft")
    .select("id")
    .maybeSingle();
  if (error) return { error: error.message };
  if (!data) {
    return { error: "Only a draft invoice can be repriced — this one has already been sent." };
  }

  revalidatePath("/portal/instant-quote-agent");
  return { ok: true };
}

/** Emails the invoice with a link to its public page. */
export async function sendInvoice(
  _prev: Result | undefined,
  formData: FormData
): Promise<Result> {
  const c = await ctx();
  if ("error" in c) return { error: c.error };
  const { businessId, supabase } = c;

  const id = String(formData.get("invoice_id") ?? "").trim();
  const { data: invoice, error } = await supabase
    .from("qa_invoices")
    .select("id, number, customer_name, customer_email, amount_cents, currency, due_date, status, view_token")
    .eq("id", id)
    .eq("business_id", businessId)
    .maybeSingle();
  if (error) return { error: error.message };
  if (!invoice) return { error: "Invoice not found." };
  if (invoice.status === "void") return { error: "This invoice was voided." };
  if (invoice.status === "paid") return { error: "This invoice is already paid." };
  if (!invoice.customer_email) {
    return { error: "No email address on this invoice — add one to send it." };
  }
  if (!invoice.amount_cents) {
    return { error: "This invoice is for €0 — set the amount before sending it." };
  }

  const { data: business } = await supabase
    .from("businesses")
    .select("name")
    .eq("id", businessId)
    .maybeSingle();
  const businessName = business?.name ?? "us";
  const site = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://automateiq.ie").replace(/\/+$/, "");
  const link = `${site}/i/${invoice.view_token}`;
  const amount = formatCents(invoice.amount_cents, invoice.currency ?? "EUR");

  const resend = getResendClient();
  if (!resend) return { error: "Email isn't configured, so the invoice can't be sent." };

  const sent = await resend.emails.send(
    {
      from: getFromAddress(),
      to: invoice.customer_email,
      subject: `Invoice ${invoice.number} from ${businessName} — ${amount}`,
      text: [
        `Hi ${invoice.customer_name},`,
        "",
        `Please find invoice ${invoice.number} for ${amount}${invoice.due_date ? `, due ${invoice.due_date}` : ""}.`,
        "",
        "You can view it here:",
        link,
        "",
        `Thanks,`,
        businessName,
      ].join("\n"),
    },
    // Re-sending the same invoice must not produce a second email in the
    // customer's inbox on a double-click.
    { idempotencyKey: `inv-${invoice.id}` }
  );
  if (sent.error) return { error: `Could not send: ${sent.error.message}` };

  // sent_at is stamped only after the send actually succeeded — recording it
  // first would show "sent" for an invoice nobody received.
  const { error: markError } = await supabase
    .from("qa_invoices")
    .update({ status: "sent", sent_at: new Date().toISOString() })
    .eq("id", invoice.id)
    .eq("business_id", businessId);
  if (markError) {
    return { error: `Sent, but recording it failed: ${markError.message}` };
  }

  revalidatePath("/portal/instant-quote-agent");
  return { ok: true, notice: `${invoice.number} sent to ${invoice.customer_email}.` };
}

/**
 * Records money received. A part payment stays 'sent' with the amount logged —
 * rounding it up to paid would hide a balance that is still owed.
 */
export async function recordPayment(
  _prev: Result | undefined,
  formData: FormData
): Promise<Result> {
  const c = await ctx();
  if ("error" in c) return { error: c.error };
  const { businessId, supabase } = c;

  const id = String(formData.get("invoice_id") ?? "").trim();
  const raw = String(formData.get("amount") ?? "").trim();

  const { data: invoice, error } = await supabase
    .from("qa_invoices")
    .select("id, number, amount_cents, paid_amount_cents, currency, status, customer_name, customer_email, business_id")
    .eq("id", id)
    .eq("business_id", businessId)
    .maybeSingle();
  if (error) return { error: error.message };
  if (!invoice) return { error: "Invoice not found." };
  if (invoice.status === "void") return { error: "This invoice was voided." };

  // Blank means "paid in full", which is the common case and saves typing the
  // number that is already on screen.
  const cents = raw ? parseMoneyToCents(raw) : outstandingCents(invoice);
  if (cents === null) {
    return { error: "That isn't a clear amount — enter a figure like 1250 or 1,250.00." };
  }
  const total = (invoice.paid_amount_cents ?? 0) + cents;
  const fullyPaid = total >= invoice.amount_cents;

  const { error: updateError } = await supabase
    .from("qa_invoices")
    .update({
      paid_amount_cents: total,
      status: fullyPaid ? "paid" : "sent",
      paid_at: fullyPaid ? new Date().toISOString() : null,
    })
    .eq("id", invoice.id)
    .eq("business_id", businessId);
  if (updateError) return { error: updateError.message };

  // The money reaches ClientIQ too — a paid invoice is the strongest possible
  // signal about a customer, and the CRM is where it belongs.
  if (fullyPaid && invoice.customer_email) {
    try {
      const admin = createAdminClient();
      const { data: contact } = await admin
        .from("crm_contacts")
        .select("id")
        .eq("business_id", businessId)
        .ilike("email", invoice.customer_email)
        .maybeSingle();
      if (contact) {
        await admin.from("crm_activities").insert({
          business_id: businessId,
          contact_id: contact.id,
          type: "payment",
          body: `Invoice ${invoice.number} paid in full — ${formatCents(total, invoice.currency ?? "EUR")}.`,
        });
      }
    } catch {
      /* best-effort: the payment is recorded either way */
    }
  }

  revalidatePath("/portal/instant-quote-agent");
  return {
    ok: true,
    notice: fullyPaid
      ? `${invoice.number} marked paid.`
      : `${formatCents(cents, invoice.currency ?? "EUR")} recorded — ${formatCents(invoice.amount_cents - total, invoice.currency ?? "EUR")} still outstanding.`,
  };
}

/** Voids an invoice. Never deletes — the record and its number are the point. */
export async function voidInvoice(
  _prev: Result | undefined,
  formData: FormData
): Promise<Result> {
  const c = await ctx();
  if ("error" in c) return { error: c.error };
  const { businessId, supabase } = c;

  const id = String(formData.get("invoice_id") ?? "").trim();
  const { data, error } = await supabase
    .from("qa_invoices")
    .update({ status: "void" })
    .eq("id", id)
    .eq("business_id", businessId)
    .neq("status", "paid")
    .select("number")
    .maybeSingle();
  if (error) return { error: error.message };
  if (!data) return { error: "A paid invoice can't be voided — record a refund instead." };

  revalidatePath("/portal/instant-quote-agent");
  return { ok: true, notice: `${data.number} voided. The number is retained.` };
}

export type { InvoiceLine };
