import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { secretsMatch } from "./timing-safe";

/**
 * Four endpoints compared a shared secret with `===`.
 *
 * `secretsMatch` exists precisely for this, and its own doc comment says so:
 *
 *   "This codebase already treats that as the standard — lib/cron/auth.ts uses
 *    timingSafeEqual with a comment saying exactly why, and the Resend and
 *    Instagram webhooks both compare their HMACs with it. … Extracted here so
 *    the next endpoint has something to reach for rather than a choice to get
 *    wrong."
 *
 * It had exactly ONE caller. The endpoints that got it wrong:
 *
 *   voice/job-summary POST      provided === sharedSecret
 *   voice/job-summary GET       provided === sharedSecret / === signingSecret
 *   setup/bootstrap-admin       secret !== setupSecret
 *
 * The voice one is the sharpest: the SAME FILE verifies its ElevenLabs HMAC
 * with crypto.timingSafeEqual three lines below, so one request could be
 * checked two ways with two different standards depending on which credential
 * the caller presented. And both accept the secret from a query string on a
 * public URL — `?secret=` — which is the case the helper names.
 *
 * bootstrap-admin mints the FIRST admin on the platform. Its second gate (no
 * admin may already exist) makes it unreachable in production today, but a gate
 * that is currently redundant is not a reason to compare a secret byte-by-byte.
 *
 * Honest severity: a timing attack over HTTP is hard to land — network jitter
 * dwarfs the signal from a byte-wise compare. This is defence in depth on a
 * standard the codebase had already set for itself, not a live breach.
 */

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const read = (...p: string[]) => readFileSync(path.join(ROOT, ...p), "utf8");

const VOICE = read("app", "api", "voice", "job-summary", "route.ts");
const BOOTSTRAP = read("app", "api", "setup", "bootstrap-admin", "route.ts");
const CRON = read("lib", "cron", "auth.ts");
const INBOUND = read("app", "api", "webhooks", "inbound-email", "route.ts");

/** Source with comments stripped — these files explain the old behaviour. */
const code = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

describe("the helper itself", () => {
  it("matches an identical secret", () => {
    expect(secretsMatch("hunter2", "hunter2")).toBe(true);
  });

  it.each([
    ["a different secret", "hunter3", "hunter2"],
    ["a prefix", "hunter", "hunter2"],
    ["a longer guess", "hunter22", "hunter2"],
    ["empty against a real one", "", "hunter2"],
  ])("rejects %s", (_label, provided, expected) => {
    expect(secretsMatch(provided, expected)).toBe(false);
  });

  it("refuses when NO secret is configured, rather than matching empty", () => {
    // Otherwise an unset env var turns every caller into an authorised one.
    expect(secretsMatch("", "")).toBe(false);
    expect(secretsMatch("anything", "")).toBe(false);
  });

  it("survives a non-string being passed in", () => {
    expect(secretsMatch(undefined as unknown as string, "hunter2")).toBe(false);
  });
});

describe("no endpoint compares a shared secret with === any more", () => {
  it.each([
    ["voice/job-summary", () => VOICE],
    ["setup/bootstrap-admin", () => BOOTSTRAP],
  ])("%s", (_label, get) => {
    const src = code(get());
    expect(src).not.toMatch(/provided === (shared|signing)Secret/);
    expect(src).not.toMatch(/secret !== setupSecret/);
    expect(src).toContain("secretsMatch(");
  });

  it("the voice webhook uses it on BOTH the POST and the GET preflight", () => {
    expect(VOICE).toContain("Boolean(sharedSecret && secretsMatch(provided, sharedSecret))");
    expect(VOICE).toContain("!(sharedSecret && secretsMatch(provided, sharedSecret))");
    expect(VOICE).toContain("!(signingSecret && secretsMatch(provided, signingSecret))");
  });

  it("bootstrap-admin type-guards before comparing", () => {
    // body.secret is untrusted JSON — it could be a number or an object.
    expect(BOOTSTRAP).toContain('typeof secret !== "string" || !secretsMatch(secret, setupSecret)');
  });
});

describe("every other credential path was already right, and still is", () => {
  it("the cron secret is constant-time", () => {
    expect(CRON).toContain("timingSafeEqual");
    expect(CRON).toContain("if (a.length !== b.length) return false;");
  });

  it("the inbound-email webhook still uses the helper", () => {
    expect(INBOUND).toContain("secretsMatch(provided, secret)");
  });

  it("the ElevenLabs HMAC is still verified with timingSafeEqual", () => {
    // This is what made the shared-secret === so incongruous: same file, same
    // request, two standards.
    const fn = VOICE.slice(
      VOICE.indexOf("function verifyElevenLabsSignature"),
      VOICE.indexOf("export async function POST")
    );
    expect(fn).toContain("crypto.timingSafeEqual(");
  });

  it("the HMAC still rejects a stale timestamp", () => {
    // Replay protection, untouched.
    expect(VOICE).toContain("age > 1800");
  });
});

describe("nothing about who gets in changed", () => {
  it("the voice webhook still accepts EITHER the shared secret or the HMAC", () => {
    expect(VOICE).toContain("if (!sharedOk && !hmacOk) {");
  });

  it("it still 503s when neither secret is configured", () => {
    expect(VOICE).toContain('if (!sharedSecret && !signingSecret) {');
    expect(VOICE).toContain('{ error: "Not configured" }, { status: 503 }');
  });

  it("it still reads the secret from the header or the query string", () => {
    // NOT changed here: dropping ?secret= would break Jude's configured
    // ElevenLabs webhook. Logged for his decision, same as the inbound-email
    // one — a secret in a URL lands in access logs.
    expect(VOICE).toContain('request.headers.get("x-webhook-secret")');
    expect(VOICE).toContain('searchParams.get("secret")');
  });

  it("bootstrap-admin still refuses once an admin exists", () => {
    expect(BOOTSTRAP).toContain("An admin account already exists");
    expect(BOOTSTRAP).toContain('.eq("role", "admin")');
  });

  it("bootstrap-admin still 500s when SETUP_SECRET is unset", () => {
    expect(BOOTSTRAP).toContain('{ error: "SETUP_SECRET is not configured." }');
  });
});
