"use client";

import { useActionState } from "react";
import { FilePlus } from "lucide-react";
import { createApplication } from "./actions";

/**
 * Ireland's types are real and seeded. The US list is deliberately present but
 * empty of seeded requirements — Jude asked for Ireland production-ready with
 * the USA visible, and pretending a US checklist exists would be worse than
 * saying plainly that it doesn't yet.
 */
const TYPES_BY_JURISDICTION: Record<string, { value: string; label: string }[]> = {
  ie: [
    { value: "planning_permission", label: "Planning permission" },
    { value: "retention_permission", label: "Retention permission" },
  ],
  us: [{ value: "building_permit", label: "Building permit" }],
};

export function ApplicationForm({ jurisdiction }: { jurisdiction: "ie" | "us" }) {
  const [state, action, pending] = useActionState(createApplication, undefined);
  const types = TYPES_BY_JURISDICTION[jurisdiction] ?? [];

  return (
    <form action={action} className="panel panel-block" style={{ display: "grid", gap: 10 }}>
      <input type="hidden" name="jurisdiction" value={jurisdiction} />

      <div>
        <label htmlFor="pq-type">Application type</label>
        <select id="pq-type" name="application_type" required>
          {types.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="pq-address">Site address</label>
        <input id="pq-address" name="site_address" maxLength={400} placeholder="12 Main Street, Swords, Co. Dublin" />
      </div>

      <div>
        <label htmlFor="pq-authority">Planning authority (optional)</label>
        <input
          id="pq-authority"
          name="authority"
          maxLength={160}
          placeholder="e.g. Fingal County Council"
        />
        <p style={{ fontSize: 12, color: "var(--faint)", margin: "4px 0 0" }}>
          Leave blank and we use the national requirements. Naming the authority
          adds anything specific they ask for.
        </p>
      </div>

      <div>
        <label htmlFor="pq-applicant">Applicant name</label>
        <input id="pq-applicant" name="applicant_name" maxLength={200} />
      </div>

      <div>
        <label htmlFor="pq-ref">Your reference (optional)</label>
        <input id="pq-ref" name="reference" maxLength={120} placeholder="Job number or client name" />
      </div>

      {state?.error && (
        <p className="form-error" role="alert">
          {state.error}
        </p>
      )}

      <button type="submit" className="btn btn-primary" disabled={pending}>
        <FilePlus size={14} /> {pending ? "Creating…" : "Create application"}
      </button>
    </form>
  );
}
