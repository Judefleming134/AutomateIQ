import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * "Import a CSV with this campaign picked" couldn't be done in one step, and
 * doing it the obvious way produced the OPPOSITE result.
 *
 * An empty campaign's empty state offers two routes to fill it. The first read:
 *
 *     None yet. Two ways to fill it: [import a CSV] with this campaign picked
 *     (fastest for a whole niche), or open any prospect and set Campaign on its
 *     Details tab.
 *
 * The link was a bare `/growth/prospects`. On arrival:
 *
 *   1. the CSV panel is a COLLAPSED <details> — you have to find and open it
 *   2. its Campaign select defaults to "__auto__"
 *   3. nothing on the page mentions the campaign you came from
 *
 * And "__auto__" is not a neutral default. importProspects reads it as
 * `autoGroup`: rows are grouped by their INDUSTRY column and matched to an
 * existing campaign or a new one created on the fly. So a user following the
 * sentence literally — click the link, drop the file, press Import — scatters
 * the rows across industry campaigns and leaves the campaign they came from
 * still empty. The default does the opposite of "with this campaign picked".
 *
 * This is the same defect the sentence was already rewritten once for. The
 * comment above it says the old text "pointed at a screen where the thing it
 * named isn't" — that fix corrected the destination and left the promise about
 * what would be picked there undone.
 *
 * Fixed by carrying the id: ?import=<campaignId> opens the panel and preselects
 * the campaign, so the instruction is true in one step.
 */

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const read = (...p: string[]) => readFileSync(path.join(ROOT, ...p), "utf8");

const CAMPAIGN = read("app", "growth", "(app)", "campaigns", "[id]", "page.tsx");
const PROSPECTS = read("app", "growth", "(app)", "prospects", "page.tsx");
const ACTIONS = read("app", "growth", "(app)", "prospects", "actions.ts");

/** The import panel's markup. */
const IMPORT_PANEL = PROSPECTS.slice(
  PROSPECTS.indexOf("⇪ Import from CSV") - 400,
  PROSPECTS.indexOf("Import prospects")
);

describe("the link now carries the campaign", () => {
  it("it is no longer a bare /growth/prospects", () => {
    const code = CAMPAIGN.replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
    expect(code).toContain("/growth/prospects?import=${campaign.id}");
    expect(code).not.toContain('<Link href="/growth/prospects">import a CSV</Link>');
  });

  it("the sentence it makes true is still the sentence on screen", () => {
    // The copy was NOT rewritten to match a weaker behaviour — the behaviour
    // was brought up to the copy.
    expect(CAMPAIGN).toContain("with this campaign picked");
    expect(CAMPAIGN).toContain("import a CSV");
  });
});

describe("the destination honours it", () => {
  it("the panel is already open on arrival", () => {
    expect(IMPORT_PANEL).toContain("open={Boolean(importCampaignId)}");
  });

  it("the campaign is preselected", () => {
    expect(IMPORT_PANEL).toContain('defaultValue={importCampaignId ?? "__auto__"}');
  });

  it("without ?import, nothing changes at all", () => {
    // The panel stays collapsed and the select stays on __auto__ — so the
    // ordinary "import a mixed niche paste" flow is untouched.
    expect(PROSPECTS).toContain("const importCampaignId =");
    expect(PROSPECTS).toContain('params.import && campaignNameById.has(params.import) ? params.import : null');
  });

  it("the select still offers both original options", () => {
    expect(IMPORT_PANEL).toContain('<option value="__auto__">');
    expect(IMPORT_PANEL).toContain('<option value="">No campaign</option>');
    expect(IMPORT_PANEL).toContain("Assign all to: {c.name}");
  });
});

describe("an unknown id can't quietly pick the wrong thing", () => {
  /** The shipped guard: only an id present in the loaded campaigns survives. */
  const resolve = (raw: string | undefined, known: string[]) =>
    raw && known.includes(raw) ? raw : null;

  const KNOWN = ["c-roofers", "c-plumbers"];

  it("a real campaign id is used", () => {
    expect(resolve("c-roofers", KNOWN)).toBe("c-roofers");
  });

  it.each(["c-deleted", "", "  ", "__auto__", "'; drop table", undefined])(
    "%s falls back to the normal default",
    (junk) => expect(resolve(junk as string | undefined, KNOWN)).toBeNull()
  );

  it("falling back means __auto__, not a blank or missing selection", () => {
    // A defaultValue naming an <option> that doesn't exist leaves the select
    // showing the FIRST option — which is __auto__ — while the URL implied a
    // specific campaign. Silent, and exactly the wrong-import this link exists
    // to prevent. Validating against the loaded list makes that unreachable.
    const chosen = resolve("c-deleted", KNOWN) ?? "__auto__";
    expect(chosen).toBe("__auto__");
  });

  it("it validates against the campaigns actually loaded on the page", () => {
    expect(PROSPECTS).toContain("campaignNameById.has(params.import)");
    // That map is built from the same query that fills the <option> list.
    expect(PROSPECTS).toContain(
      "const campaignNameById = new Map((campaigns ?? []).map((c) => [c.id, c.name]));"
    );
  });
});

describe("why the old default was wrong, not merely slow", () => {
  it("__auto__ groups by INDUSTRY rather than using one campaign", () => {
    expect(ACTIONS).toContain('const autoGroup = campaignSel === "__auto__";');
    expect(ACTIONS).toContain("const fixedCampaignId = autoGroup ? null : campaignSel || null;");
  });

  it("so the obvious path really did leave the campaign empty", () => {
    // Replay: land with no ?import, accept the default, import.
    const campaignSel = "__auto__";
    const autoGroup = campaignSel === "__auto__";
    const fixedCampaignId = autoGroup ? null : campaignSel || null;
    expect(fixedCampaignId).toBeNull(); // nothing lands in the campaign you came from

    // With the fix, the same three actions assign every row to it. Typed as
    // `string`, not the literal — otherwise TS narrows it and the comparison
    // below is provably false (TS2367), which npm run build would not catch
    // because Next does not typecheck test files.
    const withImport: string = "c-roofers";
    expect(withImport === "__auto__" ? null : withImport).toBe("c-roofers");
  });
});

describe("the rest of the empty state is untouched", () => {
  it("the Details-tab route is still offered", () => {
    expect(CAMPAIGN).toContain("<strong>Campaign</strong>");
    expect(CAMPAIGN).toContain("<strong>Details</strong>");
  });

  it("it still says hand-added prospects can go straight in", () => {
    expect(CAMPAIGN).toContain("added by hand");
  });

  it("the campaign's other links are unchanged", () => {
    expect(CAMPAIGN).toContain("/growth/prospects?campaign=${campaign.id}");
  });
});
