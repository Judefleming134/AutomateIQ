import { describe, it, expect } from "vitest";
import { PROSPECT_STATUS_META, CLOSED_STATUSES } from "@/lib/growth/constants";

/**
 * The prospect workspace shows a "Next best move" / "Where this stands" panel
 * driven by a status → guidance map. Any status missing from that map renders
 * NOTHING — the panel silently disappears.
 *
 * That was survivable while every stop-state was set by hand. It stopped being
 * survivable when the inbound classifier began setting do_not_contact
 * automatically on an opt-out reply: a lead changes status on its own, and a
 * blank workspace gives no clue what happened.
 *
 * This pins the list, so adding a nineteenth status forces a decision about
 * what the workspace should say about it rather than letting it fall through.
 */

const WORKSPACE_GUIDANCE_STATUSES = [
  "new",
  "researching",
  "research_failed",
  "research_complete",
  "outreach_ready",
  "contacted",
  "follow_up_sent",
  "replied",
  "qualified",
  "meeting_booked",
  "proposal_in_progress",
  "proposal_sent",
  "negotiation",
  "won",
  "lost",
  "future_opportunity",
  "do_not_contact",
  "archived",
].sort();

describe("prospect statuses", () => {
  it("every status has a label and badge", () => {
    for (const [key, meta] of Object.entries(PROSPECT_STATUS_META)) {
      expect(meta.label.length, `${key} label`).toBeGreaterThan(0);
      expect(meta.badge.length, `${key} badge`).toBeGreaterThan(0);
    }
  });

  it("the workspace guidance map is expected to cover every status", () => {
    // If this fails, a status was added to constants.ts without deciding what
    // the prospect workspace should say about it — which shows up to the user
    // as a panel that just isn't there.
    expect(Object.keys(PROSPECT_STATUS_META).sort()).toEqual(WORKSPACE_GUIDANCE_STATUSES);
  });

  it("do_not_contact is a closed status, so no outreach schedules against it", () => {
    // The opt-out path depends on this: do_not_contact sitting outside the
    // active statuses is what holds a queued cold touch at send time.
    expect(CLOSED_STATUSES).toContain("do_not_contact");
  });

  it("future_opportunity is NOT closed — the recycle loop brings it back", () => {
    expect(CLOSED_STATUSES).not.toContain("future_opportunity");
  });
});
