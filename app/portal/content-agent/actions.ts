"use server";

import { z } from "zod";
import { requireSession } from "@/lib/auth/require-session";
import { requireProductEnabled } from "@/lib/auth/require-product";
import { createClient } from "@/lib/supabase/server";
import {
  generateContentCore,
  CONTENT_TYPES,
  type ContentType,
} from "@/lib/content-agent/generate-core";

const inputSchema = z.object({
  contentType: z.enum(
    Object.keys(CONTENT_TYPES) as [ContentType, ...ContentType[]]
  ),
  topic: z.string().trim().min(3, "Give the topic a few words").max(300),
  notes: z.string().trim().max(1000).optional(),
});

export type GenerateResult =
  | { ok: true; content: string; saved: boolean }
  | { ok: false; error: string };

export async function generateContent(
  contentType: string,
  topic: string,
  notes: string
): Promise<GenerateResult> {
  const { profile } = await requireSession();
  const businessId = profile.business_id!;

  const enabled = await requireProductEnabled(businessId, "content-agent");
  if (!enabled) {
    return { ok: false, error: "Content Agent is not enabled for your account." };
  }

  const parsed = inputSchema.safeParse({ contentType, topic, notes: notes || undefined });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const supabase = await createClient();
  return generateContentCore(
    supabase,
    businessId,
    parsed.data.contentType,
    parsed.data.topic,
    parsed.data.notes
  );
}
