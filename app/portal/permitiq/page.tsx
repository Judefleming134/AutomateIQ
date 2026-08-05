import Link from "next/link";
import { FileCheck, MapPin } from "lucide-react";
import { requireSession } from "@/lib/auth/require-session";
import { createClient } from "@/lib/supabase/server";
import { ApplicationForm } from "./application-form";
import { isMissingTableError } from "@/lib/db/errors";

export const metadata = { title: "PlanIQ — AutomateIQ" };

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  in_review: "In review",
  submitted: "Submitted",
  granted: "Granted",
  refused: "Refused",
  withdrawn: "Withdrawn",
};

type AppRow = {
  id: string;
  reference: string | null;
  jurisdiction: string;
  authority: string | null;
  application_type: string;
  site_address: string | null;
  status: string;
  created_at: string;
};

export default async function PermitIqHome({
  searchParams,
}: {
  searchParams: Promise<{ jurisdiction?: string }>;
}) {
  await requireSession();
  const { jurisdiction: jParam } = await searchParams;
  const jurisdiction = jParam === "us" ? "us" : "ie";

  const supabase = await createClient();
  // RLS scopes this to the caller's own business.
  const { data, error } = await supabase
    .from("pq_applications")
    .select("id, reference, jurisdiction, authority, application_type, site_address, status, created_at")
    .order("created_at", { ascending: false })
    .limit(50);

  // The migration hasn't been pasted in yet. Say so plainly rather than
  // rendering an empty list that looks like "you have no applications".
  // Via the shared check, not a bare 42P01: PostgREST answers PGRST205 for a
  // missing table over the REST API, so the direct code test missed the
  // ordinary case and the page showed a convincing, wrong "nothing here yet".
  const migrationMissing = isMissingTableError(error);
  const applications = (data ?? []) as AppRow[];

  return (
    <div>
      <h1 className="page-title">
        <FileCheck size={20} /> PlanIQ
      </h1>
      <p className="page-sub">
        Planning permission in Ireland, building permits in the US. Upload the
        drawings and reports and get a checklist, a plain-English summary and
        the gaps — before you submit.
      </p>

      {migrationMissing && (
        <div className="panel panel-block" style={{ borderLeft: "3px solid var(--amber, #f59e0b)" }}>
          <strong>Almost ready.</strong> The PlanIQ tables aren&apos;t in the
          database yet — run <code>supabase/migrations/0033_permitiq.sql</code> in
          the Supabase SQL editor and this page comes to life.
        </div>
      )}

      <div style={{ display: "flex", gap: 8, margin: "18px 0 14px", flexWrap: "wrap" }}>
        <Link
          href="/portal/permitiq?jurisdiction=ie"
          className={`btn btn-sm ${jurisdiction === "ie" ? "btn-primary" : "btn-secondary"}`}
        >
          🇮🇪 Ireland
        </Link>
        <Link
          href="/portal/permitiq?jurisdiction=us"
          className={`btn btn-sm ${jurisdiction === "us" ? "btn-primary" : "btn-secondary"}`}
        >
          🇺🇸 United States
        </Link>
      </div>

      {/* This panel used to say "US permits are set up but not yet stocked",
          which was true and is no longer: migration 0044 seeds the baseline a
          residential building permit asks for almost everywhere. What is still
          true, and stays said out loud, is that US permitting is set city by
          city — so the baseline is a starting point and a named building
          department overrides it item by item. */}
      {jurisdiction === "us" && (
        <div className="panel panel-block" style={{ marginBottom: 14 }}>
          <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.6 }}>
            <strong>US permits run off a typical baseline.</strong> Building
            permits are set by each city or county, not nationally, so the
            checklist starts from what a residential building permit asks for
            almost everywhere. Name your building department on the application
            and anything specific they require is layered on top — tell us which
            one you need and it&apos;s a data load, not a rebuild.
          </p>
        </div>
      )}

      <div className="grid-2" style={{ gap: 18, alignItems: "start" }}>
        <div>
          <h2 className="section-title">Your applications</h2>
          {applications.length === 0 ? (
            <div className="panel panel-block">
              <p style={{ margin: 0, fontSize: 13.5 }}>
                {migrationMissing
                  ? "Nothing to show until the database is updated."
                  : "No applications yet. Create one on the right — you can upload drawings straight after."}
              </p>
            </div>
          ) : (
            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 8 }}>
              {applications.map((a) => (
                <li key={a.id}>
                  <Link
                    href={`/portal/permitiq/${a.id}`}
                    className="panel panel-block"
                    style={{ display: "block", textDecoration: "none" }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                      <strong style={{ fontSize: 14 }}>
                        {a.reference || a.site_address || "Untitled application"}
                      </strong>
                      <span className="badge badge-gray">
                        {STATUS_LABEL[a.status] ?? a.status}
                      </span>
                    </div>
                    <p style={{ margin: "4px 0 0", fontSize: 12.5, color: "var(--faint)" }}>
                      {a.application_type.replace(/_/g, " ")}
                      {a.authority ? ` · ${a.authority}` : ""}
                      {a.site_address ? (
                        <>
                          {" · "}
                          <MapPin size={11} style={{ display: "inline", verticalAlign: -1 }} />{" "}
                          {a.site_address}
                        </>
                      ) : null}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <h2 className="section-title">New application</h2>
          <ApplicationForm jurisdiction={jurisdiction} />
        </div>
      </div>
    </div>
  );
}
