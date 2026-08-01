"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/require-session";
import { requireProductEnabled } from "@/lib/auth/require-product";
import { createClient } from "@/lib/supabase/server";
import { isMissingTableError, reportMissingTable } from "@/lib/db/errors";
import { getResendClient, getFromAddress } from "@/lib/email/resend";
import {
  placeholderProblem,
  renderTemplate,
  PREVIEW_VARS,
} from "@/lib/speed-to-lead/template";

const settingsSchema = z.object({
  enabled: z.boolean(),
  subject: z.string().trim().min(1, "Subject is required").max(200),
  replyTemplate: z
    .string()
    .trim()
    .min(10, "The reply is a little short")
    .max(4000, "Keep the reply under 4000 characters"),
});

export async function updateSpeedToLeadSettings(
  _prevState: { error?: string; ok?: boolean } | undefined,
  formData: FormData
) {
  const { profile } = await requireSession();
  const businessId = profile.business_id!;

  const enabled = await requireProductEnabled(businessId, "speed-to-lead-agent");
  if (!enabled) {
    return { error: "LeadIQ is not enabled for your account." };
  }

  const parsed = settingsSchema.safeParse({
    enabled: formData.get("enabled") === "on",
    subject: formData.get("subject") ?? "",
    replyTemplate: formData.get("replyTemplate") ?? "",
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  // A placeholder that isn't {{name}} or {{business}} is NOT substituted — it
  // is sent to the customer exactly as typed. This template is saved once and
  // then mailed to every lead, unattended, so a typo here is not one bad email
  // but every bad email until somebody notices. The Growth Engine refuses to
  // send on the same condition (draftLooksBroken); refusing to SAVE is the
  // equivalent, and it costs nothing to correct now.
  const badSubject = placeholderProblem(parsed.data.subject);
  if (badSubject) return { error: `Subject line: ${badSubject}` };
  const badBody = placeholderProblem(parsed.data.replyTemplate);
  if (badBody) return { error: `Message: ${badBody}` };

  const supabase = await createClient();
  const { error } = await supabase.from("stl_settings").upsert(
    {
      business_id: businessId,
      enabled: parsed.data.enabled,
      subject: parsed.data.subject,
      reply_template: parsed.data.replyTemplate,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "business_id" }
  );

  if (error) {
    if (isMissingTableError(error)) {
      return { error: reportMissingTable("LeadIQ", "supabase/manual_update_0007.sql", error) };
    }
    return { error: error.message };
  }

  revalidatePath("/portal/speed-to-lead-agent");
  return { ok: true };
}


/**
 * Sends the CURRENT draft to the signed-in user, through the same Resend path
 * a real lead's reply takes.
 *
 * The settings form let a customer rewrite the email every one of their leads
 * receives and gave them no way to see it — you saved it blind and the next
 * real enquiry was the test. The live preview answers "what does it say"; this
 * answers "does it actually arrive, and does it look right in a real inbox",
 * which a preview cannot.
 *
 * Deliberately sends the text in the form, not the saved row, so it can be
 * tested BEFORE committing it to every future lead.
 */
export async function sendTestReply(
  _prevState: { error?: string; ok?: boolean; sentTo?: string } | undefined,
  formData: FormData
): Promise<{ error?: string; ok?: boolean; sentTo?: string }> {
  const { profile, user } = await requireSession();
  const businessId = profile.business_id!;

  const enabled = await requireProductEnabled(businessId, "speed-to-lead-agent");
  if (!enabled) return { error: "LeadIQ is not enabled for your account." };

  const to = user.email;
  if (!to) return { error: "Your account has no email address to send a test to." };

  const parsed = settingsSchema.safeParse({
    enabled: true,
    subject: formData.get("subject") ?? "",
    replyTemplate: formData.get("replyTemplate") ?? "",
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  // Same gate as saving: never demonstrate a broken template as if it worked.
  const bad =
    placeholderProblem(parsed.data.subject) ??
    placeholderProblem(parsed.data.replyTemplate);
  if (bad) return { error: bad };

  const supabase = await createClient();
  const { data: business } = await supabase
    .from("businesses")
    .select("name")
    .eq("id", businessId)
    .maybeSingle();

  // The real business name, and an obviously-sample lead name. Using a real
  // lead's name would make a test indistinguishable from a live send in the
  // recipient's inbox.
  const vars = { name: PREVIEW_VARS.name, business: business?.name ?? "your business" };

  try {
    const resend = getResendClient();
    const result = await resend.emails.send({
      from: getFromAddress(),
      to,
      subject: `[Test] ${renderTemplate(parsed.data.subject, vars)}`,
      text: `${renderTemplate(parsed.data.replyTemplate, vars)}\n\n---\nThis is a test of your LeadIQ instant reply. Real leads do not see this footer, and the [Test] tag is not on the real thing.`,
    });
    if (result.error) {
      return { error: `Could not send: ${result.error.message}` };
    }
  } catch (err) {
    return {
      error: err instanceof Error ? `Could not send: ${err.message}` : "Could not send the test.",
    };
  }

  // Deliberately NOT logged to stl_replies: that table is the record of
  // replies sent to real leads, and the dashboard counts it. A test that
  // inflated "instant replies sent" would make the product's own headline
  // number a lie.
  return { ok: true, sentTo: to };
}