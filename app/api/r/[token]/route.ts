import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Review-link click tracking. The email's CTA points here instead of
 * straight at the business's Google Review link — stamps clicked_at/
 * status='clicked' on first click (a no-op on subsequent clicks), then
 * redirects. This is what makes admin usage stats (send/click rates) real
 * data instead of unreachable columns.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const admin = createAdminClient();

  const { data: reviewRequest } = await admin
    .from("ra_review_requests")
    .select("id, business_id, clicked_at, status")
    .eq("click_token", token)
    .maybeSingle();

  if (!reviewRequest) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  const { data: business } = await admin
    .from("businesses")
    .select("google_review_link")
    .eq("id", reviewRequest.business_id)
    .single();

  if (!reviewRequest.clicked_at) {
    await admin
      .from("ra_review_requests")
      .update({ clicked_at: new Date().toISOString(), status: "clicked" })
      .eq("id", reviewRequest.id);
  }

  // Normalise the saved link: a business owner may paste it without a scheme
  // ("g.page/…", "www.google.com/…"). NextResponse.redirect requires an
  // ABSOLUTE URL and throws on anything else — which would 500 the customer
  // clicking their review link. Add https:// if missing and validate; fall
  // back to home rather than crash.
  const raw = business?.google_review_link?.trim();
  let destination: string | null = null;
  if (raw) {
    const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    try {
      destination = new URL(withScheme).toString();
    } catch {
      destination = null;
    }
  }
  if (!destination) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return NextResponse.redirect(destination);
}
