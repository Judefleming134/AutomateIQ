import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isKnownReviewHost, normaliseReviewLink } from "@/lib/review-agent/review-hosts";
import { signToken } from "@/lib/tools/token";

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

  // Normalise the saved link — owners paste these without a scheme constantly
  // ("g.page/…", "www.google.com/…"), and NextResponse.redirect throws on
  // anything that isn't absolute, which would 500 the customer clicking their
  // own review link. Fall back to home rather than crash.
  const destination = normaliseReviewLink(business?.google_review_link);
  if (!destination) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  // OPEN REDIRECT GUARD.
  //
  // This used to send the visitor to whatever the tenant had saved, full stop.
  // That makes automateiq.ie a redirector to any URL a customer chooses: the
  // recipient sees our domain in the message, trusts it, and lands wherever
  // they were sent. The cost falls on Jude's domain reputation, not theirs.
  //
  // Known review platforms still go straight through, so the normal path is
  // unchanged and costs no extra click. Anything else goes via an interstitial
  // that names the destination first — chosen over a hard block on purpose,
  // because blocking would silently break the review flow of a paying customer
  // whose platform simply isn't on the list, which is worse than the abuse.
  //
  // The interstitial's parameter is SIGNED, so nobody can craft
  // /leaving?to=anywhere by hand and get our domain to vouch for it.
  if (isKnownReviewHost(destination.hostname)) {
    return NextResponse.redirect(destination.toString());
  }
  const t = signToken({ t: Date.now(), to: destination.toString() });
  return NextResponse.redirect(
    new URL(`/leaving?t=${encodeURIComponent(t)}`, request.url)
  );
}
