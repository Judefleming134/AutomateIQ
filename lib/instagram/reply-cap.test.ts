import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { MAX_AUTO_REPLIES_PER_DAY } from "@/lib/instagram/setter-core";

/**
 * The Instagram setter had no ceiling of any kind.
 *
 * One inbound event → one AI call → one outbound DM, for ever. So a spam run,
 * a looping integration, or simply someone hammering the message box put the
 * CUSTOMER'S OWN Instagram account into an unbounded send loop — and every
 * turn of it costs an AI call too.
 *
 * Instagram rate-limits and flags accounts that behave like that, and it is
 * the customer's account on the line, not ours. "The AI you sold me got my
 * Instagram restricted" is about as bad as this product fails.
 *
 * The webhook already filters echoes (`is_echo`), so this is not about our own
 * messages coming back — it is about volume from the other side.
 *
 * The cap is deliberately far above any real conversation. A lead asking about
 * a job trades a handful of messages; thirty is not a conversation, it is a
 * malfunction. Normal use never reaches it.
 */

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const SRC = readFileSync(path.join(ROOT, "lib", "instagram", "setter-core.ts"), "utf8");
const WEBHOOK = readFileSync(
  path.join(ROOT, "app", "api", "ig", "webhook", "route.ts"),
  "utf8"
);

describe("the cap is set where it protects without interfering", () => {
  it("is high enough that a real conversation never meets it", () => {
    // If this ever drops near single digits it would start cutting off
    // genuine leads mid-conversation, which is worse than the problem.
    expect(MAX_AUTO_REPLIES_PER_DAY).toBeGreaterThanOrEqual(20);
  });

  it("is low enough to stop a runaway being expensive", () => {
    expect(MAX_AUTO_REPLIES_PER_DAY).toBeLessThanOrEqual(50);
  });

  it("counts a rolling 24 hours, not a calendar day", () => {
    // A calendar day resets at midnight and hands a stuck loop a fresh
    // allowance every night.
    expect(SRC).toContain("24 * 3600 * 1000");
  });
});

describe("what it counts", () => {
  it("only the setter's OWN automatic replies", () => {
    // Not the lead's messages, and not anything a human sent from the portal —
    // a human answering a busy thread must not use up the automation's budget.
    const block = SRC.slice(SRC.indexOf("const dayStart"), SRC.indexOf("MAX_AUTO_REPLIES_PER_DAY)"));
    expect(block).toContain('.eq("direction", "outbound")');
    expect(block).toContain('.eq("sender", "ai")');
  });

  it("scopes to the one conversation, not the whole account", () => {
    // A busy account with many separate leads is a good day, not an incident.
    const block = SRC.slice(SRC.indexOf("const dayStart"), SRC.indexOf("MAX_AUTO_REPLIES_PER_DAY)"));
    expect(block).toContain('.eq("conversation_id", conversationId)');
  });

  it("uses a head count — it does not pull the messages back", () => {
    const block = SRC.slice(SRC.indexOf("const dayStart"), SRC.indexOf("MAX_AUTO_REPLIES_PER_DAY)"));
    expect(block).toContain('{ count: "exact", head: true }');
  });
});

describe("hitting the cap hands over rather than dropping the lead", () => {
  it("still records the lead's message", () => {
    // The inbound insert happens BEFORE the cap check, so nothing a lead
    // sends is ever lost — only the automatic answer stops.
    expect(SRC.indexOf('direction: "inbound"')).toBeLessThan(SRC.indexOf("const dayStart"));
  });

  it("does NOT mark the conversation engaged", () => {
    // It keeps showing in the portal as needing attention, which is right:
    // a thread this long wants a human.
    // Sliced to the `return`, not to the first "}" — the first brace in this
    // branch closes `${conversationId}` inside the log template, which cut the
    // window before the thing being asserted on.
    const branch = SRC.slice(SRC.indexOf("if ((repliesToday ?? 0) >="));
    const ret = branch.slice(0, branch.indexOf(";", branch.indexOf("return ")));
    expect(ret).not.toContain('status: "engaged"');
    expect(ret).toContain("cappedOut: true");
  });

  it("says so in the logs rather than failing silently", () => {
    expect(SRC).toContain("hit the ${MAX_AUTO_REPLIES_PER_DAY}-reply daily cap");
  });

  it("reports autoReplied false, so no caller thinks it answered", () => {
    const branch = SRC.slice(SRC.indexOf("if ((repliesToday ?? 0) >="));
    const ret = branch.slice(0, branch.indexOf(";", branch.indexOf("return ")));
    expect(ret).toContain("autoReplied: false");
  });

  it("costs no AI call once capped", () => {
    // The whole point: the cap sits BEFORE generateSetterReply, not after.
    expect(SRC.indexOf("const dayStart")).toBeLessThan(SRC.indexOf("generateSetterReply({"));
  });
});

describe("everything the setter already got right is untouched", () => {
  it("the auto-reply toggle still short-circuits first", () => {
    expect(SRC.indexOf('settings?.auto_reply === false')).toBeLessThan(SRC.indexOf("const dayStart"));
  });

  it("delivery is still confirmed before the reply is recorded", () => {
    // The failure that mattered most: a reply shown in the portal as sent
    // while the lead got nothing.
    expect(SRC).toContain("if (deliver) {");
    expect(SRC.indexOf("const delivered = await deliver(reply)")).toBeLessThan(
      SRC.indexOf('direction: "outbound",\n    sender: "ai",')
    );
  });

  it("the webhook still drops our own echoes", () => {
    expect(WEBHOOK).toContain("ev.message?.is_echo");
  });

  it("every query is still scoped by business_id or conversation_id", () => {
    // Tenant safety — the webhook calls this with the service-role client,
    // which has no RLS to fall back on.
    const body = SRC.slice(SRC.indexOf("export async function handleInboundMessage"));
    const froms = [...body.matchAll(/\.from\("(\w+)"\)/g)].map((m) => m[1]);
    expect(froms.length).toBeGreaterThan(3);
    expect(body).toContain('.eq("business_id", businessId)');
  });
});
