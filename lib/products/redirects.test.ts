import { describe, it, expect } from "vitest";
import nextConfig from "@/next.config";

/**
 * The redirect table, guarded.
 *
 * These are not cosmetic. `/tradeos/doc/<token>` URLs are sitting in the
 * inboxes of tradespeople's OWN customers — invoices and quotes emailed before
 * the route moved to /tradeiq. Every one of them must still resolve, and the
 * :path* form is what carries the token through. Delete one of these rows and
 * a stranger clicking an invoice link gets a 404 instead of a payment page.
 */

type Redirect = { source: string; destination: string; permanent: boolean };

async function redirects(): Promise<Redirect[]> {
  const fn = (nextConfig as { redirects?: () => Promise<Redirect[]> }).redirects;
  if (!fn) throw new Error("next.config has no redirects()");
  return fn();
}

const find = (rows: Redirect[], source: string) => rows.find((r) => r.source === source);

describe("redirect table", () => {
  it("keeps every emailed /tradeos document link working, with the token", async () => {
    const rows = await redirects();
    const wildcard = find(rows, "/tradeos/:path*");
    expect(wildcard, "/tradeos/:path* must exist").toBeDefined();
    expect(wildcard!.destination).toBe("/tradeiq/:path*");
    // Permanent: /tradeiq is genuinely canonical now, so the ranking should
    // transfer rather than being held at the old URL forever.
    expect(wildcard!.permanent).toBe(true);
  });

  it("redirects the bare /tradeos too, not just sub-paths", async () => {
    const rows = await redirects();
    expect(find(rows, "/tradeos")?.destination).toBe("/tradeiq");
  });

  it("no longer points /tradeiq at /tradeos — that direction is reversed", async () => {
    // While the brand led the URL, /tradeiq → /tradeos. Leaving that in place
    // alongside the new rule would be a redirect loop.
    const rows = await redirects();
    expect(find(rows, "/tradeiq")).toBeUndefined();
    expect(find(rows, "/tradeiq/:path*")).toBeUndefined();
  });

  it("has no source that is also a destination — nothing can loop", async () => {
    const rows = await redirects();
    const sources = new Set(rows.map((r) => r.source));
    for (const r of rows) {
      expect(sources.has(r.destination), `${r.destination} is both a source and a destination`).toBe(false);
    }
  });

  it("retires the two orphaned static pages to live equivalents", async () => {
    const rows = await redirects();
    expect(find(rows, "/demo.html")?.destination).toBe("/demo");
    expect(find(rows, "/agents.html")?.destination).toBe("/systems");
    expect(find(rows, "/demo.html")?.permanent).toBe(true);
    expect(find(rows, "/agents.html")?.permanent).toBe(true);
  });

  it("still carries the earlier free-tools moves", async () => {
    const rows = await redirects();
    expect(find(rows, "/autoseo")?.destination).toBe("/freetools/autoseo");
    expect(find(rows, "/tools")?.destination).toBe("/freetools");
    expect(find(rows, "/tools/:path*")?.destination).toBe("/freetools/:path*");
  });

  it("every destination is an in-app absolute path", async () => {
    const rows = await redirects();
    for (const r of rows) {
      expect(r.destination.startsWith("/"), r.destination).toBe(true);
      expect(r.destination).not.toContain("//");
    }
  });
});
