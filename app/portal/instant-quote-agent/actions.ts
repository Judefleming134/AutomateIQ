"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/require-session";
import { requireProductEnabled } from "@/lib/auth/require-product";
import { createClient } from "@/lib/supabase/server";
import { getResendClient, getFromAddress } from "@/lib/email/resend";
import {
  createQuoteCore,
  type QuoteLine,
} from "@/lib/quote-agent/create-core";

const guideSchema = z.object({
  priceGuide: z.string().trim().max(8000, "Keep the price guide under 8000 characters"),
});

export async function savePriceGuide(
  _prevState: { error?: string; ok?: boolean } | undefined,
  formData: FormData
) {
  const { profile } = await requireSession();
  const businessId = profile.business_id!;

  const enabled = await requireProductEnabled(businessId, "instant-quote-agent");
  if (!enabled) return { error: "Instant Quote Agent is not enabled for your account." };

  const parsed = guideSchema.safeParse({ priceGuide: formData.get("priceGuide") ?? "" });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("qa_settings").upsert(
    {
      business_id: businessId,
      price_guide: parsed.data.priceGuide,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "business_id" }
  );

  if (error) {
    if (error.code === "42P01") {
      return { error: "Database update required — run supabase/manual_update_0007.sql." };
    }
    return { error: error.message };
  }

  revalidatePath("/portal/instant-quote-agent");
  return { ok: true };
}

const quoteSchema = z.object({
  customerName: z.string().trim().min(1, "Customer name is required").max(120),
  customerEmail: z
    .string()
    .trim()
    .email("Enter a valid customer email")
    .or(z.literal(""))
    .optional(),
  jobDescription: z
    .string()
    .trim()
    .min(5, "Describe the job in a bit more detail")
    .max(2000),
});

export type QuoteResult =
  | {
      ok: true;
      lines: QuoteLine[];
      total: string;
      notes: string;
      saved: boolean;
      quoteId: string | null;
    }
  | { ok: false; error: string };

export async function createQuote(
  customerName: string,
  jobDescription: string,
  customerEmail?: string
): Promise<QuoteResult> {
  const { profile } = await requireSession();
  const businessId = profile.business_id!;

  const enabled = await requireProductEnabled(businessId, "instant-quote-agent");
  if (!enabled) {
    return { ok: false, error: "Instant Quote Agent is not enabled for your account." };
  }

  const parsed = quoteSchema.safeParse({ customerName, customerEmail, jobDescription });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const supabase = await createClient();
  return createQuoteCore(
    supabase,
    businessId,
    parsed.data.customerName,
    parsed.data.jobDescription,
    parsed.data.customerEmail || undefined
  );
}

/**
 * Sends a quote to the customer as a link to its public accept/decline page
 * and moves it into the 'sent' stage. The complete quote-to-close step that
 * turns a saved draft into a live deal.
 */
export async function sendQuote(
  quoteId: string,
  emailOverride?: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { profile } = await requireSession();
  const businessId = profile.business_id!;

  const enabled = await requireProductEnabled(businessId, "instant-quote-agent");
  if (!enabled) {
    return { ok: false, error: "Instant Quote Agent is not enabled for your account." };
  }

  const supabase = await createClient();
  const { data: quote } = await supabase
    .from("qa_quotes")
    .select("id, customer_name, customer_email, total, view_token, status")
    .eq("id", quoteId)
    .maybeSingle();

  if (!quote) return { ok: false, error: "Quote not found." };
  if (quote.status === "accepted") {
    return { ok: false, error: "This quote has already been accepted." };
  }

  const to = (emailOverride?.trim() || quote.customer_email || "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    return { ok: false, error: "Add a valid customer email to send this quote." };
  }

  const { data: business } = await supabase
    .from("businesses")
    .select("name, email_signature")
    .eq("id", businessId)
    .single();

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://automateiq.ie";
  const quoteUrl = `${siteUrl}/q/${quote.view_token}`;
  const businessName = business?.name ?? "our team";

  try {
    const resend = getResendClient();
    const result = await resend.emails.send(
      {
        from: getFromAddress(),
        to,
        subject: `Your quote from ${businessName}`,
        text: [
          `Hi ${quote.customer_name},`,
          ``,
          `Thanks for the opportunity — your quote${quote.total ? ` (${quote.total})` : ""} is ready.`,
          ``,
          `View it and accept online here:`,
          quoteUrl,
          ``,
          business?.email_signature || businessName,
        ].join("\n"),
      },
      // Key on quote AND recipient: a double-click to the same address is
      // still deduped, but re-sending to a CORRECTED email actually goes out
      // (a quote-only key silently swallowed the second send → lost deal).
      { idempotencyKey: `quote-send-${quote.id}-${to.toLowerCase()}` }
    );
    if (result.error) {
      return { ok: false, error: `Email failed: ${result.error.message}` };
    }
  } catch (err) {
    return {
      ok: false,
      error: `Could not send: ${err instanceof Error ? err.message : "unknown error"}`,
    };
  }

  await supabase
    .from("qa_quotes")
    .update({
      status: quote.status === "draft" ? "sent" : quote.status,
      sent_at: new Date().toISOString(),
      customer_email: to,
    })
    .eq("id", quote.id);

  revalidatePath("/portal/instant-quote-agent");
  return { ok: true };
}
