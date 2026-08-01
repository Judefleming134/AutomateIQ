import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { escapeLike } from "@/lib/growth/db";
import { getResendClient, getFromAddress } from "@/lib/email/resend";
import { ingestCrmContact } from "@/lib/crm/ingest";
import {
  renderTemplate,
  DEFAULT_STL_SUBJECT,
  DEFAULT_STL_TEMPLATE,
} from "@/lib/speed-to-lead/template";

const leadSchema = z.object({
  slug: z.string().trim().min(1),
  name: z.string().trim().min(1).max(120),
  contact: z.string().trim().min(3).max(200),
  message: z.string().trim().max(2000).optional(),
});

/**
 * Public lead capture for SiteIQ pages. Uses the service-role
 * client (public visitors have no session); the slug → business lookup
 * only matches PUBLISHED pages, so an unpublished page can't collect
 * leads even with a guessed slug.
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const parsed = leadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }
  const { slug, name, contact, message } = parsed.data;

  const supabase = createAdminClient();

  const { data: page } = await supabase
    .from("wa_pages")
    .select("business_id, contact_email, businesses(name)")
    .eq("slug", slug)
    .eq("published", true)
    .maybeSingle();

  if (!page) {
    return NextResponse.json({ error: "Page not found" }, { status: 404 });
  }

  // Abuse guards on a PUBLIC endpoint that writes into a paying customer's CRM.
  // The auto-reply below was already throttled, but the LEAD INSERT wasn't — so
  // anyone with a published slug could flood a customer's lead list with
  // thousands of junk rows and make the one screen they check useless. Two
  // generous caps, both far above anything a real SME page sees:
  //   · same contact, 3 per 24h — nobody legitimately enquires four times
  //   · same business, 60 per hour — catches a flood, never a busy day
  // Both fail OPEN if the counting query itself errors: losing a real lead is
  // worse than letting one extra through. Same posture as /api/book.
  const dayAgo = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const hourAgo = new Date(Date.now() - 3600 * 1000).toISOString();
  const [{ count: sameContact, error: contactErr }, { count: businessHour, error: hourErr }] =
    await Promise.all([
      supabase
        .from("wa_leads")
        .select("id", { count: "exact", head: true })
        .eq("business_id", page.business_id)
        // Case-insensitive with wildcards escaped, so varying capitalisation
        // doesn't walk straight past the cap (the bug fixed in #415).
        .ilike("contact", escapeLike(contact))
        .gte("created_at", dayAgo),
      supabase
        .from("wa_leads")
        .select("id", { count: "exact", head: true })
        .eq("business_id", page.business_id)
        .gte("created_at", hourAgo),
    ]);
  if (!contactErr && (sameContact ?? 0) >= 3) {
    return NextResponse.json(
      { error: "We already have your enquiry — we'll be in touch shortly." },
      { status: 429 }
    );
  }
  if (!hourErr && (businessHour ?? 0) >= 60) {
    return NextResponse.json(
      { error: "We're receiving a lot of enquiries right now — please try again shortly." },
      { status: 429 }
    );
  }

  const { data: lead, error } = await supabase
    .from("wa_leads")
    .insert({
      business_id: page.business_id,
      name,
      contact,
      message: message || null,
    })
    .select("id")
    .single();

  if (error || !lead) {
    return NextResponse.json({ error: "Store failed" }, { status: 502 });
  }

  // ClientIQ, immediately. Until now a web lead only reached the CRM when
  // somebody remembered to press Import — so a form filled in at 3am did not
  // exist in the system until a human clicked. "Every customer and lead in one
  // place" has to be true at the moment the lead arrives, not whenever the
  // next sync happens.
  //
  // Best-effort: the lead row is already stored and the visitor is waiting on
  // a response, so nothing here may fail the capture.
  const crm = await ingestCrmContact(supabase, {
    businessId: page.business_id,
    name,
    email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact) ? contact : null,
    phone: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact) ? null : contact,
    source: "SiteIQ",
    activity: `Captured as a website lead${message ? `: ${String(message).slice(0, 160)}` : ""}`,
    stage: "new",
  });
  if (!crm.ok) {
    console.error(`[wa-lead] ClientIQ ingest failed for lead ${lead.id}: ${crm.reason}`);
  }

  // LeadIQ: instant acknowledgment to the lead, only when the
  // product is enabled for this business and the contact is an email.
  // Best-effort — the lead is already stored, so nothing here may fail the
  // request.
  const sendStlReply = async () => {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact)) return;
    try {
      // Abuse guard: this public endpoint would otherwise let a bot make
      // automateiq.ie email ANY address it types in ("thanks for your
      // enquiry" spam to a victim = deliverability damage). One auto-reply
      // per address per 24h, checked against the send log; the lead row
      // itself is still stored either way.
      // Case-INSENSITIVE match. A plain .eq() compares byte-for-byte, so
      // "Bob@x.com" didn't match the "bob@x.com" already throttled — varying
      // capitalisation was enough to make the platform auto-reply to the same
      // victim repeatedly, which is precisely what this guard prevents.
      // Wildcards escaped so the match stays literal (% and _ are legal in an
      // email local part); same shape as /api/book and /api/lead.
      const { data: recentReply } = await supabase
        .from("stl_replies")
        .select("id")
        .ilike("sent_to", escapeLike(contact))
        .gte("created_at", new Date(Date.now() - 24 * 3600 * 1000).toISOString())
        .limit(1)
        .maybeSingle();
      if (recentReply) return;
      const { data: stlEnabled } = await supabase
        .from("business_products")
        .select("business_id, products!inner(key)")
        .eq("business_id", page.business_id)
        .eq("products.key", "speed-to-lead-agent")
        .maybeSingle();

      // Per-business config: custom template + on/off toggle. Missing row
      // (settings never edited, or 0007 not yet run) → defaults + enabled.
      const { data: stlSettings } = await supabase
        .from("stl_settings")
        .select("enabled, subject, reply_template")
        .eq("business_id", page.business_id)
        .maybeSingle();

      if (stlEnabled && stlSettings?.enabled !== false) {
        const business = page.businesses as unknown as { name: string } | null;
        const businessName = business?.name ?? "the team";
        const vars = { name, business: businessName };
        const resend = getResendClient();
        const result = await resend.emails.send(
          {
            from: getFromAddress(),
            to: contact,
            subject: renderTemplate(stlSettings?.subject ?? DEFAULT_STL_SUBJECT, vars),
            text: renderTemplate(stlSettings?.reply_template ?? DEFAULT_STL_TEMPLATE, vars),
          },
          { idempotencyKey: `stl-${lead.id}` }
        );
        if (result.error) {
          console.error("Speed-to-Lead reply rejected:", result.error);
        } else {
          const { error: logError } = await supabase.from("stl_replies").insert({
            business_id: page.business_id,
            lead_id: lead.id,
            sent_to: contact,
          });
          if (logError) {
            console.error("Speed-to-Lead log failed:", logError.message);
          }
        }
      }
    } catch (err) {
      console.error("Speed-to-Lead reply failed:", err);
    }
  };

  // Best-effort owner notification — the lead is already stored, so an
  // email failure must never fail the request.
  const notifyOwner = async () => {
    if (!page.contact_email) return;
    try {
      const business = page.businesses as unknown as { name: string } | null;
      const resend = getResendClient();
      const result = await resend.emails.send({
        from: getFromAddress(),
        to: page.contact_email,
        subject: `New enquiry from your ${business?.name ?? "business"} page`,
        text: [
          `You have a new enquiry from your AutomateIQ business page:`,
          ``,
          `Name: ${name}`,
          `Contact: ${contact}`,
          message ? `Message: ${message}` : null,
          ``,
          `View all your leads in your portal: ${process.env.NEXT_PUBLIC_SITE_URL || "https://automateiq.ie"}/portal/website-agent/leads`,
        ]
          .filter((line): line is string => line !== null)
          .join("\n"),
      });
      if (result.error) {
        console.error("Lead notification email rejected:", result.error);
      }
    } catch (err) {
      console.error("Lead notification email failed:", err);
    }
  };

  // Ferrari: the two emails are independent — sending them in parallel
  // shaves ~one full email round-trip off every visitor's form submit.
  await Promise.allSettled([sendStlReply(), notifyOwner()]);

  return NextResponse.json({ ok: true });
}
