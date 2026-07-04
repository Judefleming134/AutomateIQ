import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { getResendClient, getFromAddress } from "@/lib/email/resend";

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
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact)) {
    try {
      const { data: stlEnabled } = await supabase
        .from("business_products")
        .select("business_id, products!inner(key)")
        .eq("business_id", page.business_id)
        .eq("products.key", "speed-to-lead-agent")
        .maybeSingle();

      if (stlEnabled) {
        const business = page.businesses as unknown as { name: string } | null;
        const businessName = business?.name ?? "the team";
        const resend = getResendClient();
        const result = await resend.emails.send(
          {
            from: getFromAddress(),
            to: contact,
            subject: `Thanks ${name} — we've got your enquiry`,
            text: [
              `Hi ${name},`,
              ``,
              `Thanks for getting in touch with ${businessName} — your message just landed with us and it's already in front of the team.`,
              ``,
              `We'll come back to you personally as soon as possible, usually within the hour during working hours.`,
              ``,
              `Talk soon,`,
              businessName,
            ].join("\n"),
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
  }

  // Best-effort owner notification — the lead is already stored, so an
  // email failure must never fail the request.
  if (page.contact_email) {
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
  }

  return NextResponse.json({ ok: true });
}
