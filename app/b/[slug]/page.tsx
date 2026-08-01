import { cache } from "react";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { createAdminClient } from "@/lib/supabase/admin";
import { LeadForm } from "./lead-form";
import { hoursRows, openNow, type Hours } from "@/lib/site-agent/hours";
import {
  buildLocalBusinessSchema,
  metaDescription,
  pageUrl,
} from "@/lib/site-agent/page-content";
import { isLikelyBot, dayKey } from "@/lib/site-agent/analytics";

// Public hosted business page (SiteIQ). Served via the service-role
// client — published pages only. Never exposes anything beyond what the
// business chose to publish.

// cache(): generateMetadata and the page component both need the page, and
// they run in the same request — wrapping the query dedupes it to a single
// DB round-trip per view instead of two.
type PageRow = {
  business_id: string;
  slug: string;
  headline: string | null;
  about: string | null;
  services: unknown;
  phone: string | null;
  contact_email: string | null;
  /** Absent before migration 0040 — see the fallback select below. */
  hours?: unknown;
  areas?: unknown;
  published: boolean;
  businesses: unknown;
};

const getPage = cache(async (slug: string): Promise<PageRow | null> => {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("wa_pages")
    .select(
      "business_id, slug, headline, about, services, phone, contact_email, hours, areas, published, businesses(name, logo_url)"
    )
    .eq("slug", slug)
    .eq("published", true)
    .maybeSingle();
  if (data) return data as unknown as PageRow;

  // Migration 0040 not run yet: hours/areas don't exist as columns, so the
  // select above fails as a whole. The page a customer is already paying for
  // must not go dark because of that — fall back to the fields that predate
  // it. Nothing else about the page changes.
  const { data: legacy } = await supabase
    .from("wa_pages")
    .select("business_id, slug, headline, about, services, phone, contact_email, published, businesses(name, logo_url)")
    .eq("slug", slug)
    .eq("published", true)
    .maybeSingle();
  return (legacy as unknown as PageRow) ?? null;
});

/** Stored hours are trusted but not assumed — a hand-edited row must not 500 the page. */
function readHours(raw: unknown): Hours {
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (h): h is { day: number; open: number; close: number } =>
      typeof h === "object" &&
      h !== null &&
      typeof (h as { day?: unknown }).day === "number" &&
      typeof (h as { open?: unknown }).open === "number" &&
      typeof (h as { close?: unknown }).close === "number"
  );
}

function readAreas(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((a): a is string => typeof a === "string") : [];
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const page = await getPage(slug);
  if (!page) return { title: "Not found" };
  const business = page.businesses as unknown as { name: string; logo_url?: string | null } | null;
  const areas = readAreas(page.areas);
  const url = pageUrl(page.slug, process.env.NEXT_PUBLIC_SITE_URL || "https://automateiq.ie");
  const title = `${business?.name ?? "Business"} — ${page.headline || "Get in touch"}`;
  const description = metaDescription({ headline: page.headline, about: page.about, areas });

  return {
    title,
    description,
    // A link pasted into WhatsApp or Facebook is how most of these pages get
    // shared. Without these it renders as a bare URL with no name on it.
    alternates: { canonical: url },
    openGraph: {
      title,
      description,
      url,
      type: "website",
      images: business?.logo_url ? [business.logo_url] : undefined,
    },
  };
}

/**
 * Counts the visit.
 *
 * Best-effort in every direction: a failure here must never stop the page
 * rendering, and a crawler must never be counted as a customer — a view count
 * inflated by bots tells the business its page gets traffic and the enquiries
 * are the problem, and it rewrites a page nobody was reading.
 */
async function countView(businessId: string) {
  try {
    const ua = (await headers()).get("user-agent");
    if (isLikelyBot(ua)) return;
    const supabase = createAdminClient();
    await supabase.rpc("record_page_view", {
      p_business_id: businessId,
      p_day: dayKey(new Date()),
    });
  } catch {
    // Migration 0040 not run, or the write failed. The page still renders.
  }
}

export default async function PublicBusinessPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const page = await getPage(slug);
  if (!page) notFound();

  const business = page.businesses as unknown as {
    name: string;
    logo_url: string | null;
  } | null;
  const services = (page.services as string[]) ?? [];
  const hours = readHours(page.hours);
  const areas = readAreas(page.areas);
  const rows = hoursRows(hours);
  const state = openNow(hours);
  const origin = process.env.NEXT_PUBLIC_SITE_URL || "https://automateiq.ie";

  // Not awaited: the visitor should never wait on bookkeeping.
  void countView(page.business_id);

  const schema = buildLocalBusinessSchema(
    {
      name: business?.name ?? "Business",
      slug: page.slug,
      headline: page.headline,
      about: page.about,
      services,
      areas,
      phone: page.phone,
      email: page.contact_email,
      logoUrl: business?.logo_url,
      hours,
    },
    origin
  );

  const tel = page.phone ? page.phone.replace(/[^\d+]/g, "") : "";

  return (
    <div className="wa-page">
      {/* What lets a search result carry the name, phone, hours and area
          instead of being a blue link. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
      />
      <div className="wa-glow" />
      <header className="wa-hero">
        {business?.logo_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={business.logo_url} alt={business?.name ?? ""} className="wa-logo" />
        ) : (
          <div className="wa-logo-mark">{(business?.name ?? "B").charAt(0)}</div>
        )}
        <h1>{business?.name}</h1>
        {page.headline && <p className="wa-headline">{page.headline}</p>}

        {/* The single most useful line on a local business page, and the one
            that was missing: can I ring them right now? */}
        {hours.length > 0 && (
          <p className={`wa-open ${state.open ? "is-open" : "is-shut"}`}>
            {state.open
              ? `Open now · closes ${state.closesAt}`
              : state.opensAt
                ? `Closed · opens ${state.opensAt}`
                : "Closed"}
          </p>
        )}

        <span className="wa-actions">
          {page.phone && (
            <a href={`tel:${tel}`} className="wa-phone">
              📞 {page.phone}
            </a>
          )}
          {page.contact_email && (
            <a href={`mailto:${page.contact_email}`} className="wa-phone wa-phone-alt">
              ✉️ Email us
            </a>
          )}
          <a href="#contact" className="wa-phone wa-phone-alt">
            ✍️ Send an enquiry
          </a>
        </span>
      </header>

      <main className="wa-main">
        {page.about && (
          <section className="wa-section">
            <h2>About us</h2>
            <p className="wa-about">{page.about}</p>
          </section>
        )}

        {services.length > 0 && (
          <section className="wa-section">
            <h2>What we do</h2>
            <ul className="wa-services">
              {services.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          </section>
        )}

        {/* "Do you cover Naas?" — the question asked before anything is
            booked, and the page had no way to answer it. */}
        {areas.length > 0 && (
          <section className="wa-section">
            <h2>Areas we cover</h2>
            <ul className="wa-areas">
              {areas.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          </section>
        )}

        {hours.length > 0 && (
          <section className="wa-section">
            <h2>Opening hours</h2>
            <table className="wa-hours">
              <tbody>
                {rows.map((r) => (
                  <tr key={r.day} className={r.closed ? "is-closed" : ""}>
                    <th scope="row">{r.day}</th>
                    <td>{r.text}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        <section className="wa-section" id="contact">
          <h2>Get in touch</h2>
          <p className="wa-about">
            Tell us what you need and we&apos;ll get back to you.
          </p>
          <LeadForm slug={page.slug} />
        </section>
      </main>

      <footer className="wa-footer">
        Powered by <a href="https://automateiq.ie">AutomateIQ</a>
      </footer>
    </div>
  );
}
