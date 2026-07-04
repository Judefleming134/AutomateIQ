"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/require-session";
import { requireProductEnabled } from "@/lib/auth/require-product";
import { createClient } from "@/lib/supabase/server";
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
  jobDescription: z
    .string()
    .trim()
    .min(5, "Describe the job in a bit more detail")
    .max(2000),
});

export type QuoteResult =
  | { ok: true; lines: QuoteLine[]; total: string; notes: string; saved: boolean }
  | { ok: false; error: string };

export async function createQuote(
  customerName: string,
  jobDescription: string
): Promise<QuoteResult> {
  const { profile } = await requireSession();
  const businessId = profile.business_id!;

  const enabled = await requireProductEnabled(businessId, "instant-quote-agent");
  if (!enabled) {
    return { ok: false, error: "Instant Quote Agent is not enabled for your account." };
  }

  const parsed = quoteSchema.safeParse({ customerName, jobDescription });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const supabase = await createClient();
  return createQuoteCore(
    supabase,
    businessId,
    parsed.data.customerName,
    parsed.data.jobDescription
  );
}
