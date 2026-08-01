"use server";

import { z } from "zod";
import { requireSession } from "@/lib/auth/require-session";
import { createClient } from "@/lib/supabase/server";
import { isMissingTableError, reportMissingTable } from "@/lib/db/errors";

const passwordSchema = z
  .object({
    newPassword: z.string().min(8, "Password must be at least 8 characters"),
    confirmPassword: z.string(),
  })
  .refine((v) => v.newPassword === v.confirmPassword, {
    message: "Passwords don't match",
    path: ["confirmPassword"],
  });

export async function changePassword(
  _prevState: { error?: string; ok?: boolean } | undefined,
  formData: FormData
) {
  await requireSession();
  const supabase = await createClient();

  const parsed = passwordSchema.safeParse({
    newPassword: formData.get("newPassword"),
    confirmPassword: formData.get("confirmPassword"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const { error } = await supabase.auth.updateUser({
    password: parsed.data.newPassword,
  });
  if (error) return { error: error.message };

  return { ok: true };
}

const knowledgeSchema = z.object({
  knowledge: z.string().trim().max(8000, "Keep the knowledge under 8000 characters"),
  tone: z.string().trim().max(120),
});

/**
 * Platform-level business knowledge & brand voice. Stored in aa_assistants
 * but gated on session ONLY (not the ai-assistant product) — every agent
 * that writes in the business's voice (ContentIQ, AssistIQ) reads
 * this, so any customer must be able to set it regardless of which agents
 * they own. RLS still scopes the row to the caller's own business.
 */
export async function updateBusinessKnowledge(
  _prevState: { error?: string; ok?: boolean } | undefined,
  formData: FormData
) {
  const { profile } = await requireSession();
  const businessId = profile.business_id!;

  const parsed = knowledgeSchema.safeParse({
    knowledge: formData.get("knowledge") ?? "",
    tone: formData.get("tone") || "friendly and professional",
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("aa_assistants").upsert(
    {
      business_id: businessId,
      knowledge: parsed.data.knowledge,
      tone: parsed.data.tone,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "business_id" }
  );

  if (error) {
    if (isMissingTableError(error)) {
      return { error: reportMissingTable("Your settings", "supabase/manual_update_0005.sql", error) };
    }
    return { error: error.message };
  }

  return { ok: true };
}
