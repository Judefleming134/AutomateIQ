import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { buildToolLeadNote, companyFromLead, TOOL_LEAD_SOURCE } from "./tool-leads";
import { ALL_TOOL_SLUGS, TOOL_LABELS, toolLabel } from "@/lib/tools/slugs";

/**
 * Free-tool results → the Growth Engine (register item F1, "the big one").
 *
 * Someone ran AutoSEO on their own site, got a real score and a real list of
 * what was wrong, and left. `ge_prospects` never heard about them.
 *
 * The consent line is the design, and these tests exist mostly to pin it: the
 * report stays free and ungated, and nothing is captured unless the visitor
 * ASKS for something back. The tool copy already promises "nothing is stored
 * unless you ask us to email it to you" — gating the result would make that a
 * lie, and would collect more addresses and fewer customers.
 */

const ROOT = path.resolve(import.meta.dirname, "..", "..");

describe("the note Jude reads before he calls", () => {
  const at = new Date("2026-07-31T09:00:00Z");

  it("says which tool, what they ran it on, and what it said", () => {
    const note = buildToolLeadNote(
      {
        email: "mick@murphyplumbing.ie",
        tool: "autoseo",
        toolLabel: toolLabel("autoseo"),
        subject: "murphyplumbing.ie",
        headline: "42/100 (F)",
        topFinding: "Secure connection (HTTPS)",
      },
      at
    );
    expect(note).toContain("website SEO check");
    expect(note).toContain("2026-07-31");
    expect(note).toContain("murphyplumbing.ie");
    expect(note).toContain("42/100");
    expect(note).toContain("Secure connection");
  });

  it("marks it as inbound, so it is never worked as a cold list", () => {
    const note = buildToolLeadNote(
      { email: "a@b.ie", tool: "missed-calls", toolLabel: "missed-calls calculator" },
      at
    );
    expect(note).toMatch(/warm inbound/i);
  });

  it("stays short when the tool has no subject or score to report", () => {
    const note = buildToolLeadNote(
      { email: "a@b.ie", tool: "reviews", toolLabel: "review reply writer" },
      at
    );
    expect(note.split("\n").length).toBeLessThanOrEqual(3);
    expect(note).not.toContain("undefined");
    expect(note).not.toContain("null");
  });
});

describe("the company name on the record", () => {
  it("prefers the site they actually ran the tool on", () => {
    expect(
      companyFromLead({ email: "mick@gmail.com", subject: "https://www.murphyplumbing.ie/services" })
    ).toBe("murphyplumbing.ie");
  });

  it("falls back to their own email domain", () => {
    expect(companyFromLead({ email: "mick@murphyplumbing.ie" })).toBe("murphyplumbing.ie");
  });

  it("never files forty unrelated people under 'Gmail'", () => {
    // ge_prospects.company is NOT NULL and it is the first thing shown in
    // every list — a free-mail domain would collapse the whole inbound funnel
    // into one meaningless row name.
    for (const e of ["a@gmail.com", "b@hotmail.co.uk", "c@yahoo.ie", "d@icloud.com", "e@eircom.net"]) {
      const name = companyFromLead({ email: e });
      expect(name, e).not.toMatch(/^(gmail|hotmail|yahoo|icloud|eircom)/i);
      expect(name, e).toContain("free tools");
    }
  });

  it("always returns something, because the column is NOT NULL", () => {
    for (const e of ["x@y.ie", "@nodomain", "weird", "a@gmail.com"]) {
      expect(companyFromLead({ email: e }).length).toBeGreaterThan(0);
    }
  });

  it("does not throw on a subject that isn't a URL", () => {
    expect(() => companyFromLead({ email: "a@b.ie", subject: "not a url" })).not.toThrow();
    expect(companyFromLead({ email: "a@b.ie", subject: "not a url" })).toBe("b.ie");
  });
});

describe("the tool slug list is shared, not duplicated", () => {
  it("labels every slug", () => {
    for (const slug of ALL_TOOL_SLUGS) {
      expect(TOOL_LABELS[slug], slug).toBeTruthy();
    }
  });

  it("degrades to something readable for an unknown slug", () => {
    expect(toolLabel("nonsense")).toBe("free tool");
  });

  it("covers exactly the tools the catalog ships", () => {
    const catalog = readFileSync(path.join(ROOT, "lib", "tools", "catalog.ts"), "utf8");
    for (const slug of ALL_TOOL_SLUGS) {
      expect(catalog, slug).toContain(`slug: "${slug}"`);
    }
  });
});

describe("the capture is gated on asking, not on using", () => {
  const LIB = readFileSync(path.join(ROOT, "lib", "growth", "tool-leads.ts"), "utf8");
  const FORM = readFileSync(
    path.join(ROOT, "components", "tools", "tool-lead-form.tsx"),
    "utf8"
  );
  const ROUTE = readFileSync(
    path.join(ROOT, "app", "api", "tools", "lead", "route.ts"),
    "utf8"
  );

  it("files leads under one narrow source the pipeline can segment by", () => {
    expect(TOOL_LEAD_SOURCE).toBe("freetools");
    expect(LIB).toContain('source: TOOL_LEAD_SOURCE');
  });

  it("dedupes case-insensitively instead of creating a second row", () => {
    // Someone who runs three tools in an evening is one prospect with three
    // notes, not three duplicates Jude merges by hand before he can call.
    expect(LIB).toContain("ilike");
    expect(LIB).toContain("escapeLike");
  });

  it("appends to an existing note rather than overwriting it", () => {
    // That record may already hold research, call outcomes and a proposal.
    expect(LIB).toMatch(/existing\.notes/);
    expect(LIB).not.toMatch(/notes: note \}\)\s*\.eq\("id", existing\.id\)/);
  });

  it("allow-lists the tool slug so a bot cannot invent a source", () => {
    expect(ROUTE).toContain("z.enum(ALL_TOOL_SLUGS");
  });

  it("rate-limits by IP and by email, because it writes CRM rows", () => {
    expect(ROUTE).toContain('consume("tool-lead-ip"');
    expect(ROUTE).toContain('consume("tool-lead-email"');
  });

  it("caps every free-text field before it reaches the note", () => {
    expect(ROUTE).toMatch(/subject:.*max\(200\)/);
    expect(ROUTE).toMatch(/headline:.*max\(120\)/);
    expect(ROUTE).toMatch(/topFinding:.*max\(300\)/);
  });

  it("never blocks or hides the result behind the form", () => {
    // The form renders under a finished report and says so.
    expect(FORM).toContain("already yours");
    expect(FORM).not.toMatch(/return null;?\s*\/\/ gate/);
  });

  it("fails quietly, because the visitor already has what they came for", () => {
    expect(ROUTE).toContain("stored: false");
    expect(FORM).toMatch(/catch \{/);
  });
});
