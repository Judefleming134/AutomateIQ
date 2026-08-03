/**
 * The paperwork: the application form, the newspaper notice and the site
 * notice.
 *
 * WHERE THE RISK ACTUALLY IS. Most applications that get invalidated in
 * Ireland are not invalidated on the drawings — they are invalidated on the
 * notices. Wrong wording, published too early, erected too late, taken down
 * before the five weeks are up, or a description of the development in the
 * notice that doesn't match the one on the form. Each of those costs the fee
 * and the weeks, and each is entirely mechanical.
 *
 * So this module does three things and refuses a fourth:
 *
 *   1. It writes ONE development description and uses it in all three
 *      documents. A notice that describes different works from the form it
 *      accompanies is the classic invalidation, and it happens because the
 *      three are typed separately.
 *   2. It computes the DATES — publish window, erect-by, keep-up-until — from
 *      the intended application date, because "not more than 2 weeks before"
 *      is an arithmetic problem people do in their heads and get wrong.
 *   3. It generates drafts of both notices with the elements the Regulations
 *      require.
 *
 * And the fourth: IT DOES NOT CLAIM THE WORDING IS APPROVED. Every planning
 * authority publishes its own site-notice and newspaper-notice template, and
 * the prescribed content sits in Articles 17–19 of the Planning and
 * Development Regulations 2001 as amended, which are amended. So each notice
 * carries an instruction to check it against that authority's own template
 * before it is published or erected — the one step that actually protects the
 * applicant, and the one a generator must not pretend to have done for them.
 */

import {
  type DesignBrief,
  briefMetrics,
  WORKS_LABELS,
  type WorksType,
} from "./brief";
import { type FeeResult } from "./fees";

export type ApplicationKind =
  | "planning_permission"
  | "retention_permission"
  | "outline_permission";

export const APPLICATION_KIND_LABELS: Record<ApplicationKind, string> = {
  planning_permission: "Permission",
  retention_permission: "Retention permission",
  outline_permission: "Outline permission",
};

export type ApplicantDetails = {
  name: string;
  addressLines: string[];
  email?: string;
  phone?: string;
  /** Who prepared it, if anyone. Printed as the agent on the form. */
  agentName?: string;
  agentAddressLines?: string[];
  /** Owner / purchaser / lessee — the form asks, and it is not always "owner". */
  interestInLand?: string;
};

export type ApplicationContext = {
  kind: ApplicationKind;
  /** The planning authority, e.g. "Fingal County Council". */
  authority: string;
  siteAddress: string;
  applicant: ApplicantDetails;
  /** The day they intend to lodge it. Every date below is derived from it. */
  intendedApplicationDate: string;
  /** Approved newspaper they intend to publish in. */
  newspaper?: string;
  brief: DesignBrief;
  fee: FeeResult;
};

/** How long before the application a notice may be published or erected. */
export const NOTICE_LEAD_DAYS = 14;
/** How long a site notice must stay up from the date of application. */
export const SITE_NOTICE_DISPLAY_WEEKS = 5;
/** The window for third-party submissions, from receipt of the application. */
export const SUBMISSION_WINDOW_WEEKS = 5;

const addDays = (iso: string, days: number): string => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

export type NoticeDates = {
  /** Not before this date. */
  publishFrom: string;
  /** Must be published/erected on or before the application date. */
  publishBy: string;
  applicationDate: string;
  /** Site notice must remain legible until this date. */
  siteNoticeUntil: string;
  /** Third parties may make a submission until roughly this date. */
  submissionsUntil: string;
};

/**
 * The dates, worked out once.
 *
 * "Not more than two weeks before the application" is the rule people get
 * wrong most often, and they get it wrong by counting from the wrong end. It
 * is arithmetic, so it belongs in code and on the page rather than in the
 * applicant's head.
 */
export function noticeDates(intendedApplicationDate: string): NoticeDates {
  return {
    publishFrom: addDays(intendedApplicationDate, -NOTICE_LEAD_DAYS),
    publishBy: intendedApplicationDate,
    applicationDate: intendedApplicationDate,
    siteNoticeUntil: addDays(intendedApplicationDate, SITE_NOTICE_DISPLAY_WEEKS * 7),
    submissionsUntil: addDays(intendedApplicationDate, SUBMISSION_WINDOW_WEEKS * 7),
  };
}

/**
 * ONE description of the development, used everywhere.
 *
 * Exported because the whole point is that the form, the newspaper notice and
 * the site notice quote the same sentence. Three separately typed descriptions
 * that drift apart is the invalidation this exists to prevent, so nothing here
 * builds its own.
 */
export function developmentDescription(
  brief: DesignBrief,
  kind: ApplicationKind
): string {
  const m = briefMetrics(brief);
  const p = brief.proposed;
  const storeys = p.storeys === 1 ? "single-storey" : `${p.storeys}-storey`;

  const core: Record<WorksType, string> = {
    extension: `a ${storeys} extension of ${m.proposedFloorAreaM2}m² to the ${brief.existing ? "existing dwelling" : "existing building"}`,
    new_dwelling: `a ${storeys} dwelling of ${m.proposedFloorAreaM2}m²`,
    garage_outbuilding: `a ${storeys} garage/outbuilding of ${m.proposedFloorAreaM2}m²`,
    conversion: `the conversion of existing space, with works of ${m.proposedFloorAreaM2}m²`,
    change_of_use: `a change of use, comprising ${m.proposedFloorAreaM2}m²`,
    demolition_and_rebuild: `the demolition of the existing structure and construction of a ${storeys} replacement of ${m.proposedFloorAreaM2}m²`,
  };

  const lead =
    kind === "retention_permission"
      ? "RETENTION permission for"
      : kind === "outline_permission"
        ? "OUTLINE permission for"
        : "permission for";

  const parts = [`${lead} ${core[brief.works]}`];
  if (p.externalFinish) parts.push(`finished in ${p.externalFinish}`);
  if (brief.access.parkingSpaces > 0) {
    parts.push(
      `together with ${brief.access.parkingSpaces} car parking space${brief.access.parkingSpaces === 1 ? "" : "s"}`
    );
  }
  parts.push("and all associated site works");
  return parts.join(", ");
}

export type Notice = {
  kind: "newspaper" | "site";
  /** Requirement code it satisfies on the existing checklist. */
  requirementCode: "public_notice_newspaper" | "public_notice_site";
  title: string;
  body: string;
  /** Rules the applicant must follow for this notice to be valid. */
  rules: string[];
  /** Always present. The UI may not render a notice without it. */
  verifyNote: string;
};

const VERIFY =
  "DRAFT. Check this against the template published by the planning authority before it is used — the prescribed content is set by the Planning and Development Regulations 2001 as amended, and authorities publish their own wording. A notice that does not comply invalidates the application.";

/** The newspaper notice. */
export function newspaperNotice(ctx: ApplicationContext): Notice {
  const d = noticeDates(ctx.intendedApplicationDate);
  const description = developmentDescription(ctx.brief, ctx.kind);
  const body = [
    ctx.authority.toUpperCase(),
    "",
    `I, ${ctx.applicant.name}, intend to apply for ${description} at ${ctx.siteAddress}.`,
    "",
    `The planning application may be inspected, or purchased at a fee not exceeding the reasonable cost of making a copy, at the offices of ${ctx.authority} during its public opening hours.`,
    "",
    `A submission or observation in relation to the application may be made in writing to the planning authority on payment of the prescribed fee within the period of ${SUBMISSION_WINDOW_WEEKS} weeks beginning on the date of receipt by the authority of the application.`,
    ...(ctx.kind === "retention_permission"
      ? ["", "This application is for RETENTION of development already carried out."]
      : []),
  ].join("\n");

  return {
    kind: "newspaper",
    requirementCode: "public_notice_newspaper",
    title: "Newspaper notice (draft)",
    body,
    rules: [
      `Publish in a newspaper approved by ${ctx.authority} that circulates in the area — the authority publishes the list, and a paper not on it does not count.`,
      `Publish no earlier than ${d.publishFrom} and no later than ${d.publishBy}, so it is within ${NOTICE_LEAD_DAYS} days before the application is lodged.`,
      "Send the original newspaper page — not a photocopy or a clipping — with the application.",
      "The development described here must match the description on the application form and the site notice word for word.",
    ],
    verifyNote: VERIFY,
  };
}

/** The site notice. */
export function siteNotice(ctx: ApplicationContext): Notice {
  const d = noticeDates(ctx.intendedApplicationDate);
  const description = developmentDescription(ctx.brief, ctx.kind);
  const body = [
    ctx.authority.toUpperCase(),
    "SITE NOTICE",
    "",
    `Application for ${APPLICATION_KIND_LABELS[ctx.kind].toLowerCase()}.`,
    "",
    `I, ${ctx.applicant.name}, intend to apply for ${description} at ${ctx.siteAddress}.`,
    "",
    `The planning application may be inspected, or purchased at a fee not exceeding the reasonable cost of making a copy, at the offices of ${ctx.authority} during its public opening hours.`,
    "",
    `A submission or observation in relation to the application may be made in writing to the planning authority on payment of the prescribed fee within the period of ${SUBMISSION_WINDOW_WEEKS} weeks beginning on the date of receipt by the authority of the application.`,
    "",
    `Signed: ______________________     Date of erection of site notice: ${d.publishBy}`,
  ].join("\n");

  return {
    kind: "site",
    requirementCode: "public_notice_site",
    title: "Site notice (draft)",
    body,
    rules: [
      `Erect on the land or structure, on or before ${d.publishBy}, and no earlier than ${d.publishFrom}.`,
      `Keep it in place and legible until at least ${d.siteNoticeUntil} — ${SITE_NOTICE_DISPLAY_WEEKS} weeks from the date of application. A notice that has blown down or faded is a notice that was not displayed.`,
      "Position it where it can be easily read from a public road or footpath. If the site fronts more than one road, a notice is needed on each.",
      "Print it in indelible ink and fix it to rigid, durable, weatherproof material. Laminate it — rain on an inkjet print is the usual reason these fail.",
      "Confirm the required paper colour with the authority before printing. Colour requirements differ for some application types, and getting it wrong invalidates the notice.",
      "The development described here must match the description on the application form and the newspaper notice word for word.",
    ],
    verifyNote: VERIFY,
  };
}

export type FormField = {
  section: string;
  label: string;
  /** Prefilled from the brief, or null when only the applicant can answer. */
  value: string | null;
  /** Shown when value is null — what they need and where to get it. */
  helper?: string;
};

/**
 * The application form, as prefilled fields.
 *
 * Deliberately a FIELD LIST, not a rendered replica of any authority's PDF.
 * Every planning authority publishes its own version of the statutory form and
 * they differ in layout and numbering; a replica of one would be wrong at the
 * other thirty counters, and a customer who trusted it would find out at the
 * counter. What transfers cleanly is the ANSWERS — so this produces the
 * answers, labelled the way the form asks for them, to be copied onto whatever
 * form that authority publishes.
 *
 * A field the brief cannot answer comes back with `value: null` and a helper
 * saying where to get it, rather than a blank or a guess. A guessed answer on a
 * statutory form is worse than an obvious gap.
 */
export function applicationFormFields(ctx: ApplicationContext): FormField[] {
  const m = briefMetrics(ctx.brief);
  const b = ctx.brief;
  const d = noticeDates(ctx.intendedApplicationDate);
  const f = (section: string, label: string, value: string | null, helper?: string): FormField => ({
    section,
    label,
    value,
    helper,
  });

  return [
    f("Applicant", "Name of applicant", ctx.applicant.name || null, "The person or body in whose name permission is sought."),
    f("Applicant", "Address of applicant", ctx.applicant.addressLines.join(", ") || null),
    f("Applicant", "Applicant's email", ctx.applicant.email ?? null),
    f("Applicant", "Applicant's telephone", ctx.applicant.phone ?? null),
    f("Agent", "Name of agent (if any)", ctx.applicant.agentName ?? null, "Leave blank if you are applying yourself."),
    f("Agent", "Address of agent", ctx.applicant.agentAddressLines?.join(", ") ?? null),
    f(
      "Agent",
      "Correspondence to be sent to",
      ctx.applicant.agentName ? "Agent" : "Applicant",
      "All correspondence, including the decision, goes to whoever is named here."
    ),

    f("The site", "Postal address / location of the land", ctx.siteAddress || null),
    f("The site", "Site area", `${m.siteAreaM2} m²`),
    f(
      "The site",
      "Ordnance Survey map reference / townland",
      null,
      "Take this from the site location map you purchase from Tailte Éireann — it is not something this form can derive."
    ),
    f(
      "The site",
      "Applicant's legal interest in the land",
      ctx.applicant.interestInLand ?? null,
      "Owner, purchaser, lessee, or other. If you are not the owner, the owner's written consent must be included."
    ),

    f("The application", "Type of permission sought", APPLICATION_KIND_LABELS[ctx.kind]),
    f(
      "The application",
      "Description of the development",
      developmentDescription(b, ctx.kind),
      "This exact wording must also appear on both notices."
    ),
    f("The application", "Nature of the works", WORKS_LABELS[b.works]),
    f("The application", "Gross floor space of proposed works", `${m.proposedFloorAreaM2} m²`),
    f(
      "The application",
      "Gross floor space of any existing structure",
      b.existing ? `${m.existingFootprintM2} m² footprint × ${b.existing.storeys} storey(s)` : "None",
    ),
    f("The application", "Number of storeys proposed", String(b.proposed.storeys)),
    f("The application", "Height to eaves / ridge", `${b.proposed.eavesHeightM}m / ${b.proposed.ridgeHeightM}m`),
    f("The application", "Site coverage", `${m.siteCoveragePct}%`),
    f("The application", "Private open space retained", `${m.openSpaceM2} m²`),
    f("The application", "Car parking spaces proposed", String(b.access.parkingSpaces)),
    f("The application", "External finishes", b.proposed.externalFinish ?? null, "Walls, roof, windows and doors."),

    f(
      "Services",
      "Proposed water supply",
      null,
      "Public mains or private well. The authority asks, and it is a site fact this form doesn't hold."
    ),
    f(
      "Services",
      "Proposed wastewater treatment",
      null,
      "Public sewer or on-site treatment. On-site needs a site characterisation report — see the checklist."
    ),
    f(
      "Services",
      "Proposed surface water disposal",
      null,
      "Where rainwater from the new roof and any hard surfacing will go."
    ),

    f("Notices", "Newspaper in which notice published", ctx.newspaper ?? null, "Must be on the authority's approved list."),
    f("Notices", "Date of newspaper publication", null, `Fill in on the day. Must fall between ${d.publishFrom} and ${d.publishBy}.`),
    f("Notices", "Date site notice erected", null, `Fill in on the day. Must fall between ${d.publishFrom} and ${d.publishBy}.`),

    f(
      "Fee",
      "Fee payable",
      ctx.fee.totalEur > 0 ? `€${ctx.fee.totalEur.toFixed(2)}` : null,
      ctx.fee.verifyNote
    ),
    f("Fee", "Basis of fee", ctx.fee.lines.map((l) => l.workingOut).join("; ") || null),
  ];
}

/** Fields nobody but the applicant can answer — the "before you lodge" list. */
export function outstandingFormFields(ctx: ApplicationContext): FormField[] {
  return applicationFormFields(ctx).filter((f) => f.value === null || f.value === "");
}
