import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  clientAddress,
  hashIp,
  overIpLimit,
  IP_BOOKING_LIMIT,
  IP_BOOKING_WINDOW_HOURS,
} from "./ip-guard";

/**
 * The booking endpoint's per-origin guard (OUTSTANDING K5).
 *
 * /api/book limited three bookings per EMAIL per day. That guard does real
 * work, but a script varying the address walked straight past it — and every
 * accepted booking holds a calendar slot AND sends two emails, one to whatever
 * address the caller typed. Unbounded: a full calendar no real prospect can
 * book into, and the sending domain's reputation spent on third parties.
 */

const ROOT = path.resolve(import.meta.dirname, "..", "..");
let savedSalt: string | undefined;

beforeEach(() => {
  savedSalt = process.env.BOOKING_IP_SALT;
  delete process.env.BOOKING_IP_SALT;
});
afterEach(() => {
  if (savedSalt === undefined) delete process.env.BOOKING_IP_SALT;
  else process.env.BOOKING_IP_SALT = savedSalt;
});

describe("the address is never stored raw", () => {
  it("hashes to something that contains no part of the address", () => {
    const h = hashIp("81.17.242.19")!;
    expect(h).not.toContain("81.17");
    expect(h).toMatch(/^[a-f0-9]{64}$/);
  });

  it("is stable, so the same origin counts as one", () => {
    expect(hashIp("81.17.242.19")).toBe(hashIp("81.17.242.19"));
  });

  it("separates different origins", () => {
    expect(hashIp("81.17.242.19")).not.toBe(hashIp("81.17.242.20"));
  });

  it("changes completely once a real salt is set", () => {
    const withFallback = hashIp("81.17.242.19");
    process.env.BOOKING_IP_SALT = "a-real-secret";
    expect(hashIp("81.17.242.19")).not.toBe(withFallback);
  });

  it("handles IPv6 and whitespace without throwing", () => {
    expect(hashIp("  2a02:8084:1a2b::1  ")).toMatch(/^[a-f0-9]{64}$/);
    expect(hashIp("2a02:8084:1a2b::1")).toBe(hashIp("  2a02:8084:1a2b::1  "));
  });
});

describe("an unknown origin is never counted, and never blocked", () => {
  it.each([null, undefined, "", "   "])("returns null for %s", (v) => {
    expect(hashIp(v)).toBeNull();
  });

  it("returns null when no forwarding header is present", () => {
    expect(clientAddress(new Headers())).toBeNull();
  });

  it("never invents a placeholder key", () => {
    // Lumping every address-less request under one key would let the first
    // few lock out all the others — a denial of service built into the guard.
    const src = readFileSync(path.join(ROOT, "lib", "booking", "ip-guard.ts"), "utf8");
    expect(src).not.toMatch(/return ["']unknown["']/);
    expect(src).not.toMatch(/\?\?\s*["']0\.0\.0\.0["']/);
  });
});

describe("it reads the client, not the proxy", () => {
  it("takes the first entry of an X-Forwarded-For chain", () => {
    const h = new Headers({ "x-forwarded-for": "81.17.242.19, 10.0.0.1, 172.16.0.4" });
    expect(clientAddress(h)).toBe("81.17.242.19");
  });

  it("trims the entry", () => {
    expect(clientAddress(new Headers({ "x-forwarded-for": "  81.17.242.19 , 10.0.0.1" }))).toBe(
      "81.17.242.19"
    );
  });

  it("falls back to x-real-ip", () => {
    expect(clientAddress(new Headers({ "x-real-ip": "81.17.242.19" }))).toBe("81.17.242.19");
  });

  it("prefers the forwarded chain when both are present", () => {
    const h = new Headers({ "x-forwarded-for": "81.17.242.19", "x-real-ip": "10.0.0.1" });
    expect(clientAddress(h)).toBe("81.17.242.19");
  });
});

describe("the threshold", () => {
  it("allows a shared office through", () => {
    // A site hut, an office or a co-working space is one address. Two
    // colleagues booking on the same afternoon is a good day, not an attack.
    expect(overIpLimit(0)).toBe(false);
    expect(overIpLimit(3)).toBe(false);
    expect(overIpLimit(IP_BOOKING_LIMIT - 1)).toBe(false);
  });

  it("blocks at the ceiling", () => {
    expect(overIpLimit(IP_BOOKING_LIMIT)).toBe(true);
    expect(overIpLimit(IP_BOOKING_LIMIT + 50)).toBe(true);
  });

  it("sits above the per-email limit, not below it", () => {
    // Below it, the origin guard would fire first and the email guard would
    // become unreachable.
    expect(IP_BOOKING_LIMIT).toBeGreaterThan(3);
  });

  it("counts over a full day", () => {
    expect(IP_BOOKING_WINDOW_HOURS).toBe(24);
  });
});

describe("the endpoint is actually wired to it", () => {
  const ROUTE = readFileSync(path.join(ROOT, "app", "api", "book", "route.ts"), "utf8");

  it("hashes the caller and counts recent bookings for it", () => {
    expect(ROUTE).toContain("hashIp(clientAddress(request.headers))");
    expect(ROUTE).toContain('.eq("created_ip_hash", ipHash)');
  });

  it("stores the hash on the booking it creates", () => {
    expect(ROUTE).toMatch(/insert\(\{\s*created_ip_hash: ipHash/);
  });

  it("keeps the existing per-email guard as well", () => {
    // The two catch different things — one address booking repeatedly, and
    // one origin cycling addresses.
    expect(ROUTE).toContain("recentForEmail");
    expect(ROUTE).toContain('.ilike("email"');
  });

  it("fails OPEN if the count query errors", () => {
    // Losing a genuine booking is worse than letting one extra through —
    // the same stance the email guard already takes.
    expect(ROUTE).toMatch(/!ipError && overIpLimit/);
  });

  it("never blocks when the origin is unknown", () => {
    expect(ROUTE).toMatch(/if \(ipHash\) \{/);
  });
});

describe("the migration", () => {
  const SQL = readFileSync(
    path.join(ROOT, "supabase", "migrations", "0035_booking_ip_guard.sql"),
    "utf8"
  );

  it("is idempotent", () => {
    expect(SQL).toContain("add column if not exists");
    expect(SQL).toContain("create index if not exists");
  });

  it("adds a nullable column, so existing bookings are untouched", () => {
    expect(SQL).not.toMatch(/created_ip_hash text not null/i);
  });

  it("indexes exactly what the guard queries", () => {
    expect(SQL).toMatch(/\(created_ip_hash, created_at desc\)/);
  });

  it("says in the schema itself that it is never a raw address", () => {
    expect(SQL).toMatch(/comment on column strategy_bookings\.created_ip_hash/i);
    expect(SQL).toMatch(/[Nn]ever a raw address/);
  });
});
