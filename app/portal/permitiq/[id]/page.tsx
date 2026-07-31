import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CheckCircle2, CircleAlert, CircleDashed, FileText } from "lucide-react";
import { requireSession } from "@/lib/auth/require-session";
import { createClient } from "@/lib/supabase/server";
import {
  resolveRequirements,
  buildChecklist,
  summariseChecklist,
  type Requirement,
} from "@/lib/permitiq/checklist";
import { UploadPanel, ReclassifyForm, ReviewButton } from "./upload-panel";

export const metadata = { title: "Application — PermitIQ" };

// Uploading a large drawing and then READING it with the model is the one
// slow path in this product; the default budget is not enough for a big PDF.
export const maxDuration = 60;

type RiskFlagRow = { severity: string; title: string; detail?: string };

type DocRow = {
  id: string;
  name: string;
  doc_type: string | null;
  content_type: string | null;
  created_at: string;
  extraction: { summary?: string; issues?: string[]; confidence?: string } | null;
};

export default async function ApplicationPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireSession();
  const { id } = await params;
  const supabase = await createClient();

  const { data: app } = await supabase
    .from("pq_applications")
    .select("id, reference, jurisdiction, authority, application_type, site_address, applicant_name, status, created_at")
    .eq("id", id)
    .maybeSingle();
  if (!app) notFound();

  const [{ data: reqRows }, { data: docRows }, { data: eventRows }, { data: latestReview }] =
    await Promise.all([
    supabase
      .from("pq_requirements")
      .select("code, label, guidance, mandatory, sort_order, authority")
      .eq("jurisdiction", app.jurisdiction)
      .eq("application_type", app.application_type),
    supabase
      .from("pq_documents")
      .select("id, name, doc_type, content_type, created_at, extraction")
      .eq("application_id", id)
      .order("created_at", { ascending: false }),
    supabase
      .from("pq_events")
      .select("type, detail, created_at")
      .eq("application_id", id)
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from("pq_reviews")
      .select("summary, risk_flags, created_at")
      .eq("application_id", id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const requirements = resolveRequirements(
    (reqRows ?? []) as Requirement[],
    app.authority
  );
  const documents = (docRows ?? []) as DocRow[];
  const checklist = buildChecklist(
    requirements,
    documents.map((d) => ({ id: d.id, name: d.name, doc_type: d.doc_type }))
  );
  const summary = summariseChecklist(checklist);
  const reqOptions = requirements.map((r) => ({ code: r.code, label: r.label }));

  const icon = (status: string) =>
    status === "satisfied" ? (
      <CheckCircle2 size={15} color="#34d399" />
    ) : status === "unclear" ? (
      <CircleAlert size={15} color="#f59e0b" />
    ) : (
      <CircleDashed size={15} color="var(--faint)" />
    );

  return (
    <div>
      <Link href="/portal/permitiq" className="btn btn-secondary btn-sm" style={{ marginBottom: 12 }}>
        <ArrowLeft size={13} /> All applications
      </Link>

      <h1 className="page-title">
        {app.reference || app.site_address || "Application"}
      </h1>
      <p className="page-sub">
        {app.application_type.replace(/_/g, " ")}
        {app.authority ? ` · ${app.authority}` : " · national requirements"}
        {app.jurisdiction === "us" ? " · United States" : " · Ireland"}
      </p>

      {/* One honest headline. readyToSubmit is strict on purpose: an unclear
          item blocks it, because a number the applicant can't trust is worse
          than no number. */}
      <div
        className="panel panel-block"
        style={{
          marginBottom: 16,
          borderLeft: `3px solid ${summary.readyToSubmit ? "#34d399" : "#f59e0b"}`,
        }}
      >
        {requirements.length === 0 ? (
          <p style={{ margin: 0, fontSize: 14 }}>
            <strong>No requirement list loaded for this type yet.</strong> You can
            still upload and store everything here — there&apos;s just nothing to
            check it against until the catalog covers{" "}
            {app.jurisdiction === "us" ? "this municipality" : "this application type"}.
          </p>
        ) : summary.readyToSubmit ? (
          <p style={{ margin: 0, fontSize: 14 }}>
            <strong>Everything required is here.</strong> {summary.satisfied} of{" "}
            {summary.total} items covered, nothing mandatory outstanding.
          </p>
        ) : (
          <p style={{ margin: 0, fontSize: 14 }}>
            <strong>
              {summary.missingMandatory > 0
                ? `${summary.missingMandatory} required ${summary.missingMandatory === 1 ? "item is" : "items are"} missing.`
                : `${summary.unclear} ${summary.unclear === 1 ? "item needs" : "items need"} confirming.`}
            </strong>{" "}
            {summary.satisfied} of {summary.total} covered so far.
          </p>
        )}
      </div>

      {latestReview && (
        <div className="panel panel-block" style={{ marginBottom: 16 }}>
          <p className="aseo-block-label">
            PermitIQ review ·{" "}
            {new Date(latestReview.created_at as string).toLocaleDateString("en-IE", {
              day: "numeric",
              month: "short",
            })}
          </p>
          <p style={{ margin: "0 0 10px", fontSize: 13.5, lineHeight: 1.6 }}>
            {latestReview.summary as string}
          </p>
          {Array.isArray(latestReview.risk_flags) && latestReview.risk_flags.length > 0 && (
            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 6 }}>
              {(latestReview.risk_flags as RiskFlagRow[]).map((f, n) => (
                <li key={n} style={{ fontSize: 12.5, lineHeight: 1.55 }}>
                  <span
                    className={`badge ${
                      f.severity === "high"
                        ? "badge-red"
                        : f.severity === "medium"
                          ? "badge-orange"
                          : "badge-gray"
                    }`}
                  >
                    {f.severity}
                  </span>{" "}
                  <strong>{f.title}</strong>
                  {f.detail ? ` — ${f.detail}` : ""}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="grid-2" style={{ gap: 18, alignItems: "start" }}>
        <div>
          <h2 className="section-title">Checklist</h2>
          {checklist.length === 0 ? (
            <div className="panel panel-block">
              <p style={{ margin: 0, fontSize: 13.5 }}>
                No requirements loaded for this application type.
              </p>
            </div>
          ) : (
            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 8 }}>
              {checklist.map((item) => (
                <li key={item.code} className="panel panel-block">
                  <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                    <span style={{ marginTop: 2 }}>{icon(item.status)}</span>
                    <div style={{ flex: 1 }}>
                      <strong style={{ fontSize: 13.5 }}>{item.label}</strong>
                      {!item.mandatory && (
                        <span className="badge badge-gray" style={{ marginLeft: 6 }}>
                          If it applies
                        </span>
                      )}
                      <p style={{ margin: "3px 0 0", fontSize: 12.5, color: "var(--faint)" }}>
                        {item.reason}
                      </p>
                      {item.guidance && item.status !== "satisfied" && (
                        <p style={{ margin: "5px 0 0", fontSize: 12.5, lineHeight: 1.55 }}>
                          {item.guidance}
                        </p>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <h2 className="section-title" style={{ marginTop: 22 }}>
            Documents ({documents.length})
          </h2>
          {documents.length === 0 ? (
            <div className="panel panel-block">
              <p style={{ margin: 0, fontSize: 13.5 }}>
                Nothing uploaded yet.
              </p>
            </div>
          ) : (
            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 8 }}>
              {documents.map((d) => (
                <li key={d.id} className="panel panel-block">
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <FileText size={14} />
                    <strong style={{ fontSize: 13.5 }}>{d.name}</strong>
                    {!d.doc_type && (
                      <span className="badge badge-gray">Not attributed</span>
                    )}
                  </div>
                  {d.extraction?.summary && (
                    <p style={{ margin: "6px 0 0", fontSize: 12.5, lineHeight: 1.55 }}>
                      {d.extraction.summary}
                    </p>
                  )}
                  {d.extraction?.issues && d.extraction.issues.length > 0 && (
                    <ul style={{ margin: "6px 0 0", paddingLeft: 18, fontSize: 12.5 }}>
                      {d.extraction.issues.map((iss, n) => (
                        <li key={n} style={{ color: "#f59e0b" }}>
                          {iss}
                        </li>
                      ))}
                    </ul>
                  )}
                  {reqOptions.length > 0 && (
                    <div style={{ marginTop: 8 }}>
                      <ReclassifyForm
                        applicationId={id}
                        documentId={d.id}
                        current={d.doc_type}
                        requirements={reqOptions}
                      />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <h2 className="section-title">Review</h2>
          <div className="panel panel-block" style={{ marginBottom: 18 }}>
            <p style={{ margin: "0 0 10px", fontSize: 12.5, color: "var(--faint)", lineHeight: 1.55 }}>
              Reads everything uploaded so far against the checklist and writes a
              summary, the risks an assessor would flag, and what to do next.
            </p>
            <ReviewButton applicationId={id} />
          </div>

          <h2 className="section-title">Add a document</h2>
          <UploadPanel applicationId={id} requirements={reqOptions} />

          <h2 className="section-title" style={{ marginTop: 22 }}>
            History
          </h2>
          <div className="panel panel-block">
            {(eventRows ?? []).length === 0 ? (
              <p style={{ margin: 0, fontSize: 13 }}>Nothing yet.</p>
            ) : (
              <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 6 }}>
                {(eventRows ?? []).map((e, n) => (
                  <li key={n} style={{ fontSize: 12.5 }}>
                    <span style={{ color: "var(--faint)" }}>
                      {new Date(e.created_at as string).toLocaleDateString("en-IE", {
                        day: "numeric",
                        month: "short",
                      })}
                    </span>{" "}
                    — {String(e.detail ?? e.type)}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
