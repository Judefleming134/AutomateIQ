import { Globe, Users, Eye, TrendingUp } from "lucide-react";
import { requireSession } from "@/lib/auth/require-session";
import { createClient } from "@/lib/supabase/server";
import { ActionForm } from "@/components/admin/action-form";
import { SubmitButton } from "@/components/admin/submit-button";
import { StatCard } from "@/components/portal/stat-card";
import { CopyButton } from "@/components/portal/copy-button";
import {
  ActivityBarChart,
  bucketByDay,
} from "@/components/portal/activity-chart";
import { updateWebsitePage } from "./actions";
import { hoursToText, type Hours } from "@/lib/site-agent/hours";
import { summariseViews, dayKey } from "@/lib/site-agent/analytics";

function defaultSlug(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
}

export default async function WebsiteAgentPage() {
  const { profile } = await requireSession();
  const supabase = await createClient();

  const [{ data: business }, { data: page }, { count: leadCount }] =
    await Promise.all([
      supabase
        .from("businesses")
        .select("name")
        .eq("id", profile.business_id!)
        .single(),
      supabase
        .from("wa_pages")
        .select("*")
        .eq("business_id", profile.business_id!)
        .maybeSingle(),
      supabase
        .from("wa_leads")
        .select("id", { count: "exact", head: true }),
    ]);

  const leadsSince = new Date(Date.now() - 13 * 86_400_000).toISOString();
  const { data: leadRows } = await supabase
    .from("wa_leads")
    .select("created_at")
    .gte("created_at", leadsSince)
    .limit(1000);

  // A SEPARATE 30-day read, matching the view window exactly. Reusing the
  // 14-day rows above would divide a fortnight of enquiries by a month of
  // visits and report a conversion rate roughly half the real one — the
  // count-that-doesn't-match-its-source bug, in the number a customer would
  // use to judge whether the product works.
  const { data: leadRows30 } = await supabase
    .from("wa_leads")
    .select("created_at")
    .gte("created_at", new Date(Date.now() - 29 * 86_400_000).toISOString())
    .limit(1000);

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://automateiq.ie";
  const slug = page?.slug ?? defaultSlug(business?.name ?? "");
  const publicUrl = `${siteUrl}/b/${slug}`;

  const services = (page?.services as string[]) ?? [];
  const hours: Hours = Array.isArray(page?.hours) ? (page.hours as Hours) : [];
  const hoursText = hours.length ? hoursToText(hours) : "";
  const areas: string[] = Array.isArray(page?.areas)
    ? (page.areas as string[]).filter((a) => typeof a === "string")
    : [];

  // Is the page actually working? The enquiry list on its own is a numerator
  // with no denominator: three enquiries means something completely different
  // out of 40 visits than out of 4,000, and until now the two could not be
  // told apart.
  const { data: viewRows } = await supabase
    .from("wa_page_views")
    .select("day, views")
    .gte("day", dayKey(new Date(Date.now() - 29 * 86_400_000)))
    .order("day")
    .limit(60);
  const traffic = summariseViews(
    (viewRows ?? []).map((r) => ({ day: String(r.day), views: Number(r.views) || 0 })),
    (leadRows30 ?? []).map((r) => String(r.created_at)),
    30
  );
  // Distinguishes "nobody visited" from "we can't tell yet" — a zero shown as
  // a measurement when nothing is being measured is the kind of number that
  // gets acted on wrongly.
  const viewsTracked = viewRows !== null;

  // SEO & content readiness — computed from the page's real content.
  const seoChecks = [
    { label: "Headline written", ok: Boolean(page?.headline) },
    {
      label: "About section (50+ characters)",
      ok: (page?.about?.length ?? 0) >= 50,
    },
    { label: "At least 3 services listed", ok: services.length >= 3 },
    { label: "Phone number added", ok: Boolean(page?.phone) },
    { label: "Contact email set", ok: Boolean(page?.contact_email) },
    { label: "Opening hours set", ok: hours.length > 0 },
    { label: "Areas you cover listed", ok: areas.length > 0 },
    { label: "Page published", ok: Boolean(page?.published) },
  ];

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Your Page</h1>
          <p>
            A hosted mini-site for your business — publish it and share the
            link anywhere. Enquiries land straight in your Leads tab.
          </p>
        </div>
        {page?.published && (
          <span style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <CopyButton text={publicUrl} label="Copy link" />
            <a href={publicUrl} target="_blank" rel="noopener noreferrer" className="btn btn-secondary btn-sm">
              <Globe size={13} /> View live page
            </a>
          </span>
        )}
      </div>

      <div className="stat-grid">
        <StatCard
          label="Page status"
          value={page?.published ? "Live" : "Draft"}
          icon={<Globe />}
          accent={page?.published ? "#34D399" : "#FB923C"}
          hint={page?.published ? publicUrl.replace(/^https?:\/\//, "") : "not published yet"}
        />
        <StatCard
          label="Leads captured"
          value={leadCount ?? 0}
          icon={<Users />}
          accent="#3B82F6"
          hint="all time"
        />
        <StatCard
          label="Visits"
          value={viewsTracked ? traffic.views : "—"}
          icon={<Eye />}
          accent="#A78BFA"
          hint={viewsTracked ? "last 30 days" : "switching on shortly"}
        />
        <StatCard
          label="Turned into enquiries"
          value={
            viewsTracked && traffic.conversionRate !== null
              ? `${traffic.conversionRate}%`
              : "—"
          }
          icon={<TrendingUp />}
          accent="#34D399"
          hint={viewsTracked ? `${traffic.enquiries} from ${traffic.views} visits` : "no visit data yet"}
        />
      </div>

      {viewsTracked && (
        <div className="panel panel-block" style={{ marginBottom: 28 }}>
          <h2 className="panel-title">
            <span>
              <span className="sys-index">01 /</span>
              Is the page working?
            </span>
            {traffic.busiest && (
              <span className="badge badge-gray">
                busiest {traffic.busiest.day} · {traffic.busiest.views} visits
              </span>
            )}
          </h2>
          <ActivityBarChart
            buckets={traffic.series.slice(-14).map((s) => ({ label: s.day.slice(5), count: s.views }))}
            accent="var(--chart-2)"
            unit="visits"
          />
          {/* Says what the two numbers mean together, and deliberately
              refuses to congratulate a page on a rate calculated from a
              handful of visits. */}
          <p style={{ margin: "14px 0 0", fontSize: 13, color: "var(--body)", lineHeight: 1.65, maxWidth: "72ch" }}>
            {traffic.verdict}
          </p>
        </div>
      )}

      <div className="panel panel-block" style={{ marginBottom: 28 }}>
        <h2 className="panel-title">
          <span>
            <span className="sys-index">01 /</span>
            Leads — last 14 days
          </span>
        </h2>
        <ActivityBarChart
          buckets={bucketByDay((leadRows ?? []).map((r) => r.created_at), 14)}
          accent="var(--chart-3)"
          unit="leads"
        />
      </div>

      <div className="grid-main-side">
      <ActionForm action={updateWebsitePage} className="panel form-card" >
        <div className="field">
          <label htmlFor="slug">Web address</label>
          <input
            id="slug"
            type="text"
            name="slug"
            defaultValue={slug}
            required
            pattern="[a-z0-9][a-z0-9\-]{1,48}[a-z0-9]"
          />
          <span style={{ fontSize: 11.5, color: "var(--faint)" }}>
            Your page will live at {siteUrl}/b/&lt;address&gt;
          </span>
        </div>
        <div className="field">
          <label htmlFor="headline">Headline</label>
          <input
            id="headline"
            type="text"
            name="headline"
            placeholder="Dublin's most reliable plumbing team"
            defaultValue={page?.headline ?? ""}
          />
        </div>
        <div className="field">
          <label htmlFor="about">About your business</label>
          <textarea
            id="about"
            name="about"
            rows={4}
            placeholder="Who you are, what you do, and why customers choose you."
            defaultValue={page?.about ?? ""}
          />
        </div>
        <div className="field">
          <label htmlFor="services">Services (one per line)</label>
          <textarea
            id="services"
            name="services"
            rows={4}
            placeholder={"Boiler repair\nBathroom installation\nEmergency call-outs"}
            defaultValue={((page?.services as string[]) ?? []).join("\n")}
          />
        </div>
        <div className="field">
          <label htmlFor="hours">Opening hours</label>
          <textarea
            id="hours"
            name="hours"
            rows={4}
            placeholder={"Mon-Fri 08:00-18:00\nSat 09:00-13:00\nSun closed"}
            defaultValue={hoursText}
          />
          <span style={{ fontSize: 11.5, color: "var(--faint)" }}>
            One line per day or range. Write times as 09:00 or 9am — a bare
            &quot;9&quot; is refused rather than guessed at, because 9–5 could
            mean 17:00 or 05:00. Your page shows &quot;Open now&quot; from this,
            and Google reads it too.
          </span>
        </div>
        <div className="field">
          <label htmlFor="areas">Areas you cover</label>
          <textarea
            id="areas"
            name="areas"
            rows={2}
            placeholder="Naas, Newbridge, Kildare town, Sallins"
            defaultValue={areas.join(", ")}
          />
          <span style={{ fontSize: 11.5, color: "var(--faint)" }}>
            Comma separated. &quot;Do you cover Naas?&quot; is the question
            asked before anything gets booked.
          </span>
        </div>
        <div className="field">
          <label htmlFor="phone">Phone (shown on the page)</label>
          <input id="phone" type="tel" name="phone" defaultValue={page?.phone ?? ""} />
        </div>
        <div className="field">
          <label htmlFor="contactEmail">Contact email (lead notifications)</label>
          <input
            id="contactEmail"
            type="email"
            name="contactEmail"
            defaultValue={page?.contact_email ?? ""}
          />
        </div>
        <div className="field" style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <input
            id="published"
            type="checkbox"
            name="published"
            defaultChecked={page?.published ?? false}
            style={{ width: 16, height: 16 }}
          />
          <label htmlFor="published" style={{ margin: 0 }}>
            Published — page is publicly visible
          </label>
        </div>
        <div className="form-actions">
          <SubmitButton pendingText="Saving…">Save page</SubmitButton>
        </div>
      </ActionForm>

      <div>
        <div className="panel panel-block" style={{ marginBottom: 18 }}>
          <h2 className="panel-title">
            <span><span className="sys-index">02 /</span>SEO &amp; content readiness</span>
          </h2>
          <ul className="health-list">
            {seoChecks.map((c) => (
              <li key={c.label} className={c.ok ? "is-done" : ""}>
                <span>{c.label}</span>
              </li>
            ))}
          </ul>
          <p style={{ margin: "12px 0 0", fontSize: 11.5, color: "var(--faint)" }}>
            Complete these in the form — each one makes your page rank and
            convert better. AI content generation is coming to this panel.
          </p>
        </div>

        <div className="panel panel-block">
          <h2 className="panel-title">
            <span><span className="sys-index">03 /</span>Hosting</span>
            <span className={`badge ${page?.published ? "badge-green" : "badge-gray"}`}>
              {page?.published ? "Live" : "Offline"}
            </span>
          </h2>
          <ul className="feed-list">
            <li>
              <span>Hosting</span>
              <span className="feed-time">AutomateIQ edge network</span>
            </li>
            <li>
              <span>SSL certificate</span>
              <span className="feed-time">included &amp; automatic</span>
            </li>
            <li>
              <span>Mobile-optimised</span>
              <span className="feed-time">yes</span>
            </li>
            <li>
              <span>Lead capture form</span>
              <span className="feed-time">built in</span>
            </li>
          </ul>
        </div>
      </div>
      </div>
    </>
  );
}
