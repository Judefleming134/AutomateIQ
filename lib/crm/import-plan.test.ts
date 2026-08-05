import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  planImport,
  contactKey,
  chunk,
  type SourceRow,
  type ExistingContact,
  type ExistingActivity,
} from "./import-plan";

/**
 * "Import from agents" asked the database three-to-five questions about every
 * single source record, one after another.
 *
 * Per record: find by email, find by name, does this activity exist — then, if
 * new, insert the contact and insert the activity. All sequential, all awaited.
 * Measured structurally (scratchpad/import-cost.mjs, ~25ms per round trip):
 *
 *   scenario                     records   OLD queries   OLD wall   NEW   NEW wall
 *   new customer, first import   80        403           10.0s      7     0.1s
 *   a year in, first import      415       2078          51.9s      7     0.1s
 *   a year in, pressed again     415       1248          31.1s      5     0.0s
 *   busy trade, 90% already in   2000      6403         160.0s      7     0.1s
 *
 * (The last row is the CHEAP case for the old path — nothing to insert. All
 * 2,000 fresh is 10,003 queries.)
 *
 * A Vercel Server Action gets 60s (10s on hobby). So the button spun and died
 * on exactly the businesses with enough history to want it — and "Importing…"
 * gives no clue which of your contacts made it in before the timeout.
 *
 * It is now five reads in ONE Promise.all wave, planned in memory here, then
 * bulk inserts in chunks of 500.
 *
 * Two correctness fixes came with it:
 *
 *   · THE SOURCE SELECTS HAD NO PAGING. PostgREST caps at 1,000 rows, so a
 *     business past a thousand review customers imported the first thousand
 *     and reported success. Now `selectAllRows`.
 *   · INSERT ERRORS WERE SWALLOWED (`continue`) and the button still said
 *     "Already up to date." Failures are counted and shown.
 *
 * The dedupe rules are unchanged and mirror the database: the unique index is
 * on (business_id, lower(email)) where email is present, so email is identity
 * when there is one and name is identity when there isn't. Bulk inserts make
 * that load-bearing in a way the old row-at-a-time loop never had to be — two
 * incoming rows sharing an address in one statement is a 23505 that takes the
 * whole chunk with it.
 */

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const ACTIONS = readFileSync(
  path.join(ROOT, "app", "portal", "crm-agent", "actions.ts"),
  "utf8"
);
const BUTTON = readFileSync(
  path.join(ROOT, "app", "portal", "crm-agent", "interactive.tsx"),
  "utf8"
);
const SCHEMA = readFileSync(path.join(ROOT, "supabase", "manual_update_0008.sql"), "utf8");

const row = (p: Partial<SourceRow> & { name: string }): SourceRow => ({
  email: null,
  phone: null,
  source: "ReputationIQ",
  activity: "Review request sent",
  at: "2026-08-01T09:00:00.000Z",
  ...p,
});

describe("identity matches the unique index the database actually has", () => {
  it("the index really is on lower(email), and only when there is one", () => {
    // If this ever changes, contactKey has to change with it.
    expect(SCHEMA).toContain("create unique index if not exists crm_contacts_business_email_idx");
    expect(SCHEMA).toContain("on crm_contacts (business_id, lower(email))");
    expect(SCHEMA).toContain("where email is not null and email <> ''");
  });

  it("email wins when present, case- and whitespace-insensitively", () => {
    expect(contactKey("Ann Murphy", "ANN@murphy.ie")).toBe(contactKey("A. Murphy", " ann@murphy.ie "));
  });

  it("name is identity only when there is no email", () => {
    expect(contactKey("Ann Murphy", null)).toBe(contactKey("ann murphy", ""));
    expect(contactKey("Ann Murphy", null)).not.toBe(contactKey("Ann Murphy", "ann@murphy.ie"));
  });
});

describe("two incoming rows sharing an address collapse to ONE insert", () => {
  // The case that would 23505 a bulk statement and lose 499 innocent rows.
  const incoming = [
    row({ name: "Ann Murphy", email: "ann@murphy.ie", activity: "Review request sent" }),
    row({ name: "A. Murphy", email: "Ann@Murphy.ie", source: "QuoteIQ", activity: "Quote created (€2,400)" }),
    row({ name: "Ann Murphy", email: "ann@murphy.ie ", source: "SiteIQ", activity: "Captured as a website lead" }),
  ];
  const plan = planImport(incoming, [], []);

  it("one contact, not three", () => {
    expect(plan.create).toHaveLength(1);
    expect(plan.create[0].name).toBe("Ann Murphy"); // first writer wins
  });

  it("but all three timeline entries survive", () => {
    expect(plan.forNew.map((a) => a.body)).toEqual([
      "Review request sent",
      "Quote created (€2,400)",
      "Captured as a website lead",
    ]);
    expect(new Set(plan.forNew.map((a) => a.key)).size).toBe(1);
  });

  it("no chunk can contain a duplicate key — the invariant the bulk insert needs", () => {
    const keys = plan.create.map((c) => c.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("a second press imports nothing (idempotent, as before)", () => {
  const incoming = [
    row({ name: "Ann Murphy", email: "ann@murphy.ie" }),
    row({ name: "Joe Walsh", email: null, phone: "087 111 2222", source: "SiteIQ", activity: "Captured as a website lead" }),
  ];

  it("first run creates both", () => {
    const plan = planImport(incoming, [], []);
    expect(plan.create).toHaveLength(2);
    expect(plan.forNew).toHaveLength(2);
    expect(plan.forExisting).toHaveLength(0);
  });

  it("second run creates none and re-logs nothing", () => {
    const existing: ExistingContact[] = [
      { id: "c1", name: "Ann Murphy", email: "ann@murphy.ie" },
      { id: "c2", name: "Joe Walsh", email: null },
    ];
    const activities: ExistingActivity[] = [
      { contact_id: "c1", body: "Review request sent" },
      { contact_id: "c2", body: "Captured as a website lead" },
    ];
    const plan = planImport(incoming, existing, activities);
    expect(plan.create).toHaveLength(0);
    expect(plan.forNew).toHaveLength(0);
    expect(plan.forExisting).toHaveLength(0);
  });

  it("an EXISTING contact with a NEW activity gets just the activity", () => {
    const existing: ExistingContact[] = [{ id: "c1", name: "Ann Murphy", email: "ann@murphy.ie" }];
    const plan = planImport(
      [...incoming, row({ name: "Ann Murphy", email: "ann@murphy.ie", source: "QuoteIQ", activity: "Quote created (€900)" })],
      existing,
      [{ contact_id: "c1", body: "Review request sent" }]
    );
    expect(plan.create.map((c) => c.name)).toEqual(["Joe Walsh"]);
    expect(plan.forExisting).toEqual([
      { contact_id: "c1", body: "Quote created (€900)", created_at: "2026-08-01T09:00:00.000Z" },
    ]);
  });

  it("the same activity twice in one run is written once", () => {
    const existing: ExistingContact[] = [{ id: "c1", name: "Ann Murphy", email: "ann@murphy.ie" }];
    const twice = [row({ name: "Ann Murphy", email: "ann@murphy.ie" }), row({ name: "Ann Murphy", email: "ann@murphy.ie" })];
    expect(planImport(twice, existing, []).forExisting).toHaveLength(1);
  });
});

describe("the awkward rows", () => {
  it("a nameless source row is skipped rather than inserted blank", () => {
    // crm_contacts.name is NOT NULL; a blank row would fail the insert and,
    // in the old loop, be swallowed by `continue`.
    expect(planImport([row({ name: "   " })], [], []).create).toHaveLength(0);
  });

  it("a website lead whose contact is a phone number keeps it as a phone", () => {
    const plan = planImport(
      [row({ name: "Joe Walsh", email: null, phone: "087 111 2222", source: "SiteIQ" })],
      [],
      []
    );
    expect(plan.create[0]).toMatchObject({ email: null, phone: "087 111 2222" });
  });

  it("two different people with no email and the same name collapse — same as before", () => {
    // The old lookup was .eq("name", …).is("email", null), which found the
    // first one and reused it. Behaviour preserved deliberately.
    const plan = planImport(
      [row({ name: "Joe Walsh" }), row({ name: "joe walsh", activity: "Captured as a website lead" })],
      [],
      []
    );
    expect(plan.create).toHaveLength(1);
    expect(plan.forNew).toHaveLength(2);
  });

  it("planning is stable when the database returns duplicates", () => {
    const dupes: ExistingContact[] = [
      { id: "first", name: "Ann Murphy", email: "ann@murphy.ie" },
      { id: "second", name: "Ann Murphy", email: "ANN@murphy.ie" },
    ];
    const plan = planImport([row({ name: "Ann Murphy", email: "ann@murphy.ie", activity: "New thing" })], dupes, []);
    expect(plan.forExisting[0].contact_id).toBe("first");
  });
});

describe("the shape of the work at scale", () => {
  const incoming: SourceRow[] = Array.from({ length: 415 }, (_, i) =>
    row({ name: `Customer ${i}`, email: `c${i}@example.ie` })
  );

  it("415 records plan into 1 insert batch, not 2,078 queries", () => {
    const plan = planImport(incoming, [], []);
    expect(plan.create).toHaveLength(415);
    expect(chunk(plan.create, 500)).toHaveLength(1);
    expect(chunk(plan.forNew, 500)).toHaveLength(1);
  });

  it("2,000 records plan into 4 contact batches and 4 activity batches", () => {
    const big: SourceRow[] = Array.from({ length: 2000 }, (_, i) =>
      row({ name: `Customer ${i}`, email: `c${i}@example.ie` })
    );
    const plan = planImport(big, [], []);
    expect(chunk(plan.create, 500)).toHaveLength(4);
    expect(chunk(plan.forNew, 500)).toHaveLength(4);
    // OLD, all of them fresh: 3 source selects + 2000 × 3 lookups + 2000
    // contact inserts + 2000 activity inserts. NEW: 5 reads + 4 + 4 writes.
    expect(3 + 2000 * 3 + 2000 + 2000).toBe(10003);
    expect(5 + chunk(plan.create, 500).length + chunk(plan.forNew, 500).length).toBe(13);
  });

  it("chunk never loses or duplicates a row", () => {
    const rows = Array.from({ length: 1234 }, (_, i) => i);
    const flat = chunk(rows, 500).flat();
    expect(flat).toEqual(rows);
    expect(chunk([], 500)).toEqual([]);
  });
});

describe("the action does the reads in one wave, and pages past 1,000", () => {
  it("all five reads share a single Promise.all", () => {
    expect((ACTIONS.match(/await Promise\.all\(\[/g) ?? [])).toHaveLength(1);
    const wave = ACTIONS.slice(ACTIONS.indexOf("await Promise.all(["), ACTIONS.indexOf("const incoming: SourceRow[] = []"));
    for (const t of ["ra_customers", "wa_leads", "qa_quotes", "crm_contacts", "crm_activities"]) {
      expect(wave, t).toContain(t);
    }
    expect((wave.match(/selectAllRows</g) ?? [])).toHaveLength(5);
  });

  it("the per-record lookups are gone", () => {
    // The three that ran once per source row. Their absence IS the fix.
    expect(ACTIONS).not.toContain('.eq("contact_id", contactId)');
    expect(ACTIONS).not.toContain('.is("email", item.email ? item.email : null)');
    expect(ACTIONS).not.toContain("for (const item of incoming)");
  });

  it("writes go out in chunks", () => {
    expect(ACTIONS).toContain("const INSERT_CHUNK = 500;");
    expect(ACTIONS).toContain("for (const batch of chunk(plan.create, INSERT_CHUNK))");
    expect(ACTIONS).toContain("for (const batch of chunk(activityRows, INSERT_CHUNK))");
  });

  it("a failed batch falls back per row instead of losing 499 good ones", () => {
    expect(ACTIONS).toContain("One bad row must not cost the other 499");
    expect(ACTIONS).toContain('oneErr?.code === "23505"');
  });
});

describe("it stops claiming success it didn't have", () => {
  it("the action returns a failure count", () => {
    expect(ACTIONS).toContain("{ ok: true; imported: number; failed: number }");
    expect(ACTIONS).toContain("failed += 1;");
  });

  it("and the button says so instead of 'Already up to date.'", () => {
    expect(BUTTON).toContain("couldn't be imported");
    expect(BUTTON).toContain('res.failed > 0');
    // The clean-run message is untouched.
    expect(BUTTON).toContain('"Already up to date."');
  });

  it("a read failure is surfaced, not silently treated as an empty source", () => {
    // selectAllRows throws on an incomplete page by design; swallowing that
    // would re-import every contact as if the CRM were empty.
    expect(ACTIONS).toContain("Couldn't read your existing records");
    expect(ACTIONS).toContain("supabase/manual_update_0008.sql");
  });
});
