"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/require-session";
import { requireProductEnabled } from "@/lib/auth/require-product";
import { createClient } from "@/lib/supabase/server";
import { handleInboundMessage } from "@/lib/instagram/setter-core";
import { isMissingTableError } from "@/lib/db/errors";

const NEEDS_MIGRATION =
  "Database update required — run supabase/manual_update_0011.sql in the Supabase SQL Editor, then try again.";

const PRODUCT = "instagram-dm-setter";

const settingsSchema = z.object({
  igAccountId: z.string().trim().max(120).optional().or(z.literal("")),
  igUsername: z.string().trim().max(120).optional().or(z.literal("")),
  pageAccessToken: z.string().trim().max(400).optional().or(z.literal("")),
  autoReply: z.boolean(),
  persona: z.string().trim().max(2000).optional().or(z.literal("")),
  greeting: z.string().trim().max(600).optional().or(z.literal("")),
  bookingLink: z.string().trim().max(300).optional().or(z.literal("")),
});

export async function updateInstagramSettings(
  _prev: { ok?: boolean; error?: string } | undefined,
  formData: FormData
) {
  const { profile } = await requireSession();
  const businessId = profile.business_id!;

  const enabled = await requireProductEnabled(businessId, PRODUCT);
  if (!enabled) return { error: "Instagram DM Setter is not enabled for your account." };

  const parsed = settingsSchema.safeParse({
    igAccountId: formData.get("igAccountId") || "",
    igUsername: formData.get("igUsername") || "",
    pageAccessToken: formData.get("pageAccessToken") || "",
    autoReply: formData.get("autoReply") === "on",
    persona: formData.get("persona") || "",
    greeting: formData.get("greeting") || "",
    bookingLink: formData.get("bookingLink") || "",
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }
  const d = parsed.data;
  const connected = Boolean(d.igAccountId && d.pageAccessToken);

  const supabase = await createClient();

  // Preserve an existing saved token when the field is left blank (so the
  // owner doesn't have to re-paste it on every edit).
  const update: Record<string, unknown> = {
    business_id: businessId,
    ig_account_id: d.igAccountId || null,
    ig_username: d.igUsername || null,
    auto_reply: d.autoReply,
    persona: d.persona || "",
    greeting: d.greeting || "",
    booking_link: d.bookingLink || "",
    connected,
    updated_at: new Date().toISOString(),
  };
  if (d.pageAccessToken) update.page_access_token = d.pageAccessToken;

  const { error } = await supabase
    .from("ig_settings")
    .upsert(update, { onConflict: "business_id" });

  if (error) {
    return { error: isMissingTableError(error) ? NEEDS_MIGRATION : error.message };
  }

  revalidatePath("/portal/instagram-dm-setter");
  return { ok: true };
}

type SimResult =
  | { ok: true; reply: string | null; autoReplied: boolean }
  | { ok: false; error: string };

/**
 * Test the setter end-to-end without a live Meta connection: inject a DM as if
 * it came from a lead. Runs the exact same pipeline the webhook uses (store →
 * AI reply → store), so the conversation also appears to the AI Assistant.
 */
export async function simulateInboundMessage(
  username: string,
  text: string
): Promise<SimResult> {
  const { profile } = await requireSession();
  const businessId = profile.business_id!;

  const enabled = await requireProductEnabled(businessId, PRODUCT);
  if (!enabled) return { ok: false, error: "Instagram DM Setter is not enabled for your account." };

  const cleanText = text.trim().slice(0, 2000);
  const cleanUser = (username.trim().replace(/^@/, "") || "test_lead").slice(0, 120);
  if (!cleanText) return { ok: false, error: "Type a message to test with." };

  const supabase = await createClient();
  try {
    const result = await handleInboundMessage({
      supabase,
      businessId,
      igUserId: `sim:${cleanUser}`,
      username: cleanUser,
      text: cleanText,
    });
    revalidatePath("/portal/instagram-dm-setter");
    return { ok: true, reply: result.reply, autoReplied: result.autoReplied };
  } catch (err) {
    if (isMissingTableError(err)) return { ok: false, error: NEEDS_MIGRATION };
    const msg = err instanceof Error ? err.message : "";
    if (msg === "NO_PROVIDER") {
      return {
        ok: false,
        error:
          "No AI provider key is configured — add ANTHROPIC_API_KEY (or GEMINI_API_KEY) in Vercel to let the setter reply.",
      };
    }
    if (msg === "EMPTY_OUTPUT") {
      return { ok: false, error: "The setter returned an empty reply — please try again." };
    }
    console.error("IG simulate failed:", err);
    return { ok: false, error: "The setter couldn't reply just now — please try again." };
  }
}
