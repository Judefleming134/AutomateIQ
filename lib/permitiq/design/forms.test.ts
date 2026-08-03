import { describe, it, expect } from "vitest";
import { EMPTY_OPENINGS, type DesignBrief } from "./brief";
import {
  feeClassFor,
  feeFor,
  IE_FEE_RATES,
  OUTLINE_MULTIPLIER,
  rateFor,
  RETENTION_MULTIPLIER,
} from "./fees";
import {
  type ApplicationContext,
  type ApplicationKind,
  applicationFormFields,
  developmentDescription,
  newspaperNotice,
  NOTICE_LEAD_DAYS,
  noticeDates,
  outstandingFormFields,
  SITE_NOTICE_DISPLAY_WEEKS,
  siteNotice,
} from "./forms";

/**
 * Most Irish planning applications that fail are not failed on the drawings.
 * They are failed on the notices and the fee — wrong wording, published too
 * early, erected too late, taken down before five weeks are up, a description
 * that doesn't match the form, or the wrong side of the "greater of area rate
 * or minimum" comparison.
 *
 * Every one of those is mechanical, which is why it belongs in code. These
 * tests pin the mechanics, and pin the two things the module refuses to do:
 * claim the wording is approved, and guess an answer only the applicant holds.
 */

const brief = (over: Partial<DesignBrief> = {}): DesignBrief => ({
  site: { widthM: 20, depthM: 32, frontage: "south" },
  existing: {
    label: "Existing dwelling", widthM: 9, depthM: 8, offsetXM: 5.5, offsetYM: 6,
    storeys: 2, eavesHeightM: 5, ridgeHeightM: 8, roof: "pitched",
  },
  proposed: {
    label: "Proposed extension", widthM: 6, depthM: 4, offsetXM: 7, offsetYM: 14,
    storeys: 1, eavesHeightM: 2.7, ridgeHeightM: 3.9, roof: "pitched",
    externalFinish: "nap plaster to match existing",
  },
  works: "extension",
  rooms: [{ name: "Kitchen/dining", widthM: 4, depthM: 4 }],
  openings: { ...EMPTY_OPENINGS, north: { windows: 2, doors: 1 } },
  access: { drivewayWidthM: 3.2, parkingSpaces: 2 },
  openSpaceM2: 180,
  ...over,
});

const ctx = (over: Partial<ApplicationContext> = {}): ApplicationContext => {
  const b = over.brief ?? brief();
  const kind: ApplicationKind = over.kind ?? "planning_permission";
  return {
    kind,
    authority: "Fingal County Council",
    siteAddress: "14 Maple Drive, Swords, Co. Dublin",
    applicant: {
      name: "Jude Fleming",
      addressLines: ["14 Maple Drive", "Swords", "Co. Dublin"],
      email: "jude@example.ie",
      interestInLand: "Owner",
    },
    intendedApplicationDate: "2026-09-01",
    brief: b,
    fee: feeFor({ brief: b, applicationType: kind, onDate: "2026-09-01" }),
    ...over,
  };
};

describe("the fee arithmetic, which is where people go wrong", () => {
  it("maps works onto the right Schedule 9 class", () => {
    expect(feeClassFor("extension")).toBe("domestic_works");
    expect(feeClassFor("conversion")).toBe("domestic_works");
    expect(feeClassFor("garage_outbuilding")).toBe("domestic_works");
    expect(feeClassFor("new_dwelling")).toBe("dwelling");
    expect(feeClassFor("demolition_and_rebuild")).toBe("dwelling");
    expect(feeClassFor("change_of_use")).toBe("change_of_use");
  });

  it("charges the flat fee for domestic works", () => {
    const r = feeFor({ brief: brief(), applicationType: "planning_permission", onDate: "2026-09-01" });
    expect(r.totalEur).toBe(34);
    expect(r.lines).toHaveLength(1);
  });

  it("charges per dwelling, and counts them", () => {
    const r = feeFor({
      brief: brief({ works: "new_dwelling" }),
      applicationType: "planning_permission",
      dwellingCount: 3,
      onDate: "2026-09-01",
    });
    expect(r.totalEur).toBe(195); // 65 × 3
    expect(r.lines[0].workingOut).toContain("× 3 dwellings");
  });

  it("takes the GREATER of the area rate and the minimum, and shows both", () => {
    // The single most common way the area class is got wrong.
    const small = feeFor({
      brief: brief({ works: "change_of_use" }),
      applicationType: "planning_permission",
      onDate: "2026-09-01",
    });
    expect(small.totalEur).toBe(80); // flat for change of use
    // An area-based class with a small floor area falls back to the minimum.
    const rate = rateFor("other_buildings", "2026-09-01")!;
    expect(rate.perM2Eur).toBe(3.6);
    expect(rate.minimumEur).toBe(80);
    // 24m² × 3.6 = 86.40 — above the 80 minimum, so the area rate wins.
    expect(24 * rate.perM2Eur!).toBeGreaterThan(rate.minimumEur!);
  });

  it("charges retention at three times, and says so in words", () => {
    const r = feeFor({ brief: brief(), applicationType: "retention_permission", onDate: "2026-09-01" });
    expect(r.totalEur).toBe(34 * RETENTION_MULTIPLIER);
    expect(r.lines.at(-1)!.workingOut).toContain("3× the normal fee");
  });

  it("discounts an outline application rather than charging full", () => {
    const r = feeFor({ brief: brief(), applicationType: "outline_permission", onDate: "2026-09-01" });
    expect(r.totalEur).toBe(34 * OUTLINE_MULTIPLIER);
  });

  it("shows the working for every line — the working IS the product", () => {
    const r = feeFor({ brief: brief(), applicationType: "retention_permission", onDate: "2026-09-01" });
    for (const line of r.lines) expect(line.workingOut.length).toBeGreaterThan(10);
  });

  it("carries a verify note that names its source and its date", () => {
    const r = feeFor({ brief: brief(), applicationType: "planning_permission", onDate: "2026-09-01" });
    expect(r.verifyNote).toContain("Schedule 9");
    expect(r.verifyNote).toContain("confirm the current amount");
    expect(r.rate!.effectiveFrom).toBeTruthy();
  });

  it("never claims an exemption — it asks the question instead", () => {
    // Reliefs turn on facts this product doesn't hold. Claiming one would be
    // the expensive kind of confident.
    const r = feeFor({ brief: brief(), applicationType: "planning_permission", onDate: "2026-09-01" });
    expect(r.questionsToAsk.some((q) => q.includes("exemption or reduction"))).toBe(true);
    expect(r.totalEur).toBe(34); // no relief silently applied
  });

  it("picks the rate in force on the date, not the newest on file", () => {
    // Dated catalog, so a future rate change can be seeded ahead of time
    // without retro-pricing applications already quoted.
    const future = [...IE_FEE_RATES];
    expect(rateFor("domestic_works", "2000-01-01")).toBeNull();
    expect(rateFor("domestic_works", "2026-09-01")!.flatEur).toBe(34);
    expect(future.every((r) => r.effectiveFrom && r.source)).toBe(true);
  });

  it("refuses to invent a fee when no rate is on file", () => {
    const r = feeFor({ brief: brief(), applicationType: "planning_permission", onDate: "1999-01-01" });
    expect(r.totalEur).toBe(0);
    expect(r.rate).toBeNull();
    expect(r.verifyNote).toContain("straight from the planning authority");
  });
});

describe("the dates, which are arithmetic people do in their heads", () => {
  const d = noticeDates("2026-09-01");

  it("opens the publish window exactly two weeks before", () => {
    expect(d.publishFrom).toBe("2026-08-18"); // 14 days
    expect(d.publishBy).toBe("2026-09-01");
    expect(NOTICE_LEAD_DAYS).toBe(14);
  });

  it("keeps the site notice up for five weeks from the application", () => {
    expect(d.siteNoticeUntil).toBe("2026-10-06"); // +35 days
    expect(SITE_NOTICE_DISPLAY_WEEKS).toBe(5);
  });

  it("gives the submission deadline third parties get", () => {
    expect(d.submissionsUntil).toBe("2026-10-06");
  });

  it("crosses a month boundary without drifting", () => {
    expect(noticeDates("2026-01-05").publishFrom).toBe("2025-12-22");
    expect(noticeDates("2026-03-05").publishFrom).toBe("2026-02-19"); // through Feb
  });
});

describe("one description, used in all three documents", () => {
  it("is the same sentence on the form and both notices", () => {
    // Three separately typed descriptions drifting apart is the classic
    // invalidation this exists to prevent.
    const c = ctx();
    const description = developmentDescription(c.brief, c.kind);
    expect(newspaperNotice(c).body).toContain(description);
    expect(siteNotice(c).body).toContain(description);
    const field = applicationFormFields(c).find(
      (f) => f.label === "Description of the development"
    );
    expect(field!.value).toBe(description);
  });

  it("leads with the right kind of permission", () => {
    // The lead words are load-bearing: a retention application whose notice
    // reads as an ordinary permission is describing the wrong application.
    const ordinary = developmentDescription(brief(), "planning_permission");
    const retention = developmentDescription(brief(), "retention_permission");
    const outline = developmentDescription(brief(), "outline_permission");

    expect(ordinary.startsWith("permission for")).toBe(true);
    expect(retention.startsWith("RETENTION permission for")).toBe(true);
    expect(outline.startsWith("OUTLINE permission for")).toBe(true);

    // And an ordinary application must not pick up either qualifier.
    expect(ordinary).not.toContain("RETENTION");
    expect(ordinary).not.toContain("OUTLINE");
  });

  it("quotes the floor area the drawings quote", () => {
    // 6 × 4 single storey = 24m². The form, the notices and PL-02 must agree.
    expect(developmentDescription(brief(), "planning_permission")).toContain("24m²");
  });

  it("describes storeys the way a notice does", () => {
    expect(developmentDescription(brief(), "planning_permission")).toContain("single-storey");
    const twoStorey = brief({ proposed: { ...brief().proposed, storeys: 2 } });
    expect(developmentDescription(twoStorey, "planning_permission")).toContain("2-storey");
  });

  it("includes the parking and the catch-all site works a notice needs", () => {
    const desc = developmentDescription(brief(), "planning_permission");
    expect(desc).toContain("2 car parking spaces");
    expect(desc).toContain("all associated site works");
  });
});

describe("the notices carry what the Regulations require", () => {
  const c = ctx();
  const paper = newspaperNotice(c);
  const site = siteNotice(c);

  it("names the planning authority", () => {
    expect(paper.body).toContain("FINGAL COUNTY COUNCIL");
    expect(site.body).toContain("FINGAL COUNTY COUNCIL");
  });

  it("names the applicant and the site", () => {
    for (const n of [paper, site]) {
      expect(n.body).toContain("Jude Fleming");
      expect(n.body).toContain("14 Maple Drive, Swords, Co. Dublin");
    }
  });

  it("says the application can be inspected or purchased", () => {
    for (const n of [paper, site]) {
      expect(n.body).toContain("may be inspected, or purchased");
      expect(n.body).toContain("public opening hours");
    }
  });

  it("states the five-week submission window", () => {
    for (const n of [paper, site]) {
      expect(n.body).toContain("period of 5 weeks");
      expect(n.body).toContain("prescribed fee");
    }
  });

  it("flags a retention application as retention on both", () => {
    const r = ctx({ kind: "retention_permission" });
    expect(newspaperNotice(r).body).toContain("RETENTION");
    expect(siteNotice(r).body).toContain("RETENTION");
  });

  it("gives the site notice somewhere to sign and date", () => {
    expect(site.body).toContain("Signed:");
    expect(site.body).toContain("Date of erection");
  });

  it("maps onto the checklist codes that already exist", () => {
    expect(paper.requirementCode).toBe("public_notice_newspaper");
    expect(site.requirementCode).toBe("public_notice_site");
  });
});

describe("the rules attached to each notice", () => {
  const c = ctx();

  it("tells them the publish window in actual dates", () => {
    expect(newspaperNotice(c).rules.join(" ")).toContain("2026-08-18");
    expect(newspaperNotice(c).rules.join(" ")).toContain("2026-09-01");
  });

  it("tells them to send the original page, not a photocopy", () => {
    expect(newspaperNotice(c).rules.join(" ")).toContain("not a photocopy");
  });

  it("tells them the approved-newspaper list is the authority's", () => {
    expect(newspaperNotice(c).rules.join(" ")).toContain("approved by Fingal County Council");
  });

  it("tells them how long the site notice stays up, with the date", () => {
    expect(siteNotice(c).rules.join(" ")).toContain("2026-10-06");
    expect(siteNotice(c).rules.join(" ")).toContain("blown down or faded");
  });

  it("tells them to laminate it, which is the usual failure", () => {
    expect(siteNotice(c).rules.join(" ")).toContain("Laminate");
  });

  it("does NOT assert a paper colour it cannot be sure of", () => {
    // Colour requirements differ by application type and authority. Asserting
    // one confidently would be the kind of specific-and-wrong that invalidates
    // a notice, so it asks rather than tells.
    const rules = siteNotice(c).rules.join(" ");
    expect(rules).toContain("Confirm the required paper colour");
    expect(rules).not.toMatch(/must be (white|yellow)/i);
  });

  it("warns that all three documents must match word for word", () => {
    expect(newspaperNotice(c).rules.join(" ")).toContain("word for word");
    expect(siteNotice(c).rules.join(" ")).toContain("word for word");
  });

  it("never claims the wording is approved", () => {
    for (const n of [newspaperNotice(c), siteNotice(c)]) {
      expect(n.verifyNote).toContain("DRAFT");
      expect(n.verifyNote).toContain("template published by the planning authority");
      expect(n.title).toContain("draft");
    }
  });
});

describe("the application form is answers, not a replica", () => {
  const c = ctx();
  const fields = applicationFormFields(c);
  const byLabel = (l: string) => fields.find((f) => f.label === l)!;

  it("prefills everything the brief can answer", () => {
    expect(byLabel("Name of applicant").value).toBe("Jude Fleming");
    expect(byLabel("Site area").value).toBe("640 m²");
    expect(byLabel("Gross floor space of proposed works").value).toBe("24 m²");
    expect(byLabel("Number of storeys proposed").value).toBe("1");
    expect(byLabel("Site coverage").value).toBe("15%");
    expect(byLabel("Car parking spaces proposed").value).toBe("2");
    expect(byLabel("Type of permission sought").value).toBe("Permission");
  });

  it("leaves a gap, with a helper, where only the applicant knows", () => {
    // A guessed answer on a statutory form is worse than an obvious gap.
    for (const label of [
      "Ordnance Survey map reference / townland",
      "Proposed water supply",
      "Proposed wastewater treatment",
      "Proposed surface water disposal",
    ]) {
      expect(byLabel(label).value).toBeNull();
      expect(byLabel(label).helper!.length).toBeGreaterThan(20);
    }
  });

  it("points the map reference at the map they have to buy", () => {
    expect(byLabel("Ordnance Survey map reference / townland").helper).toContain(
      "Tailte Éireann"
    );
  });

  it("collects the outstanding fields into a before-you-lodge list", () => {
    const outstanding = outstandingFormFields(c);
    expect(outstanding.length).toBeGreaterThan(3);
    expect(outstanding.every((f) => !f.value)).toBe(true);
    expect(outstanding.map((f) => f.label)).toContain("Proposed water supply");
  });

  it("routes correspondence to the agent when there is one", () => {
    expect(byLabel("Correspondence to be sent to").value).toBe("Applicant");
    const withAgent = ctx({
      applicant: { ...c.applicant, agentName: "A. Architect" },
    });
    const f = applicationFormFields(withAgent).find(
      (x) => x.label === "Correspondence to be sent to"
    )!;
    expect(f.value).toBe("Agent");
  });

  it("asks for the legal interest, and flags owner consent", () => {
    expect(byLabel("Applicant's legal interest in the land").value).toBe("Owner");
    const noInterest = ctx({ applicant: { ...c.applicant, interestInLand: undefined } });
    const f = applicationFormFields(noInterest).find(
      (x) => x.label === "Applicant's legal interest in the land"
    )!;
    expect(f.helper).toContain("owner's written consent");
  });

  it("carries the fee, with the verify note attached to the field", () => {
    expect(byLabel("Fee payable").value).toBe("€34.00");
    expect(byLabel("Fee payable").helper).toContain("confirm the current amount");
    expect(byLabel("Basis of fee").value).toContain("Flat fee");
  });

  it("puts the notice dates on the notice fields", () => {
    expect(byLabel("Date of newspaper publication").helper).toContain("2026-08-18");
    expect(byLabel("Date site notice erected").helper).toContain("2026-09-01");
  });

  it("groups fields into the sections the form asks in", () => {
    const sections = [...new Set(fields.map((f) => f.section))];
    expect(sections).toEqual([
      "Applicant",
      "Agent",
      "The site",
      "The application",
      "Services",
      "Notices",
      "Fee",
    ]);
  });
});
