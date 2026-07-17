import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { getResendClient, getFromAddress } from "@/lib/email/resend";
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
 * Public lead capture for Website Agent pages. Uses the service-role
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

  // Speed-to-Lead Agent: instant acknowledgment to the lead, only when the
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
      const { data: recentReply } = await supabase
        .from("stl_replies")
        .select("id")
        .eq("sent_to", contact)
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
