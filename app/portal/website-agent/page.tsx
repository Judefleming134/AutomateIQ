import { Globe, Users } from "lucide-react";
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

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://automateiq.ie";
  const slug = page?.slug ?? defaultSlug(business?.name ?? "");
  const publicUrl = `${siteUrl}/b/${slug}`;

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
      </div>

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
    </>
  );
}
