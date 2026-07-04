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

  const { error } = await supabase.from("wa_leads").insert({
    business_id: page.business_id,
    name,
    contact,
    message: message || null,
  });

  if (error) {
    return NextResponse.json({ error: "Store failed" }, { status: 502 });
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
