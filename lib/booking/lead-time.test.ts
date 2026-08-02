import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { BOOKING_CONFIG, generateAvailability, isBookableSlot } from "@/lib/booking/slots";

/**
 * J3: the call script offered a slot the booking page refused.
 *
 * The phone script says "would tomorrow morning suit?". At `minLeadHours: 24`
 * a call placed at 11am on Monday made every slot before 11am on Tuesday
 * unbookable — so the entire next morning was missing from the page the lead
 * was being sent to WHILE STILL ON THE PHONE. A 2pm call took the morning and
 * the early afternoon with it.
 *
 * The register had this open as a decision since 2026-07-27: "one of the two
 * has to change". Changed here, and the script is the half that's right — a
 * lead who says yes to tomorrow morning is the warmest lead the engine
 * produces, and telling them to wait two days is how that goes cold.
 *
 * 12 hours is the value that unblocks tomorrow morning without allowing a
 * same-day booking. These tests pin both halves, because either one drifting
 * puts the promise and the page back out of step.
 */

// Monday 4 August 2026. Working hours are 09:00–17:00, slots every 30 min.
const MON_9AM = new Date("2026-08-03T09:00:00.000Z");
const MON_11AM = new Date("2026-08-03T11:00:00.000Z");
const MON_2PM = new Date("2026-08-03T14:00:00.000Z");
const MON_5PM = new Date("2026-08-03T17:00:00.000Z");
const MON_9PM = new Date("2026-08-03T21:00:00.000Z");

const TUE = "2026-08-04";
const slotsOn = (now: Date, date: string) =>
  generateAvailability(now).find((d) => d.date === date)?.slots.map((s) => s.label) ?? [];

describe("the script's offer is one the page can honour", () => {
  it.each([
    ["a 9am call", MON_9AM],
    ["an 11am call", MON_11AM],
    ["a 2pm call", MON_2PM],
    ["a 5pm call", MON_5PM],
    ["a 9pm call", MON_9PM],
  ])("%s can still book tomorrow at 9am", (_label, now) => {
    expect(slotsOn(now, TUE)).toContain("9:00am");
  });

  it("offers the WHOLE of tomorrow morning, not the tail of it", () => {
    const morning = slotsOn(MON_2PM, TUE).filter((l) => l.endsWith("am"));
    expect(morning).toEqual([
      "9:00am",
      "9:30am",
      "10:00am",
      "10:30am",
      "11:00am",
      "11:30am",
    ]);
  });

  it("the old 24-hour rule is what removed it — this is the regression", () => {
    // Replay the previous behaviour against the same clock. Not a hypothetical:
    // this is what a lead saw after every morning call.
    const at24 = (label: string) => {
      const iso = `${TUE}T${label === "9:00am" ? "09" : "11"}:00:00.000Z`;
      return new Date(iso).getTime() >= MON_11AM.getTime() + 24 * 3600_000;
    };
    expect(at24("9:00am")).toBe(false); // was refused
    expect(slotsOn(MON_11AM, TUE)).toContain("9:00am"); // is offered now
  });
});

describe("but nothing can be booked at short notice today", () => {
  const TODAY = "2026-08-03";

  it.each([
    ["a 9am call", MON_9AM],
    ["an 11am call", MON_11AM],
    ["a 2pm call", MON_2PM],
  ])("%s cannot grab a slot later the same day", (_label, now) => {
    expect(slotsOn(now, TODAY)).toEqual([]);
  });

  it("holds even for the last slot of the day", () => {
    // 16:30 is the latest start. Twelve hours before it is 04:30, which is
    // never a working hour — so no same-day booking is reachable at all.
    expect(isBookableSlot(`${TODAY}T16:30:00.000Z`, MON_9AM)).toBe(false);
  });

  it("12 hours is the number doing that — it is not incidental", () => {
    // If this is ever raised back above ~12, tomorrow morning starts
    // disappearing again; if it drops below ~8, same-day becomes reachable
    // from an early call. Both are the bug, in opposite directions.
    expect(BOOKING_CONFIG.minLeadHours).toBe(12);
  });
});

describe("the weekend and the rest of the rules are untouched", () => {
  it("a Friday afternoon call lands on Monday, not Saturday", () => {
    const friday = new Date("2026-08-07T15:00:00.000Z");
    const days = generateAvailability(friday);
    expect(days[0].weekday).toBe("Monday");
    expect(days.some((d) => d.weekday === "Saturday" || d.weekday === "Sunday")).toBe(false);
  });

  it("still refuses a slot that has already gone", () => {
    expect(isBookableSlot("2026-07-01T10:00:00.000Z", MON_9AM)).toBe(false);
  });

  it("still refuses a weekend slot outright", () => {
    expect(isBookableSlot("2026-08-08T10:00:00.000Z", MON_9AM)).toBe(false);
  });

  it("a taken slot is still removed", () => {
    const taken = new Set([`${TUE}T09:00:00.000Z`]);
    const day = generateAvailability(MON_9AM, taken).find((d) => d.date === TUE)!;
    expect(day.slots.map((s) => s.label)).not.toContain("9:00am");
    expect(day.slots.map((s) => s.label)).toContain("9:30am");
  });

  it("the server guard and the rendered page agree — one config, both paths", () => {
    // The API validates independently. If it read a different lead time the
    // page would offer slots the booking then rejected.
    const first = generateAvailability(MON_2PM)[0].slots[0].iso;
    expect(isBookableSlot(first, MON_2PM)).toBe(true);
  });

  it("nothing else about the session changed", () => {
    expect(BOOKING_CONFIG.slotMinutes).toBe(30);
    expect(BOOKING_CONFIG.startHour).toBe(9);
    expect(BOOKING_CONFIG.endHour).toBe(17);
    expect(BOOKING_CONFIG.durationLabel).toBe("15 minutes");
  });
});

describe("the script and the config now say the same thing", () => {
  const ROOT = path.resolve(import.meta.dirname, "..", "..");

  it("the config explains itself, so the next reader doesn't reopen J3", () => {
    const SRC = readFileSync(path.join(ROOT, "lib", "booking", "slots.ts"), "utf8");
    expect(SRC).toContain("tomorrow morning");
    expect(SRC).toContain("J3");
  });
});
