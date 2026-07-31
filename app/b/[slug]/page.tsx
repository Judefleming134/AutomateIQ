import { cache } from "react";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { createAdminClient } from "@/lib/supabase/admin";
import { LeadForm } from "./lead-form";

// Public hosted business page (SiteIQ). Served via the service-role
// client — published pages only. Never exposes anything beyond what the
// business chose to publish.

// cache(): generateMetadata and the page component both need the page, and
// they run in the same request — wrapping the query dedupes it to a single
// DB round-trip per view instead of two.
const getPage = cache(async (slug: string) => {
  const supabase = createAdminClient();
  const { data } = await supabase
    .from("wa_pages")
    .select("business_id, slug, headline, about, services, phone, published, businesses(name, logo_url)")
    .eq("slug", slug)
    .eq("published", true)
    .maybeSingle();
  return data;
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const page = await getPage(slug);
  if (!page) return { title: "Not found" };
  const business = page.businesses as unknown as { name: string } | null;
  return {
    title: `${business?.name ?? "Business"} — ${page.headline || "Get in touch"}`,
    description: page.about?.slice(0, 150) || undefined,
  };
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

  return (
    <div className="wa-page">
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
        {page.phone && (
          <a href={`tel:${page.phone.replace(/[^\d+]/g, "")}`} className="wa-phone">
            📞 {page.phone}
          </a>
        )}
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
