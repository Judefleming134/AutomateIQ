import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  renderTemplate,
  unknownPlaceholders,
  placeholderProblem,
  SUPPORTED_VARS,
  PREVIEW_VARS,
  DEFAULT_STL_SUBJECT,
  DEFAULT_STL_TEMPLATE,
} from "@/lib/speed-to-lead/template";

/**
 * LeadIQ's reply template — the email every one of a customer's leads gets.
 *
 * TWO THINGS WERE MISSING, AND THEY COMPOUND.
 *
 * 1. renderTemplate substitutes exactly {{name}} and {{business}}. Anything
 *    else — {{first_name}}, {{Name}}, {{company}}, a typo — is left completely
 *    untouched and mailed to a real customer verbatim:
 *
 *        Hi {{first_name}}, thanks for contacting Walsh Joinery
 *
 *    The Growth Engine already refuses to SEND on exactly this condition
 *    (draftLooksBroken flags an unfilled {{placeholder}}). LeadIQ had no
 *    equivalent — and it is the worse place for it, because this template is
 *    saved once and then sent to EVERY lead, unattended, until somebody
 *    notices.
 *
 * 2. There was no preview. The settings form let you rewrite that email and
 *    showed you nothing; you saved it blind and the next real enquiry was the
 *    test. This file's own doc comment claimed the preview existed ("shared by
 *    the settings preview and the lead-capture route so what the customer
 *    previews is exactly what gets sent") — it did not.
 */

const ROOT = path.resolve(import.meta.dirname, "..", "..");

describe("substitution still does what it always did", () => {
  it("fills both supported variables", () => {
    expect(renderTemplate("Hi {{name}} from {{business}}", { name: "Tom", business: "Walsh" }))
      .toBe("Hi Tom from Walsh");
  });

  it("fills every occurrence, not just the first", () => {
    expect(renderTemplate("{{name}} {{name}} {{name}}", { name: "Tom", business: "b" }))
      .toBe("Tom Tom Tom");
  });

  it("leaves a template with no placeholders alone", () => {
    expect(renderTemplate("Thanks for your enquiry", PREVIEW_VARS))
      .toBe("Thanks for your enquiry");
  });
});

describe("catching what will NOT be filled in", () => {
  it("finds a plausible-looking typo", () => {
    expect(unknownPlaceholders("Hi {{first_name}}")).toEqual(["first_name"]);
  });

  it("catches wrong casing — {{Name}} is not {{name}}", () => {
    // renderTemplate does an exact string replace, so this really does go out
    // as "{{Name}}".
    expect(unknownPlaceholders("Hi {{Name}}")).toEqual(["Name"]);
    expect(renderTemplate("Hi {{Name}}", PREVIEW_VARS)).toBe("Hi {{Name}}");
  });

  it("passes the supported ones", () => {
    expect(unknownPlaceholders("Hi {{name}} from {{business}}")).toEqual([]);
  });

  it("tolerates whitespace inside the braces", () => {
    // {{ name }} is not substituted either — worth flagging, not ignoring.
    expect(unknownPlaceholders("Hi {{ name }}")).toEqual([]);
    expect(renderTemplate("Hi {{ name }}", PREVIEW_VARS)).toBe("Hi {{ name }}");
  });

  it("reports each unknown once, in the order they appear", () => {
    expect(unknownPlaceholders("{{b}} {{a}} {{b}} {{a}} {{c}}")).toEqual(["b", "a", "c"]);
  });

  it("finds several at once", () => {
    expect(unknownPlaceholders("{{first_name}} at {{company}}")).toEqual([
      "first_name",
      "company",
    ]);
  });

  it("is not confused by single braces or ordinary prose", () => {
    expect(unknownPlaceholders("Costs {100} or so, {not a placeholder}")).toEqual([]);
    expect(unknownPlaceholders("")).toEqual([]);
  });

  it("clears the shipped defaults", () => {
    // The defaults are what a customer starts from; if they tripped the guard
    // nobody could save anything.
    expect(unknownPlaceholders(DEFAULT_STL_SUBJECT)).toEqual([]);
    expect(unknownPlaceholders(DEFAULT_STL_TEMPLATE)).toEqual([]);
    expect(placeholderProblem(DEFAULT_STL_TEMPLATE)).toBeNull();
  });
});

describe("what the customer is told", () => {
  it("says nothing when the template is fine", () => {
    expect(placeholderProblem("Hi {{name}}")).toBeNull();
  });

  it("names the offending placeholder", () => {
    expect(placeholderProblem("Hi {{first_name}}")).toContain("{{first_name}}");
  });

  it("suggests the right one when it is only a casing slip", () => {
    expect(placeholderProblem("Hi {{Name}}")).toContain("did you mean {{name}}?");
  });

  it("suggests the right one for a near-miss", () => {
    expect(placeholderProblem("Hi {{first_name}}")).toContain("did you mean {{name}}?");
    expect(placeholderProblem("At {{business_name}}")).toContain("did you mean {{business}}?");
  });

  it("says what WOULD have happened, not just 'invalid'", () => {
    // "Invalid placeholder" leaves them guessing at the spelling, and a wrong
    // guess here is an email to a stranger, not a form error.
    const msg = placeholderProblem("Hi {{whatever}}")!;
    expect(msg).toMatch(/sent to your customer exactly as written/i);
    expect(msg).toContain("{{name}}");
    expect(msg).toContain("{{business}}");
  });

  it("reads correctly for one and for several", () => {
    expect(placeholderProblem("{{a}}")).toContain("isn't");
    expect(placeholderProblem("{{a}} {{b}}")).toContain("aren't");
  });
});

describe("the supported set is the one the renderer implements", () => {
  it("every declared variable is actually substituted", () => {
    // The list drives the warning message; if it claimed a variable the
    // renderer doesn't handle, the guard would wave through a broken template.
    for (const v of SUPPORTED_VARS) {
      const out = renderTemplate(`[{{${v}}}]`, { name: "N", business: "B" });
      expect(out, v).not.toContain("{{");
    }
  });

  it("nothing outside the list survives substitution untouched by accident", () => {
    expect(renderTemplate("{{other}}", PREVIEW_VARS)).toBe("{{other}}");
  });
});

describe("the save path refuses a template that would go out broken", () => {
  const ACTIONS = readFileSync(
    path.join(ROOT, "app", "portal", "speed-to-lead-agent", "actions.ts"),
    "utf8"
  );

  it("checks the subject AND the body", () => {
    expect(ACTIONS).toContain("placeholderProblem(parsed.data.subject)");
    expect(ACTIONS).toContain("placeholderProblem(parsed.data.replyTemplate)");
  });

  it("blocks the save rather than warning and saving anyway", () => {
    expect(ACTIONS).toMatch(/if \(badSubject\) return \{ error:/);
    expect(ACTIONS).toMatch(/if \(badBody\) return \{ error:/);
  });

  it("gates the test send on the same rule", () => {
    // Demonstrating a broken template as if it worked would be worse than not
    // offering a test at all.
    const test = ACTIONS.slice(ACTIONS.indexOf("export async function sendTestReply"));
    expect(test).toContain("placeholderProblem(parsed.data.subject)");
    expect(test).toContain("placeholderProblem(parsed.data.replyTemplate)");
  });
});

describe("the test send", () => {
  const ACTIONS = readFileSync(
    path.join(ROOT, "app", "portal", "speed-to-lead-agent", "actions.ts"),
    "utf8"
  );
  const TEST = ACTIONS.slice(ACTIONS.indexOf("export async function sendTestReply"));

  it("goes to the signed-in user, never an address from the form", () => {
    // A form-supplied recipient would turn the portal into an open relay.
    expect(TEST).toContain("const to = user.email");
    expect(TEST).not.toMatch(/formData\.get\("(to|email|recipient)"\)/);
  });

  it("requires the product to be enabled", () => {
    expect(TEST).toContain('requireProductEnabled(businessId, "speed-to-lead-agent")');
  });

  it("sends the values on screen, not the saved row", () => {
    // The whole point is to test BEFORE committing it to every future lead.
    expect(TEST).toContain('formData.get("subject")');
    expect(TEST).toContain('formData.get("replyTemplate")');
  });

  it("marks it as a test in the inbox", () => {
    expect(TEST).toContain("[Test]");
  });

  it("does NOT log to stl_replies", () => {
    // That table is the record of replies to real leads and the dashboard
    // counts it — a test that inflated "instant replies sent" would make the
    // product's own headline number a lie.
    expect(TEST).not.toContain('from("stl_replies")');
  });

  it("reports a send failure instead of claiming success", () => {
    expect(TEST).toMatch(/if \(result\.error\)/);
    expect(TEST).toContain("Could not send");
  });
});

describe("the editor shows the same thing the sender sends", () => {
  const EDITOR = readFileSync(
    path.join(ROOT, "app", "portal", "speed-to-lead-agent", "reply-editor.tsx"),
    "utf8"
  );

  it("previews through the shared renderTemplate, not its own copy", () => {
    // A second implementation is how a preview starts lying.
    expect(EDITOR).toContain('from "@/lib/speed-to-lead/template"');
    expect(EDITOR).toContain("renderTemplate(subject, vars)");
    expect(EDITOR).toContain("renderTemplate(body, vars)");
  });

  it("warns live, as they type", () => {
    expect(EDITOR).toContain("placeholderProblem(subject)");
    expect(EDITOR).toContain("placeholderProblem(body)");
  });

  it("previews with the REAL business name", () => {
    // A fake business name would preview a different email from the one sent.
    expect(EDITOR).toContain("businessName");
  });

  it("keeps Save — the test button is additive", () => {
    expect(EDITOR).toContain("Save reply");
    expect(EDITOR).toContain("Send me a test");
  });

  it("is wired into the page", () => {
    const PAGE = readFileSync(
      path.join(ROOT, "app", "portal", "speed-to-lead-agent", "page.tsx"),
      "utf8"
    );
    expect(PAGE).toContain("<ReplyEditor");
    expect(PAGE).toContain("businessName={business?.name");
  });
});
