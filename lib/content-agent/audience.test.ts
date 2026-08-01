import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  buildAudience,
  audienceSummary,
  personalise,
  MAX_RECIPIENTS,
  type AudienceContact,
} from "@/lib/content-agent/audience";

/**
 * ContentIQ generated a post and offered "Mark published" — a checkbox that
 * set a status and published NOTHING. A product whose entire purpose is
 * producing content had no way to deliver any.
 *
 * Publishing now means sending it to the customer's own list, which makes this
 * the most dangerous code in the product. The standing rule under test: it is
 * always better to send to nobody than to send to the wrong person. Every
 * ambiguity resolves to exclusion.
 */

const ROOT = path.resolve(import.meta.dirname, "..", "..");

const person = (over: Partial<AudienceContact> = {}): AudienceContact => ({
  id: "c1",
  name: "Mary Byrne",
  email: "mary@example.ie",
  stage: "won",
  ...over,
});

const reasons = (a: ReturnType<typeof buildAudience>) =>
  a.excluded.map((e) => e.reason).join(" | ");

describe("who gets the email", () => {
  it("includes an ordinary contact", () => {
    const a = buildAudience([person()]);
    expect(a.recipients).toEqual([{ id: "c1", name: "Mary Byrne", email: "mary@example.ie" }]);
    expect(a.excluded).toEqual([]);
    expect(a.capped).toBe(false);
  });

  it("falls back to 'there' when a contact has no name", () => {
    // "Hi ," is worse than "Hi there," and the personalisation token has to
    // resolve to something.
    expect(buildAudience([person({ name: null })]).recipients[0].name).toBe("there");
    expect(buildAudience([person({ name: "   " })]).recipients[0].name).toBe("there");
  });

  it("keeps the address exactly as stored", () => {
    // Matching is case-insensitive; the address that goes on the envelope is
    // not rewritten.
    expect(buildAudience([person({ email: "Mary@Example.IE" })]).recipients[0].email).toBe(
      "Mary@Example.IE"
    );
  });
});

describe("who is left out, and why", () => {
  it("skips a contact with no email address", () => {
    const a = buildAudience([person({ email: null }), person({ id: "c2", email: "  " })]);
    expect(a.recipients).toEqual([]);
    expect(a.excluded).toEqual([{ reason: "no email address", count: 2 }]);
  });

  it("skips addresses that are not addresses", () => {
    const bad = ["mary", "mary@", "@example.ie", "mary example.ie", "mary@example", "a@b.c"];
    const a = buildAudience(bad.map((email, i) => person({ id: `c${i}`, email })));
    expect(a.recipients).toEqual([]);
    expect(reasons(a)).toContain("email address looks invalid");
  });

  it("NEVER sends to someone marked lost", () => {
    // Someone who told you no is the worst possible recipient of a promotional
    // email — it is the difference between a customer you might win back and a
    // spam complaint against the domain that also carries the 07:00 outreach.
    const a = buildAudience([person({ stage: "lost" })]);
    expect(a.recipients).toEqual([]);
    expect(reasons(a)).toContain("marked lost");
  });

  it("one 'lost' record beats every other record for that address", () => {
    // The same person routinely has two rows: an old enquiry that went nowhere
    // and a newer one. Checking each row's own stage as the list is walked
    // would email them purely because the not-lost copy came back first.
    const winsOnOrder = buildAudience([
      person({ id: "c1", email: "mary@example.ie", stage: "new" }),
      person({ id: "c2", email: "mary@example.ie", stage: "lost" }),
    ]);
    expect(winsOnOrder.recipients).toEqual([]);
    expect(reasons(winsOnOrder)).toContain("marked lost");

    // And the other way round, where the naive walk would have got it right.
    const otherOrder = buildAudience([
      person({ id: "c2", email: "MARY@example.ie", stage: "lost" }),
      person({ id: "c1", email: "mary@example.ie", stage: "won" }),
    ]);
    expect(otherOrder.recipients).toEqual([]);
  });

  it("sends to every other stage", () => {
    const stages = ["new", "contacted", "qualified", "won", null, undefined, ""];
    const a = buildAudience(
      stages.map((stage, i) => person({ id: `c${i}`, email: `p${i}@example.ie`, stage }))
    );
    expect(a.recipients).toHaveLength(stages.length);
  });

  it("does not email the same person twice because the CRM lists them twice", () => {
    const a = buildAudience([
      person({ id: "c1", email: "mary@example.ie" }),
      person({ id: "c2", email: "MARY@example.ie" }),
      person({ id: "c3", email: " mary@example.ie " }),
    ]);
    expect(a.recipients).toHaveLength(1);
    expect(a.excluded).toContainEqual({ reason: "duplicate in your list", count: 2 });
  });
});

describe("a re-run resumes — it never starts over", () => {
  it("skips everyone this exact piece already went to", () => {
    const a = buildAudience(
      [person({ id: "c1", email: "mary@example.ie" }), person({ id: "c2", email: "joe@example.ie" })],
      ["mary@example.ie"]
    );
    expect(a.recipients.map((r) => r.email)).toEqual(["joe@example.ie"]);
    expect(a.excluded).toContainEqual({ reason: "already sent this", count: 1 });
  });

  it("matches already-sent case-insensitively, the same way the unique index does", () => {
    // The database index is on (content_id, lower(email)). If this compared
    // case-sensitively, a re-run would try to re-send to Mary@Example.IE,
    // the insert would be rejected by the index, and the code would count a
    // send that the recipient receives twice.
    const a = buildAudience([person({ email: "Mary@Example.IE" })], ["mary@example.ie"]);
    expect(a.recipients).toEqual([]);
  });

  it("ignores blank entries in the already-sent list", () => {
    const a = buildAudience([person()], ["", "   "]);
    expect(a.recipients).toHaveLength(1);
  });
});

describe("the blast radius is capped", () => {
  const many = (n: number) =>
    Array.from({ length: n }, (_, i) => person({ id: `c${i}`, email: `p${i}@example.ie` }));

  it("sends to everyone when under the cap", () => {
    const a = buildAudience(many(MAX_RECIPIENTS));
    expect(a.recipients).toHaveLength(MAX_RECIPIENTS);
    expect(a.capped).toBe(false);
  });

  it("stops at the cap and says so", () => {
    const a = buildAudience(many(MAX_RECIPIENTS + 25));
    expect(a.recipients).toHaveLength(MAX_RECIPIENTS);
    expect(a.capped).toBe(true);
    expect(audienceSummary(a)).toContain("run it again for the rest");
  });

  it("the overflow is picked up by the next run, not lost", () => {
    // The cap is a pause, not a truncation: the people beyond it are still
    // there next time, because the ones already emailed are excluded.
    const all = many(MAX_RECIPIENTS + 25);
    const first = buildAudience(all);
    const second = buildAudience(all, first.recipients.map((r) => r.email));
    expect(second.recipients).toHaveLength(25);
    // Nobody appears in both runs.
    const overlap = second.recipients.filter((r) =>
      first.recipients.some((f) => f.email === r.email)
    );
    expect(overlap).toEqual([]);
  });

  it("counts the cap against real recipients, not skipped rows", () => {
    // A list padded with unusable rows must not eat into the send limit —
    // otherwise 200 contacts without emails would silently cap a send at zero.
    const junk = Array.from({ length: 300 }, (_, i) => person({ id: `j${i}`, email: null }));
    const a = buildAudience([...junk, ...many(10)]);
    expect(a.recipients).toHaveLength(10);
    expect(a.capped).toBe(false);
  });
});

describe("nobody sends blind", () => {
  it("states the recipient count plainly", () => {
    expect(audienceSummary(buildAudience([person()]))).toBe("1 recipient");
    expect(
      audienceSummary(
        buildAudience([person(), person({ id: "c2", email: "joe@example.ie" })])
      )
    ).toBe("2 recipients");
  });

  it("explains an empty audience instead of just saying zero", () => {
    // "0 recipients" tells the customer nothing about what to fix.
    expect(audienceSummary(buildAudience([]))).toContain("no contacts with an email address");
    expect(audienceSummary(buildAudience([person({ stage: "lost" })]))).toContain(
      "marked lost"
    );
  });

  it("names who is being skipped alongside who is being sent to", () => {
    const s = audienceSummary(
      buildAudience([
        person(),
        person({ id: "c2", email: null }),
        person({ id: "c3", email: "gone@example.ie", stage: "lost" }),
      ])
    );
    expect(s).toContain("1 recipient");
    expect(s).toContain("1 no email address");
    expect(s).toContain("marked lost");
  });

  it("puts the biggest exclusion first", () => {
    const a = buildAudience([
      person({ id: "c1", email: null }),
      person({ id: "c2", email: null }),
      person({ id: "c3", stage: "lost" }),
    ]);
    expect(a.excluded[0]).toEqual({ reason: "no email address", count: 2 });
  });
});

describe("personalisation", () => {
  it("replaces every occurrence of both tokens", () => {
    expect(
      personalise("Hi {{name}}, {{business}} here. Thanks {{name}} — {{business}}.", {
        name: "Mary",
        business: "Byrne Plumbing",
      })
    ).toBe("Hi Mary, Byrne Plumbing here. Thanks Mary — Byrne Plumbing.");
  });

  it("leaves a body with no tokens untouched", () => {
    const body = "Our summer boiler offer ends on Friday.";
    expect(personalise(body, { name: "Mary", business: "Byrne" })).toBe(body);
  });

  it("does not treat replacement text as a pattern", () => {
    // A business literally named with a token-ish string must not cause a
    // second substitution pass.
    expect(personalise("{{name}}", { name: "$& {{business}}", business: "Byrne" })).toBe(
      "$& {{business}}"
    );
  });
});

describe("the send path itself", () => {
  const PUBLISH = readFileSync(
    path.join(ROOT, "app", "portal", "content-agent", "publish-actions.ts"),
    "utf8"
  );
  const UI = readFileSync(
    path.join(ROOT, "app", "portal", "content-agent", "content-interactive.tsx"),
    "utf8"
  );
  const MIGRATION = readFileSync(
    path.join(ROOT, "supabase", "migrations", "0039_content_sends.sql"),
    "utf8"
  );

  it("the database makes a double-send impossible, not the code", () => {
    expect(MIGRATION).toMatch(
      /create unique index if not exists ca_sends_content_email_idx\s+on ca_sends \(content_id, lower\(email\)\)/
    );
  });

  it("deleting a contact does not erase the record that they were emailed", () => {
    expect(MIGRATION).toContain("contact_id uuid references crm_contacts (id) on delete set null");
  });

  it("each recipient is idempotency-keyed at the provider too", () => {
    expect(PUBLISH).toContain("idempotencyKey: `content-${contentId}-${person.email.toLowerCase()}`");
  });

  it("records each send immediately, not in a batch at the end", () => {
    // If the run dies halfway, everyone already emailed must be on record so
    // a re-run resumes instead of starting over.
    const loopStart = PUBLISH.indexOf("for (const person of audience.recipients)");
    const loopEnd = PUBLISH.indexOf("const { count: total }");
    expect(loopStart).toBeGreaterThan(-1);
    expect(PUBLISH.slice(loopStart, loopEnd)).toContain('.from("ca_sends").insert(');
  });

  it("says so when an email went but could not be recorded", () => {
    // The alternative is a silent re-send to that person on the next run.
    expect(PUBLISH).toContain("sent but not recorded");
  });

  it("tells the customer to run the migration rather than failing obscurely", () => {
    expect(PUBLISH).toContain("0039_content_sends.sql");
    expect(PUBLISH).toContain("isMissingTableError");
  });

  it("refuses to send an empty body", () => {
    expect(PUBLISH).toContain("There's nothing written yet");
  });

  it("the UI asks before it sends", () => {
    // previewAudience must be reachable from the button, and the send is a
    // separate press.
    expect(UI).toContain("previewAudience");
    expect(UI).toContain("publishContent");
    const idx = UI.indexOf("async function send()");
    expect(UI.indexOf("async function check()")).toBeLessThan(idx);
  });

  it("does not claim nothing was sent when a send is interrupted", () => {
    // A timeout can happen AFTER some of the emails have gone. Telling the
    // customer "nothing was sent" there is the reporting-success-for-work-
    // that-did-not-happen bug in reverse, and just as wrong.
    const idx = UI.indexOf("async function send()");
    const body = UI.slice(idx, idx + 1200);
    expect(body).toContain("interrupted");
    // The message the customer READS — comments are allowed to mention the
    // phrase, the setError call is not.
    const shown = [...body.matchAll(/setError\("([^"]*)"\)/g)].map((m) => m[1]);
    expect(shown.length).toBeGreaterThan(0);
    expect(shown.join(" ")).not.toContain("nothing was sent");
  });

  it("keeps Mark published — nothing Jude uses was removed", () => {
    expect(UI).toContain("export function PublishButton");
    expect(UI).toContain("markPublished");
  });
});
