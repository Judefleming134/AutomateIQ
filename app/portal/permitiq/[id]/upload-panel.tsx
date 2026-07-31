"use client";

import { useActionState } from "react";
import { Upload, Sparkles } from "lucide-react";
import { uploadDocument, setDocumentType } from "../actions";

export function UploadPanel({
  applicationId,
  requirements,
}: {
  applicationId: string;
  requirements: { code: string; label: string }[];
}) {
  const [state, action, pending] = useActionState(uploadDocument, undefined);

  return (
    <form action={action} className="panel panel-block" style={{ display: "grid", gap: 10 }}>
      <input type="hidden" name="application_id" value={applicationId} />

      <div>
        <label htmlFor="pq-file">Document or drawing</label>
        <input id="pq-file" name="file" type="file" required accept=".pdf,.jpg,.jpeg,.png,.webp" />
        <p style={{ fontSize: 12, color: "var(--faint)", margin: "4px 0 0" }}>
          PDF or image, up to 25MB. <Sparkles size={11} style={{ display: "inline", verticalAlign: -1 }} />{" "}
          We read it and suggest what it covers — you can always correct it.
        </p>
      </div>

      <div>
        <label htmlFor="pq-doctype">What is it? (optional)</label>
        <select id="pq-doctype" name="doc_type" defaultValue="">
          <option value="">Let PermitIQ work it out</option>
          {requirements.map((r) => (
            <option key={r.code} value={r.code}>
              {r.label}
            </option>
          ))}
        </select>
        <p style={{ fontSize: 12, color: "var(--faint)", margin: "4px 0 0" }}>
          If you pick one, your choice wins — we never overwrite it.
        </p>
      </div>

      {state?.error && (
        <p className="form-error" role="alert">
          {state.error}
        </p>
      )}

      <button type="submit" className="btn btn-primary" disabled={pending}>
        <Upload size={14} /> {pending ? "Uploading and reading…" : "Upload document"}
      </button>
    </form>
  );
}

/** Inline correction of the AI's attribution, right where the doubt appears. */
export function ReclassifyForm({
  applicationId,
  documentId,
  current,
  requirements,
}: {
  applicationId: string;
  documentId: string;
  current: string | null;
  requirements: { code: string; label: string }[];
}) {
  const [state, action, pending] = useActionState(setDocumentType, undefined);

  return (
    <form action={action} style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
      <input type="hidden" name="application_id" value={applicationId} />
      <input type="hidden" name="document_id" value={documentId} />
      <select name="doc_type" defaultValue={current ?? ""} style={{ maxWidth: 260 }}>
        <option value="">Not attributed</option>
        {requirements.map((r) => (
          <option key={r.code} value={r.code}>
            {r.label}
          </option>
        ))}
      </select>
      <button type="submit" className="btn btn-secondary btn-sm" disabled={pending}>
        {pending ? "Saving…" : "Save"}
      </button>
      {state?.error && <span className="form-error">{state.error}</span>}
    </form>
  );
}
