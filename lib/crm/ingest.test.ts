import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { ingestCrmContact, highestStage, type CrmIngestInput } from "@/lib/crm/ingest";

/**
 * "Every customer and lead in one place, searchable and up to date."
 *
 * It was neither automatic nor up to date. The ONLY way anything reached
 * ClientIQ was `importContacts()` — a button somebody had to remember to
 * press. A lead that came in through the website at 3am did not exist in the
 * CRM until a human clicked Import, so the answer to "is this person in the
 * system?" was "maybe, depending on when you last synced".
 *
 * That is the difference between a list you maintain and a record you can
 * trust. Every source now writes as it happens.
 */

const ROOT = path.resolve(import.meta.dirname, "..", "..");

const input = (over: Partial<CrmIngestInput> = {}): CrmIngestInput => ({
  businessId: "b1",
  name: "Mary Byrne",
  email: "mary@example.ie",
  source: "SiteIQ",
  activity: "Captured as a website lead",
  stage: "new",
  ...over,
});

/** Minimal fake of the two tables this touches. */
function fakeDb(opts: { existing?: Record<string, unknown> | null; dupeActivity?: boolean } = {}) {
  const calls: { table: string; op: string; payload?: unknown }[] = [];
  const admin = {
    from(table: string) {
      const chain: Record<string, unknown> = {};
      const self = () => chain;
      Object.assign(chain, {
        select: self,
        eq: self,
        ilike: self,
        is: self,
        maybeSingle: async () => {
          calls.push({ table, op: "select" });
          if (table === "crm_contacts") return { data: opts.existing ?? null };
          return { data: opts.dupeActivity ? { id: "a1" } : null };
        },
        update(payload: unknown) {
          calls.push({ table, op: "update", payload });
          return { eq: async () => ({ error: null }) } as never;
        },
      });
      chain.insert = (payload: unknown) => {
        calls.push({ table, op: "insert", payload });
        if (table === "crm_activities") return Promise.resolve({ error: null }) as never;
        return {
          select: () => ({ single: async () => ({ data: { id: "new-c" }, error: null }) }),
        } as never;
      };
      return chain as never;
    },
  };
  return { admin: admin as never, calls };
}

describe("a contact only ever moves FORWARD through the pipeline", () => {
  it("advances a new contact", () => {
    expect(highestStage("new", "contacted")).toBe("contacted");
    expect(highestStage("contacted", "won")).toBe("won");
  });

  it("NEVER resets a won customer to new", () => {
    // THE rule that makes automatic ingestion safe. A won customer who fills
    // in the website form again — asking about a second job — must not be
    // wiped back to 'new' by the automation meant to keep the CRM current.
    expect(highestStage("won", "new")).toBe("won");
    expect(highestStage("won", "contacted")).toBe("won");
    expect(highestStage("won", "qualified")).toBe("won");
    expect(highestStage("won", "lost")).toBe("won");
  });

  it("a lost contact who later buys is won", () => {
    expect(highestStage("lost", "won")).toBe("won");
  });

  it("does not push a lost contact back to new", () => {
    expect(highestStage("lost", "new")).toBe("lost");
  });

  it("treats an unknown stored stage as the incoming one", () => {
    expect(highestStage("nonsense", "contacted")).toBe("contacted");
    expect(highestStage(null, "won")).toBe("won");
  });
});

describe("a lead arriving creates the contact there and then", () => {
  it("inserts when nobody matches", async () => {
    const { admin, calls } = fakeDb({ existing: null });
    const r = await ingestCrmContact(admin, input());
    expect(r).toMatchObject({ ok: true, created: true, stage: "new" });
    const insert = calls.find((c) => c.table === "crm_contacts" && c.op === "insert");
    expect(insert?.payload).toMatchObject({
      business_id: "b1",
      name: "Mary Byrne",
      email: "mary@example.ie",
      source: "SiteIQ",
      stage: "new",
    });
  });

  it("writes the timeline line", async () => {
    const { admin, calls } = fakeDb({ existing: null });
    await ingestCrmContact(admin, input());
    const act = calls.find((c) => c.table === "crm_activities" && c.op === "insert");
    expect(act?.payload).toMatchObject({ body: "Captured as a website lead" });
  });

  it("updates rather than duplicating an existing contact", async () => {
    const { admin, calls } = fakeDb({
      existing: { id: "c1", stage: "contacted", value: null, phone: null },
    });
    const r = await ingestCrmContact(admin, input());
    expect(r).toMatchObject({ ok: true, created: false });
    expect(calls.some((c) => c.table === "crm_contacts" && c.op === "insert")).toBe(false);
  });

  it("does not repeat a timeline line it already has", async () => {
    // The manual import and the automatic path can both run over the same
    // event; the timeline must not double.
    const { admin, calls } = fakeDb({ existing: { id: "c1", stage: "new", value: null, phone: null }, dupeActivity: true });
    await ingestCrmContact(admin, input());
    expect(calls.some((c) => c.table === "crm_activities" && c.op === "insert")).toBe(false);
  });
});

describe("it never damages what is already known", () => {
  it("does not downgrade the stage", async () => {
    const { admin, calls } = fakeDb({ existing: { id: "c1", stage: "won", value: 5000, phone: null } });
    const r = await ingestCrmContact(admin, input({ stage: "new" }));
    expect(r).toMatchObject({ stage: "won" });
    const update = calls.find((c) => c.table === "crm_contacts" && c.op === "update");
    expect((update?.payload as { stage: string }).stage).toBe("won");
  });

  it("fills a blank phone but never overwrites one", async () => {
    // A number already on the record was probably typed by a human and is
    // likelier to be right than one scraped off a form.
    const blank = fakeDb({ existing: { id: "c1", stage: "new", value: null, phone: null } });
    await ingestCrmContact(blank.admin, input({ email: null, phone: "0871234567" }));
    const u1 = blank.calls.find((c) => c.table === "crm_contacts" && c.op === "update");
    expect((u1?.payload as { phone?: string }).phone).toBe("0871234567");

    const filled = fakeDb({ existing: { id: "c1", stage: "new", value: null, phone: "0899999999" } });
    await ingestCrmContact(filled.admin, input({ email: null, phone: "0871234567" }));
    const u2 = filled.calls.find((c) => c.table === "crm_contacts" && c.op === "update");
    expect((u2?.payload as { phone?: string }).phone).toBeUndefined();
  });

  it("only ever raises a recorded value", async () => {
    const { admin, calls } = fakeDb({ existing: { id: "c1", stage: "won", value: 500000, phone: null } });
    await ingestCrmContact(admin, input({ valueCents: 10000 }));
    const update = calls.find((c) => c.table === "crm_contacts" && c.op === "update");
    expect((update?.payload as { value: number }).value).toBe(500000);
  });
});

describe("it refuses noise and never explodes", () => {
  it("declines a contact with nothing to identify it", async () => {
    const r = await ingestCrmContact(fakeDb().admin, input({ name: "", email: null }));
    expect(r.ok).toBe(false);
  });

  it("declines without a business", async () => {
    expect((await ingestCrmContact(fakeDb().admin, input({ businessId: "" }))).ok).toBe(false);
  });

  it("falls back to the email when there is no name", async () => {
    const { admin, calls } = fakeDb({ existing: null });
    await ingestCrmContact(admin, input({ name: "   " }));
    const insert = calls.find((c) => c.table === "crm_contacts" && c.op === "insert");
    expect((insert?.payload as { name: string }).name).toBe("mary@example.ie");
  });

  it("returns a failure instead of throwing", async () => {
    const exploding = {
      from() {
        throw new Error("database on fire");
      },
    } as never;
    const r = await ingestCrmContact(exploding, input());
    expect(r).toEqual({ ok: false, reason: "database on fire" });
  });
});

describe("every source writes as it happens", () => {
  const LEAD = readFileSync(path.join(ROOT, "app", "api", "wa-lead", "route.ts"), "utf8");
  const REVIEW = readFileSync(path.join(ROOT, "lib", "review-agent", "send-core.ts"), "utf8");
  const CRM = readFileSync(path.join(ROOT, "app", "portal", "crm-agent", "actions.ts"), "utf8");

  it("a website lead lands in ClientIQ at capture", () => {
    expect(LEAD).toContain("ingestCrmContact(supabase");
    expect(LEAD).toContain('source: "SiteIQ"');
  });

  it("the lead capture cannot be failed by the CRM write", () => {
    // The visitor is waiting on a response and the lead row is already stored.
    // The CALL, not the import at the top of the file — anchoring on the
    // bare name matched line 1 and sliced the wrong 900 characters.
    const idx = LEAD.indexOf("ingestCrmContact(supabase");
    const after = LEAD.slice(idx, idx + 900);
    expect(after).toContain("console.error");
    expect(after).not.toMatch(/return NextResponse\.json\(\s*\{\s*error/);
  });

  it("a review request marks them a customer, not a lead", () => {
    // A review request means a job just finished.
    expect(REVIEW).toContain("ingestCrmContact(supabase");
    expect(REVIEW).toContain('source: "ReputationIQ"');
    expect(REVIEW).toContain('stage: "won"');
  });

  it("the review send is never turned into a failure by the CRM write", () => {
    const idx = REVIEW.indexOf("ingestCrmContact(supabase");
    expect(REVIEW.slice(idx)).toContain("console.error");
    // The success return still comes last.
    expect(REVIEW.indexOf("return { ok: true, customerName }")).toBeGreaterThan(idx);
  });

  it("the manual import is kept — nothing Jude uses was removed", () => {
    // It still has a job: backfilling everything that predates this.
    expect(CRM).toContain("export async function importContacts");
  });
});
