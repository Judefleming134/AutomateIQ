"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/require-session";
import { requireProductEnabled } from "@/lib/auth/require-product";
import { createClient } from "@/lib/supabase/server";
import { sendReviewRequestCore } from "@/lib/review-agent/send-core";

const sendSchema = z.object({
  customerName: z.string().trim().min(1, "Customer name is required"),
  customerEmail: z.string().trim().email("A valid email is required"),
});

export async function sendReviewRequest(
  _prevState: { error?: string; ok?: boolean } | undefined,
  formData: FormData
) {
  const { profile } = await requireSession();
  const businessId = profile.business_id!;

  const enabled = await requireProductEnabled(businessId, "review-agent");
  if (!enabled) {
    return { error: "ReputationIQ is not enabled for your account." };
  }

  const parsed = sendSchema.safeParse({
    customerName: formData.get("customerName"),
    customerEmail: formData.get("customerEmail"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const { customerName, customerEmail } = parsed.data;

  const supabase = await createClient();

  // Shared core (also used by AssistIQ's send_review_request tool):
  // settings check, duplicate-submit guard, durable record before the
  // external call, then send + status update.
  const result = await sendReviewRequestCore(
    supabase,
    businessId,
    customerName,
    customerEmail
  );
  if (!result.ok) return { error: result.error };

  revalidatePath("/portal/review-agent");
  revalidatePath("/portal/review-agent/customers");
  revalidatePath("/portal/review-agent/history");
  return { ok: true };
}
