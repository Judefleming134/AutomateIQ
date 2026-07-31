import { describe, it, expect } from "vitest";
import { canDial } from "@/lib/growth/dialling";
import { PROSPECT_STATUS_META } from "@/lib/growth/constants";

describe("canDial", () => {
  it("withholds the one-tap dial from someone who asked not to be contacted", () => {
    expect(canDial("do_not_contact")).toBe(false);
  });

  it("allows it for every other status", () => {
    // Explicitly enumerated from the real status list, so a NEW status is
    // dialable by default rather than silently blocked — the safe direction
    // here is the opposite of the safe direction above.
    const others = Object.keys(PROSPECT_STATUS_META).filter(
      (s) => s !== "do_not_contact"
    );
    expect(others.length).toBeGreaterThan(10);
    for (const s of others) expect(canDial(s), s).toBe(true);
  });

  it("does not block on a missing status", () => {
    // A null status is a data gap, not an opt-out. Blocking the dial would
    // quietly remove a workable lead from the phone list.
    expect(canDial(null)).toBe(true);
    expect(canDial(undefined)).toBe(true);
  });
});
