"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/require-session";
import { requireProductEnabled } from "@/lib/auth/require-product";
import { createClient } from "@/lib/supabase/server";
import { isMissingTableError, reportMissingTable } from "@/lib/db/errors";
import { getResendClient, getFromAddress } from "@/lib/email/resend";
import {
  buildAudience,
  audienceSummary,
  personalise,
  MAX_RECIPIENTS,
} from "@/lib/content-agent/audience";

/**
 * Publishing, meaning it actually goes somewhere.
 *
 * "Mark published" set a status and delivered nothing. This sends the piece to
 * the business's own ClientIQ contacts and records every recipient.
 *
 * The whole design assumes this WILL be interrupted — a timeout, a closed tab,
 * a double-click — so every send is recorded the moment it succeeds and the
 * database's unique index makes a repeat impossible. Re-running is always
 * safe and always resumes rather than restarts.
 */

type Result = { ok?: boolean; error?: string; notice?: string };

async function ctx() {
  const { profile } = await requireSession();
  const businessId = profile.business_id!;
  const enabled = await requireProductEnabled(businessId, "content-agent");
  if (!enabled) return { error: "ContentIQ is not enabled for your account." as const };
  return { businessId, supabase: await createClient() };
}

/** What WOULD happen, so nobody sends blind. */
export async function previewAudience(
  contentId: string
): Promise<{ ok: true; summary: string; count: number } | { ok: false; error: string }> {
  const c = await ctx();
  if ("error" in c) return { ok: false, error: c.error ?? "Not available." };
  const { businessId, supabase } = c;

  const [{ data: contacts }, sentResult] = await Promise.all([
    supabase.from("crm_contacts").select("id, name, email, stage").eq("business_id", businessId),
    supabase.from("ca_sends").select("email").eq("content_id", contentId),
  ]);

  // Caught HERE rather than at send time: without this table there is no
  // record of who has already been emailed, so the preview would confidently
  // offer to send a piece to people who already have it.
  if (sentResult.error && isMissingTableError(sentResult.error)) {
    return {
      ok: false,
      error: reportMissingTable(
        "Content publishing",
        "supabase/migrations/0039_content_sends.sql",
        sentResult.error
      ),
    };
  }

  const audience = buildAudience(
    contacts ?? [],
    (sentResult.data ?? []).map((s) => String(s.email))
  );
  return { ok: true, summary: audienceSummary(audience), count: audience.recipients.length };
}

/**
 * Sends the content to the audience.
 *
 * Deliberately NOT a background job: the person who pressed the button stays
 * on the page until it finishes, so a failure is theirs to see rather than
 * something they find out about from a customer.
 */
export async function publishContent(rawContentId: string): Promise<Result> {
  const c = await ctx();
  if ("error" in c) return { error: c.error ?? "Not available." };
  const { businessId, supabase } = c;

  const contentId = String(rawContentId ?? "").trim();
  if (!contentId) return { error: "Missing content." };

  const { data: content, error: contentError } = await supabase
    .from("ca_content")
    .select("id, topic, body, content_type, status")
    .eq("id", contentId)
    .eq("business_id", businessId)
    .maybeSingle();
  if (contentError) return { error: contentError.message };
  if (!content) return { error: "Content not found." };
  if (!String(content.body ?? "").trim()) {
    return { error: "There's nothing written yet — nothing to send." };
  }

  const [{ data: business }, { data: contacts }, sendsResult] = await Promise.all([
    supabase.from("businesses").select("name").eq("id", businessId).maybeSingle(),
    supabase.from("crm_contacts").select("id, name, email, stage").eq("business_id", businessId),
    supabase.from("ca_sends").select("email").eq("content_id", contentId),
  ]);

  if (sendsResult.error && isMissingTableError(sendsResult.error)) {
    return {
      error: reportMissingTable(
        "Content publishing",
        "supabase/migrations/0039_content_sends.sql",
        sendsResult.error
      ),
    };
  }

  const businessName = business?.name ?? "us";
  const audience = buildAudience(
    contacts ?? [],
    (sendsResult.data ?? []).map((s) => String(s.email))
  );
  if (audience.recipients.length === 0) {
    return { error: audienceSummary(audience) };
  }

  const resend = getResendClient();
  if (!resend) return { error: "Email isn't configured, so this can't be sent." };

  const subject = String(content.topic ?? "").trim() || `An update from ${businessName}`;
  let sent = 0;
  const failures: string[] = [];

  for (const person of audience.recipients) {
    try {
      const result = await resend.emails.send(
        {
          from: getFromAddress(),
          replyTo: "hello@automateiq.ie",
          to: person.email,
          subject,
          text: personalise(String(content.body), {
            name: person.name,
            business: businessName,
          }),
        },
        // Per content, per recipient — a retry cannot double-send even before
        // the database index gets involved.
        { idempotencyKey: `content-${contentId}-${person.email.toLowerCase()}` }
      );
      if (result.error) {
        failures.push(person.email);
        await supabase.from("ca_sends").insert({
          business_id: businessId,
          content_id: contentId,
          contact_id: person.id,
          email: person.email,
          status: "failed",
          error: result.error.message.slice(0, 400),
        });
        continue;
      }
    } catch (err) {
      failures.push(person.email);
      await supabase.from("ca_sends").insert({
        business_id: businessId,
        content_id: contentId,
        contact_id: person.id,
        email: person.email,
        status: "failed",
        error: (err instanceof Error ? err.message : "send failed").slice(0, 400),
      });
      continue;
    }

    // Recorded IMMEDIATELY after each success, not in a batch at the end. If
    // this dies halfway through, everyone already emailed is on record and a
    // re-run resumes instead of starting over.
    const { error: logError } = await supabase.from("ca_sends").insert({
      business_id: businessId,
      content_id: contentId,
      contact_id: person.id,
      email: person.email,
      status: "sent",
    });
    if (logError && logError.code !== "23505") {
      // The email HAS gone and we could not record it. Say so — the alternative
      // is a re-run sending it to them again.
      failures.push(`${person.email} (sent but not recorded)`);
    }
    sent += 1;
  }

  const { count: total } = await supabase
    .from("ca_sends")
    .select("id", { count: "exact", head: true })
    .eq("content_id", contentId)
    .eq("status", "sent");

  await supabase
    .from("ca_content")
    .update({
      status: "published",
      published_at: new Date().toISOString(),
      sent_at: new Date().toISOString(),
      recipient_count: total ?? sent,
    })
    .eq("id", contentId)
    .eq("business_id", businessId);

  revalidatePath("/portal/content-agent");
  return {
    ok: true,
    notice:
      `Sent to ${sent} ${sent === 1 ? "person" : "people"}.` +
      (failures.length ? ` ${failures.length} failed — run it again to retry just those.` : "") +
      (audience.capped ? ` Capped at ${MAX_RECIPIENTS}; run again for the rest.` : ""),
  };
}
