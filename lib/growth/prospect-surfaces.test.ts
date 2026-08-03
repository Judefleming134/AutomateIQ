import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PROSPECT_SURFACES } from "./prospect-surfaces";

/**
 * The call list served a cached copy of prospects that had already moved on.
 *
 * Only the two actions that live ON that page — "Log call" and "No answer" —
 * ever revalidated `/growth/call-list`. Every other action that changes what it
 * shows revalidated the dashboard and the prospects table and stopped:
 *
 *   mark a lead Won or Not interested   → still listed, still offering the number
 *   correct a wrong phone number        → still offers the OLD number
 *   change the follow-up date           → still sorted into yesterday's tier
 *   archive or delete from the table    → still listed; a deleted one 404s
 *   import a batch with phone numbers   → none of them appear
 *
 * Ringing a lead who is already closed is the expensive one, and it is
 * completely invisible: the page looks fine, the data behind it is right, and
 * the only symptom is a conversation Jude shouldn't be having.
 *
 * addActivity's own comment already had the rule — "name that page explicitly
 * rather than relying on the dashboard's revalidation to carry it" — it just
 * wasn't applied anywhere else.
 */

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const ACTIONS = readFileSync(
  path.join(ROOT, "app", "growth", "(app)", "prospects", "actions.ts"),
  "utf8"
);
const CALL_LIST = readFileSync(
  path.join(ROOT, "app", "growth", "(app)", "call-list", "page.tsx"),
  "utf8"
);

/** Split actions.ts into one body per exported action. */
function actionBodies(): Map<string, string> {
  const out = new Map<string, string>();
  const marks = [...ACTIONS.matchAll(/export async function (\w+)/g)];
  marks.forEach((m, i) => {
    const start = m.index!;
    const end = i + 1 < marks.length ? marks[i + 1].index! : ACTIONS.length;
    out.set(m[1], ACTIONS.slice(start, end));
  });
  return out;
}

const bodies = actionBodies();

/**
 * Every action that writes a field the call list or the DM list reads.
 * The value names WHY, so a future reader can judge whether it still belongs.
 */
const MUST_REFRESH: Record<string, string> = {
  addProspect: "a new lead with a phone number belongs on the call list",
  importProspects: "an import is the fastest way to add callable leads",
  updateProspect: "edits phone, next_follow_up_at and the social links",
  setProspectStatus: "status decides whether a lead is workable at all",
  researchProspect: "can fill in phone and social links",
  quickResearch: "can fill in phone, status and social links",
  qualifyProspect: "changes lead_score, which the call list orders by",
  bulkProspectAction: "archive clears the follow-up date; delete removes the row",
  deleteProspect: "a deleted prospect must not stay on a working list",
  logNoAnswer: "already refreshed the call list; the DM list reads status too",
  addActivity: "already refreshed the call list; the DM list reads status too",
};

describe("every prospect write refreshes the lists Jude works from", () => {
  it.each(Object.entries(MUST_REFRESH))(
    "%s — %s",
    (action) => {
      const body = bodies.get(action);
      expect(body, `${action} not found in actions.ts`).toBeTruthy();
      expect(body).toContain("revalidateProspectSurfaces(");
    }
  );

  it("the helper covers both working lists, not just the dashboard", () => {
    expect(PROSPECT_SURFACES).toContain("/growth/call-list");
    expect(PROSPECT_SURFACES).toContain("/growth/dms");
    expect(PROSPECT_SURFACES).toContain("/growth/prospects");
    expect(PROSPECT_SURFACES).toContain("/growth");
  });

  it("refreshes the workspace too when an action names one prospect", () => {
    for (const action of ["updateProspect", "setProspectStatus", "qualifyProspect"]) {
      expect(bodies.get(action)).toMatch(/revalidateProspectSurfaces\(\s*id\s*\)/);
    }
  });
});

describe("nothing was taken away to add this", () => {
  it("keeps every revalidation the actions already had", () => {
    // Additive over destructive: the extra surfaces the individual actions
    // named for themselves must survive.
    expect(bodies.get("importProspects")).toContain('revalidatePath("/growth/analytics")');
    expect(bodies.get("importProspects")).toContain('revalidatePath("/growth/campaigns")');
    expect(bodies.get("importProspects")).toContain('revalidatePath("/growth/jarvis")');
    expect(bodies.get("researchProspect")).toContain('revalidatePath("/growth/jarvis")');
    expect(bodies.get("logNoAnswer")).toContain('revalidatePath("/growth/call-list")');
    expect(bodies.get("addActivity")).toContain('revalidatePath("/growth/call-list")');
  });

  it("the helper only invalidates — it cannot change what a page renders", () => {
    const SRC = readFileSync(path.join(ROOT, "lib", "growth", "prospect-surfaces.ts"), "utf8");
    const code = SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(code).toContain("revalidatePath");
    // No writes, no redirects, no reads — it is a cache instruction and
    // nothing else, which is what makes it safe to add everywhere.
    for (const forbidden of ["createAdminClient", "redirect(", ".update(", ".insert(", ".delete("]) {
      expect(code).not.toContain(forbidden);
    }
  });
});

describe("the fields that make this matter", () => {
  it("the call list really does filter on status and phone", () => {
    // If it stopped doing so, this whole guard would be protecting nothing.
    expect(CALL_LIST).toContain('.not("phone", "is", null)');
    expect(CALL_LIST).toContain('.in("status", WORKABLE)');
  });

  it("the call list really does tier on next_follow_up_at", () => {
    expect(CALL_LIST).toContain("next_follow_up_at");
    expect(CALL_LIST).toContain("const tier =");
  });

  it("the call list really does order on lead_score", () => {
    expect(CALL_LIST).toContain('.order("lead_score"');
  });

  it("a closed lead is genuinely excluded, so a stale page is the only way to see one", () => {
    // WORKABLE is the pre-close set. Won / not interested / archived are not in
    // it, which is exactly why marking a lead closed must refresh this page.
    const workable = CALL_LIST.slice(CALL_LIST.indexOf("const WORKABLE"), CALL_LIST.indexOf("\n", CALL_LIST.indexOf("const WORKABLE")) + 200);
    for (const closed of ["won", "not_interested", "archived", "disqualified"]) {
      expect(workable).not.toContain(`"${closed}"`);
    }
  });
});
