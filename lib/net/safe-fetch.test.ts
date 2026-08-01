import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { safeFetch, isPublicWebHost, MAX_REDIRECTS } from "@/lib/net/safe-fetch";

/**
 * THE HOLE. `isPublicWebHost` is a careful guard, and it was applied to the
 * URL the user typed — then the fetch ran with `redirect: "follow"`, and
 * nothing re-checked where the redirects went.
 *
 *     user submits   https://attacker.example/
 *     guard says     public host, fine
 *     attacker sends 302 Location: http://169.254.169.254/latest/meta-data/…
 *     node follows   and hands us the response body
 *
 * /api/tools/response-time and /api/autoseo are PUBLIC and unauthenticated,
 * so the attacker needs nothing but the URL — and the body comes back to them
 * in the report.
 */

const ROOT = path.resolve(import.meta.dirname, "..", "..");

/** A fake fetch driven by a redirect map. Records every URL requested. */
function fakeNet(routes: Record<string, { status?: number; location?: string; body?: string }>) {
  const requested: string[] = [];
  const impl = vi.fn(async (input: string | URL, init?: RequestInit) => {
    void init;
    const url = String(input);
    requested.push(url);
    const route = routes[url] ?? { status: 200, body: "ok" };
    const headers = new Headers();
    if (route.location) headers.set("location", route.location);
    return new Response(route.body ?? "", {
      status: route.status ?? 200,
      headers,
    });
  });
  vi.stubGlobal("fetch", impl);
  return { requested, impl };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the attack this exists to stop", () => {
  it("REFUSES a redirect to the cloud metadata endpoint", async () => {
    const { requested } = fakeNet({
      "https://attacker.example/": {
        status: 302,
        location: "http://169.254.169.254/latest/meta-data/iam/security-credentials/",
      },
    });

    const r = await safeFetch("https://attacker.example/");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("redirected to a non-public address");
    expect(r.blockedUrl).toContain("169.254.169.254");
    // And crucially: the metadata endpoint was never actually requested.
    expect(requested).toEqual(["https://attacker.example/"]);
  });

  it("REFUSES a redirect to localhost", async () => {
    const { requested } = fakeNet({
      "https://attacker.example/": { status: 301, location: "http://127.0.0.1:8080/admin" },
    });
    const r = await safeFetch("https://attacker.example/");
    expect(r.ok).toBe(false);
    expect(requested).toHaveLength(1);
  });

  it("REFUSES a redirect to a private network address", async () => {
    for (const target of [
      "http://10.0.0.5/",
      "http://192.168.1.1/",
      "http://172.16.0.1/",
      "http://[::1]/",
    ]) {
      const { requested } = fakeNet({
        "https://attacker.example/": { status: 302, location: target },
      });
      const r = await safeFetch("https://attacker.example/");
      expect(r.ok, target).toBe(false);
      expect(requested, target).toHaveLength(1);
      vi.unstubAllGlobals();
    }
  });

  it("REFUSES a redirect that switches protocol", async () => {
    const { requested } = fakeNet({
      "https://attacker.example/": { status: 302, location: "file:///etc/passwd" },
    });
    const r = await safeFetch("https://attacker.example/");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("not an http(s) URL");
    expect(requested).toHaveLength(1);
  });

  it("REFUSES a redirect to a non-web port", async () => {
    const { requested } = fakeNet({
      "https://attacker.example/": { status: 302, location: "http://example.com:6379/" },
    });
    expect((await safeFetch("https://attacker.example/")).ok).toBe(false);
    expect(requested).toHaveLength(1);
  });

  it("catches it on the SECOND hop too, not just the first", async () => {
    // A chain that looks innocent for a while. Every hop is judged the same.
    const { requested } = fakeNet({
      "https://a.example/": { status: 302, location: "https://b.example/" },
      "https://b.example/": { status: 302, location: "https://c.example/" },
      "https://c.example/": { status: 302, location: "http://169.254.169.254/" },
    });
    const r = await safeFetch("https://a.example/");
    expect(r.ok).toBe(false);
    expect(requested).toEqual([
      "https://a.example/",
      "https://b.example/",
      "https://c.example/",
    ]);
  });
});

describe("it still fetches real websites", () => {
  it("returns the response when there is no redirect", async () => {
    fakeNet({ "https://byrneplumbing.ie/": { status: 200, body: "<html>hi</html>" } });
    const r = await safeFetch("https://byrneplumbing.ie/");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(await r.response.text()).toBe("<html>hi</html>");
    expect(r.hops).toBe(0);
    expect(r.url).toBe("https://byrneplumbing.ie/");
  });

  it("follows the http -> https -> www shuffle a real site does", async () => {
    const { requested } = fakeNet({
      "http://byrneplumbing.ie/": { status: 301, location: "https://byrneplumbing.ie/" },
      "https://byrneplumbing.ie/": { status: 301, location: "https://www.byrneplumbing.ie/" },
      "https://www.byrneplumbing.ie/": { status: 200, body: "<html>real</html>" },
    });
    const r = await safeFetch("http://byrneplumbing.ie/");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.hops).toBe(2);
    // The FINAL url, which is what the SEO report shows as the page audited.
    expect(r.url).toBe("https://www.byrneplumbing.ie/");
    expect(requested).toHaveLength(3);
  });

  it("resolves a relative Location, which is legal and common", async () => {
    const { requested } = fakeNet({
      "https://byrneplumbing.ie/old": { status: 302, location: "/new" },
      "https://byrneplumbing.ie/new": { status: 200, body: "moved" },
    });
    const r = await safeFetch("https://byrneplumbing.ie/old");
    expect(r.ok).toBe(true);
    expect(requested[1]).toBe("https://byrneplumbing.ie/new");
  });

  it("passes the caller's headers through on every hop", async () => {
    const { impl } = fakeNet({
      "https://a.example/": { status: 302, location: "https://b.example/" },
      "https://b.example/": { status: 200 },
    });
    await safeFetch("https://a.example/", { headers: { "user-agent": "Chrome" } });
    for (const call of impl.mock.calls) {
      const init = call[1] as RequestInit;
      expect(init).toBeTruthy();
      expect((init.headers as Record<string, string>)["user-agent"]).toBe("Chrome");
      // And redirects are always manual — this is the whole point.
      expect(init.redirect).toBe("manual");
    }
  });

  it("returns a 404 rather than treating it as a redirect", async () => {
    fakeNet({ "https://byrneplumbing.ie/": { status: 404, body: "nope" } });
    const r = await safeFetch("https://byrneplumbing.ie/");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.response.status).toBe(404);
  });
});

describe("it cannot be made to spin", () => {
  it("stops on a redirect loop", async () => {
    const { requested } = fakeNet({
      "https://a.example/": { status: 302, location: "https://b.example/" },
      "https://b.example/": { status: 302, location: "https://a.example/" },
    });
    const r = await safeFetch("https://a.example/");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("redirect loop");
    expect(requested.length).toBeLessThanOrEqual(3);
  });

  it("stops after the hop limit on a long chain", async () => {
    const routes: Record<string, { status: number; location: string }> = {};
    for (let i = 0; i < 50; i += 1) {
      routes[`https://h${i}.example/`] = { status: 302, location: `https://h${i + 1}.example/` };
    }
    const { requested } = fakeNet(routes);
    const r = await safeFetch("https://h0.example/");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("more than");
    expect(requested.length).toBeLessThanOrEqual(MAX_REDIRECTS + 1);
  });

  it("refuses before the first request when the entry URL is private", async () => {
    const { requested } = fakeNet({});
    const r = await safeFetch("http://169.254.169.254/");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("not a public website");
    // Nothing was requested at all.
    expect(requested).toEqual([]);
  });

  it("refuses an unparseable URL without throwing", async () => {
    fakeNet({});
    expect((await safeFetch("not a url")).ok).toBe(false);
  });
});

describe("the guard itself still says what it said", () => {
  const allow = (h: string) => isPublicWebHost(new URL(`https://${h}/`));

  it("allows ordinary websites", () => {
    for (const h of ["example.com", "byrneplumbing.ie", "g.page", "www.google.com"]) {
      expect(allow(h), h).toBe(true);
    }
  });

  it("blocks everything inward-facing", () => {
    for (const h of [
      "localhost", "foo.localhost", "printer.local", "db.internal", "nas.lan",
      "127.0.0.1", "10.0.0.1", "192.168.0.1", "172.16.0.1", "169.254.169.254",
      "100.64.0.1", "0.0.0.0", "224.0.0.1", "[::1]", "intranet",
    ]) {
      expect(allow(h), h).toBe(false);
    }
  });

  it("normalises shorthand IPv4 before judging it", () => {
    // "127.1" is a valid shorthand for 127.0.0.1. The WHATWG URL parser
    // expands it, so the dotted-quad branch catches it — verified, not
    // assumed, because if the parser did NOT normalise it the domain regex
    // would have let it through.
    expect(new URL("http://127.1/").hostname).toBe("127.0.0.1");
    expect(allow("127.1")).toBe(false);
    expect(allow("10.1")).toBe(false);
  });

  it("blocks non-web ports", () => {
    expect(isPublicWebHost(new URL("http://example.com:6379/"))).toBe(false);
    expect(isPublicWebHost(new URL("https://example.com:443/"))).toBe(true);
  });
});

describe("every user-supplied fetch goes through it", () => {
  const RESEARCH = readFileSync(path.join(ROOT, "lib", "growth", "research.ts"), "utf8");
  const AUDIT = readFileSync(path.join(ROOT, "lib", "seo", "audit.ts"), "utf8");

  it("the prospect website read uses safeFetch", () => {
    expect(RESEARCH).toContain("await safeFetch(target,");
    expect(RESEARCH).not.toMatch(/await fetch\(target/);
  });

  it("the SEO auditor uses safeFetch for the page AND for robots/sitemap", () => {
    expect(AUDIT).not.toMatch(/await fetch\(target/);
    expect((AUDIT.match(/safeFetch\(target/g) ?? []).length).toBe(2);
  });

  it("no user-facing fetch delegates redirects to fetch any more", () => {
    for (const [name, src] of [
      ["research", RESEARCH],
      ["audit", AUDIT],
    ] as const) {
      // Only comments may mention it.
      const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      expect(code, name).not.toContain('redirect: "follow"');
    }
  });

  it("the SEO report names the URL actually audited, not the one submitted", () => {
    // res.url is empty under manual redirects — reporting the submitted URL
    // when the site redirected elsewhere would misstate what was checked.
    expect(AUDIT).toContain("finalUrl: attempt.url || res.url || target");
  });
});
