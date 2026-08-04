import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { resolveDueBucket, resolveStageBucket } from "./prospect-query";

/**
 * Pressing "Apply" on the prospects filter panel silently threw away the
 * bucket you had arrived on.
 *
 * A GET form submits ONLY its own fields — anything not present in the form is
 * gone from the next URL. The page has two GET forms, and they disagreed:
 *
 *   header search box   q status industry campaign sort phone social due stage
 *   filter panel        q status industry campaign sort phone social
 *
 * `due` and `stage` are how every count in the engine links to the exact set it
 * counted — the dashboard's "Overdue (8)", Jarvis's "Gone cold (43)", the
 * campaigns page's "still to research". Pagination rebuilds them in pageHref
 * and the CSV export sets them in exportSp, so the filter panel was the ONLY
 * affordance on the page that dropped them.
 *
 *     arrived on              changed        Apply gave you
 *     ─────────────────────   ────────────   ──────────────────────────
 *     ?due=overdue            industry       ?industry=…      due LOST
 *     ?due=cold               status         ?status=…        due LOST
 *     ?stage=to_research      phone          ?phone=1         stage LOST
 *     ?due=today&phone=1      sort           ?sort=…&phone=1  due LOST
 *
 * The sting is the second half: the orange chip reading "Due: overdue"
 * disappears in the same submit, because there is no longer a `due` in the URL
 * to render one from. So the page stops saying it was ever filtered, and eight
 * overdue leads look like they became four hundred.
 *
 * That is the same defect the chips themselves were built to fix — "the page
 * told you it was filtered and then offered no way out" — reappearing one
 * layer down.
 *
 * Fixed with the two hidden inputs the header form already had.
 */

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const PAGE = readFileSync(
  path.join(ROOT, "app", "growth", "(app)", "prospects", "page.tsx"),
  "utf8"
);

/** The two GET forms, sliced out of the page. */
const HEADER_FORM = PAGE.slice(
  PAGE.indexOf('role="search"') - 400,
  PAGE.indexOf("<Download size={14} />")
);
const FILTER_FORM = PAGE.slice(
  PAGE.indexOf('aria-label="Filter prospects"'),
  PAGE.indexOf("+ Add a prospect")
);

const fieldNames = (form: string) =>
  [...new Set([...form.matchAll(/name="([a-z_]+)"/g)].map((m) => m[1]))].sort();

/** A GET submit: only the form's own fields survive. */
function submit(
  url: string,
  formFields: string[],
  changes: Record<string, string>
): string {
  const current = new URLSearchParams(url.split("?")[1] ?? "");
  const next = new URLSearchParams();
  for (const f of formFields) {
    const v = f in changes ? changes[f] : current.get(f);
    if (v) next.set(f, v);
  }
  return next.toString();
}

const HEADER_FIELDS = [
  "q", "status", "industry", "campaign", "sort", "phone", "social", "due", "stage",
];
/** What the filter panel carried before the fix. */
const OLD_FILTER_FIELDS = HEADER_FIELDS.filter((f) => f !== "due" && f !== "stage");

const JOURNEYS: Array<[string, string, Record<string, string>, string]> = [
  ['dashboard "Overdue (8)"', "?due=overdue", { industry: "Plumbing" }, "due"],
  ['Jarvis "Gone cold (43)"', "?due=cold", { status: "contacted" }, "due"],
  ['campaigns "still to research"', "?stage=to_research", { phone: "1" }, "stage"],
  ["a dial list already narrowed", "?due=today&phone=1", { sort: "score" }, "due"],
];

describe("the bucket now survives Apply", () => {
  it.each(JOURNEYS)("%s: it used to be lost, now it is kept", (_label, url, change, key) => {
    const before = submit(url, OLD_FILTER_FIELDS, change);
    const after = submit(url, fieldNames(FILTER_FORM), change);
    // The bug: the param that brought you here is gone.
    expect(new URLSearchParams(before).get(key)).toBeNull();
    // The fix: it comes through.
    const carried = new URLSearchParams(url.slice(1)).get(key)!;
    expect(new URLSearchParams(after).get(key)).toBe(carried);
  });

  it("the change you actually asked for still applies", () => {
    const after = submit("?due=overdue", fieldNames(FILTER_FORM), { industry: "Plumbing" });
    expect(new URLSearchParams(after).get("industry")).toBe("Plumbing");
    expect(new URLSearchParams(after).get("due")).toBe("overdue");
  });

  it("the filter panel now carries exactly what the header form carries", () => {
    expect(fieldNames(FILTER_FORM)).toEqual(fieldNames(HEADER_FORM));
  });

  it("both carry all nine, due and stage among them", () => {
    for (const form of [HEADER_FORM, FILTER_FORM]) {
      expect(fieldNames(form)).toEqual(HEADER_FIELDS.slice().sort());
    }
  });

  it("the filter panel renders them the same way the header form does", () => {
    expect(FILTER_FORM).toContain('{due && <input type="hidden" name="due" value={due} />}');
    expect(FILTER_FORM).toContain('{stage && <input type="hidden" name="stage" value={stage} />}');
    expect(HEADER_FORM).toContain('{due && <input type="hidden" name="due" value={due} />}');
  });

  it("nothing is emitted when there is no bucket to carry", () => {
    // The `&&` guard: no stray empty params on an unfiltered view.
    const plain = submit("", fieldNames(FILTER_FORM), { status: "contacted" });
    expect(plain).toBe("status=contacted");
  });
});

describe("only real buckets travel — a junk value is still ignored", () => {
  it.each(["overdue", "today", "live", "cold", "unscheduled"])(
    "%s is a real due bucket",
    (b) => expect(resolveDueBucket(b)).toBe(b)
  );

  it.each(["", "yesterday", "soon", "DROP TABLE", "  "])(
    "%s resolves to null, so it never reaches the URL",
    (junk) => expect(resolveDueBucket(junk)).toBeNull()
  );

  it("stage buckets resolve the same way", () => {
    expect(resolveStageBucket("to_research")).toBe("to_research");
    expect(resolveStageBucket("nonsense")).toBeNull();
  });

  it("the hidden inputs render the RESOLVED value, not the raw param", () => {
    // `due` and `stage` in scope are the resolved ones — a junk ?due=lol is
    // already null by then, so the guard renders nothing.
    expect(PAGE).toContain("const due = resolveDueBucket(params.due);");
    expect(PAGE).toContain("const stage = resolveStageBucket(params.stage);");
  });
});

describe("every other affordance on the page still keeps the bucket", () => {
  it("pagination rebuilds them", () => {
    expect(PAGE).toContain('if (due) sp.set("due", due);');
    expect(PAGE).toContain('if (stage) sp.set("stage", stage);');
  });

  it("the CSV export carries them", () => {
    expect(PAGE).toContain('if (due) exportSp.set("due", due);');
    expect(PAGE).toContain('if (stage) exportSp.set("stage", stage);');
  });

  it("the chips can still clear them individually", () => {
    expect(PAGE).toContain("due: due ?? undefined, stage: stage ?? undefined");
  });

  it("Reset still drops everything, which is its job", () => {
    expect(FILTER_FORM).toContain('<Link href="/growth/prospects" className="btn btn-ghost">');
  });
});

describe("nothing else about the filter panel changed", () => {
  it("the sort default is still 'no explicit choice'", () => {
    // So ticking Has phone can still auto-sort by score.
    expect(FILTER_FORM).toContain(
      'defaultValue={params.sort && SORTS[params.sort] ? params.sort : ""}'
    );
    expect(FILTER_FORM).toContain('<option value="">Best for this view</option>');
  });

  it("it still shows which sort is actually active", () => {
    expect(FILTER_FORM).toContain("now: {SORT_LABELS[sortKey]");
  });

  it("both checkboxes are unchanged", () => {
    expect(FILTER_FORM).toContain('name="phone"');
    expect(FILTER_FORM).toContain('name="social"');
  });

  it("it is still a GET form, so filters stay shareable in the URL", () => {
    expect(FILTER_FORM.startsWith('aria-label="Filter prospects"')).toBe(true);
    expect(PAGE).toContain('method="get"');
  });

  it("it still omits `page`, so changing a filter resets to page 1", () => {
    expect(fieldNames(FILTER_FORM)).not.toContain("page");
  });
});
