/**
 * The Compliance Checklist Agent's core: turn a jurisdiction + authority +
 * application type into the list of things this application needs, then mark
 * off what the uploaded documents actually satisfy.
 *
 * Pure on purpose — no database, no model call — so the two rules that decide
 * whether a customer trusts this product are testable directly:
 *
 *   1. A SPECIFIC AUTHORITY OVERRIDES THE NATIONAL BASELINE, per requirement
 *      code. Fingal asking for something extra must not lose the national
 *      list; Fingal wording a requirement differently must not show it twice.
 *   2. UNKNOWN BEATS SATISFIED. Where the evidence is ambiguous the item is
 *      "unclear", never "satisfied". An applicant who is told a box is ticked
 *      and turns up without the document loses weeks — the whole value of the
 *      product is that its "you're missing this" is believed.
 */

export type Requirement = {
  code: string;
  label: string;
  guidance: string | null;
  mandatory: boolean;
  sort_order: number;
  /** null = the national/default baseline for this application type. */
  authority: string | null;
};

export type UploadedDocument = {
  id: string;
  name: string;
  /** Requirement code the uploader or the AI attributed it to, when known. */
  doc_type: string | null;
};

export type ChecklistItemStatus = "satisfied" | "missing" | "unclear";

export type ChecklistItem = {
  code: string;
  label: string;
  guidance: string | null;
  mandatory: boolean;
  status: ChecklistItemStatus;
  evidenceDocumentId: string | null;
  /** Why it landed where it did — shown to the applicant, never a bare state. */
  reason: string;
};

/**
 * Collapses the national baseline and an authority's own list into one set.
 *
 * Keyed by requirement CODE, authority-specific winning. Ordering is the
 * authority's sort_order where it supplied one, otherwise the baseline's, so a
 * council that reorders its own list doesn't scatter the national items.
 */
export function resolveRequirements(
  all: Requirement[],
  authority: string | null
): Requirement[] {
  const byCode = new Map<string, Requirement>();

  // Baseline first, then let the authority's rows overwrite by code.
  for (const r of all) {
    if (r.authority === null) byCode.set(r.code, r);
  }
  if (authority) {
    for (const r of all) {
      if (r.authority === authority) byCode.set(r.code, r);
    }
  }

  return [...byCode.values()].sort(
    (a, b) => a.sort_order - b.sort_order || a.code.localeCompare(b.code)
  );
}

/**
 * Marks the checklist against what's been uploaded.
 *
 * A document counts as evidence ONLY when it was explicitly attributed to that
 * requirement code — by the uploader choosing it, or by the Document
 * Intelligence Agent identifying it. Filename guessing is deliberately absent:
 * "site-plan-FINAL-v3.pdf" is not proof that a site layout plan meeting the
 * authority's scale requirement is inside it, and a false "satisfied" here is
 * the most expensive thing this product can do.
 */
export function buildChecklist(
  requirements: Requirement[],
  documents: UploadedDocument[]
): ChecklistItem[] {
  const byCode = new Map<string, UploadedDocument[]>();
  for (const d of documents) {
    if (!d.doc_type) continue;
    const list = byCode.get(d.doc_type) ?? [];
    list.push(d);
    byCode.set(d.doc_type, list);
  }

  return requirements.map((r) => {
    const matches = byCode.get(r.code) ?? [];

    if (matches.length === 0) {
      return {
        code: r.code,
        label: r.label,
        guidance: r.guidance,
        mandatory: r.mandatory,
        status: "missing",
        evidenceDocumentId: null,
        reason: r.mandatory
          ? "Nothing uploaded for this yet — it's required."
          : "Nothing uploaded. Only needed if it applies to your site.",
      };
    }

    if (matches.length > 1) {
      // Not an error, but not a silent pick either: which drawing the assessor
      // reads matters, so the applicant is told to confirm rather than shown a
      // tick over an arbitrary choice.
      return {
        code: r.code,
        label: r.label,
        guidance: r.guidance,
        mandatory: r.mandatory,
        status: "unclear",
        evidenceDocumentId: matches[0].id,
        reason: `${matches.length} documents are attributed to this — confirm which one is the one being submitted.`,
      };
    }

    return {
      code: r.code,
      label: r.label,
      guidance: r.guidance,
      mandatory: r.mandatory,
      status: "satisfied",
      evidenceDocumentId: matches[0].id,
      reason: `Covered by ${matches[0].name}.`,
    };
  });
}

export type ChecklistSummary = {
  total: number;
  satisfied: number;
  missingMandatory: number;
  unclear: number;
  /** True only when every MANDATORY item is satisfied and nothing is unclear. */
  readyToSubmit: boolean;
};

export function summariseChecklist(items: ChecklistItem[]): ChecklistSummary {
  const satisfied = items.filter((i) => i.status === "satisfied").length;
  const unclear = items.filter((i) => i.status === "unclear").length;
  const missingMandatory = items.filter(
    (i) => i.mandatory && i.status === "missing"
  ).length;

  return {
    total: items.length,
    satisfied,
    missingMandatory,
    unclear,
    // Deliberately strict: an unclear item blocks "ready". Optional items that
    // are simply absent do not — they're conditional on the site, and treating
    // a flood risk assessment as blocking for an inland site would train the
    // applicant to ignore this number.
    readyToSubmit: missingMandatory === 0 && unclear === 0,
  };
}
