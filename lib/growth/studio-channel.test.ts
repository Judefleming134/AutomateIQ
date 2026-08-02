import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { cleanSocialUrl } from "@/lib/growth/research";

/**
 * The Message Studio opened on a channel the prospect could not be reached on.
 *
 * `defaultChannel` on the prospect workspace tested the RAW social column:
 * non-empty meant "this channel is available". Everything else on the page
 * disagreed — the "Send it here" links directly beneath the channel picker,
 * and the entire DM list, both resolve through `cleanSocialUrl`, which rejects
 * post links, share links, bare domains and anything that isn't a URL.
 *
 * A non-empty column is not the same as a profile you can send to.
 *
 * So a prospect with no email and `instagram.com/p/Cxyz/` in the column opened
 * the Studio on Instagram, had a DM drafted for them, and showed no Instagram
 * link underneath to send it to — while their phone number, the one channel
 * that did work, sat two choices down. The page contradicted itself, and it
 * steered AWAY from the reachable channel, which is the expensive half.
 *
 * Replayed over eight prospect shapes from an imported trades list: five of
 * the eight opened on an unreachable channel, and all five had a working
 * phone number going unused.
 */

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const PAGE = readFileSync(
  path.join(ROOT, "app", "growth", "(app)", "prospects", "[id]", "page.tsx"),
  "utf8"
);

type P = {
  email?: string | null;
  phone?: string | null;
  instagram_url?: string | null;
  facebook_url?: string | null;
  linkedin_url?: string | null;
};

/** The fixed rule, transcribed from the page. */
const resolveChannel = (p: P) =>
  p.email
    ? "email"
    : cleanSocialUrl(p.instagram_url ?? "")
      ? "instagram"
      : cleanSocialUrl(p.facebook_url ?? "")
        ? "facebook"
        : cleanSocialUrl(p.linkedin_url ?? "")
          ? "linkedin"
          : p.phone
            ? "call"
            : "sms";

/** The old rule, kept so the regression is expressible rather than described. */
const rawChannel = (p: P) =>
  p.email
    ? "email"
    : p.instagram_url
      ? "instagram"
      : p.facebook_url
        ? "facebook"
        : p.linkedin_url
          ? "linkedin"
          : p.phone
            ? "call"
            : "sms";

/** Can the chosen channel actually be used? */
function reachable(p: P, channel: string): boolean {
  if (channel === "email") return !!p.email;
  if (channel === "call" || channel === "sms") return !!p.phone;
  const col = (
    { instagram: "instagram_url", facebook: "facebook_url", linkedin: "linkedin_url" } as const
  )[channel as "instagram" | "facebook" | "linkedin"];
  return !!cleanSocialUrl((p[col] ?? "") as string);
}

/** The junk that genuinely turns up in these columns. */
const JUNK = [
  "https://www.instagram.com/p/Cxyz123/", // a post, not a profile
  "https://www.instagram.com/reel/Cabc/", // a reel
  "https://facebook.com/", //                a template's unfilled icon
  "https://www.facebook.com/sharer.php?u=x", // a share widget
  "n/a", //                                  not a URL at all
  "", //                                     empty
];

describe("junk in the column is not a usable channel", () => {
  it("cleanSocialUrl rejects every one of these", () => {
    for (const j of JUNK) expect(cleanSocialUrl(j), j).toBeNull();
  });

  it("a real profile link is still accepted", () => {
    expect(cleanSocialUrl("https://www.instagram.com/fitzland/")).toBeTruthy();
    expect(cleanSocialUrl("https://www.facebook.com/murphyplumbing")).toBeTruthy();
  });
});

describe("the Studio opens on something that can actually be used", () => {
  it.each(JUNK.filter(Boolean))(
    "falls through %s to the phone",
    (junk) => {
      const p: P = { phone: "086 111 1111", instagram_url: junk, facebook_url: junk };
      expect(resolveChannel(p)).toBe("call");
      expect(reachable(p, resolveChannel(p))).toBe(true);
      // And this is what it used to do.
      expect(rawChannel(p)).toBe("instagram");
      expect(reachable(p, rawChannel(p))).toBe(false);
    }
  );

  it("never opens on a channel it cannot reach, across the whole matrix", () => {
    const emails = [null, "info@x.ie"];
    const phones = [null, "086 111 1111"];
    const socials = [null, ...JUNK, "https://www.instagram.com/real/"];
    const before: P[] = [];
    const after: P[] = [];
    let cases = 0;
    for (const email of emails) {
      for (const phone of phones) {
        for (const ig of socials) {
          for (const fb of [null, "https://facebook.com/", "https://www.facebook.com/real"]) {
            const p: P = { email, phone, instagram_url: ig, facebook_url: fb };
            cases++;
            if (!reachable(p, rawChannel(p))) before.push(p);
            if (!reachable(p, resolveChannel(p))) after.push(p);
          }
        }
      }
    }
    expect(cases).toBeGreaterThan(50);
    expect(before.length, "the old rule should be broken in this matrix").toBeGreaterThan(0);
    // The ONLY unreachable outcome left must be a prospect with no contact
    // method at all — that falls to "sms" and is a data problem, not a
    // routing one. Asserting the shape, not just a smaller number: a count
    // that merely went down would also pass if the fix were half-applied.
    for (const p of after) {
      expect(p.email ?? null, JSON.stringify(p)).toBeNull();
      expect(p.phone ?? null, JSON.stringify(p)).toBeNull();
      expect(cleanSocialUrl(p.instagram_url ?? "")).toBeNull();
      expect(cleanSocialUrl(p.facebook_url ?? "")).toBeNull();
    }
  });

  it("a prospect with nothing at all still lands somewhere, not undefined", () => {
    expect(resolveChannel({})).toBe("sms");
  });
});

describe("the preferences that were already right are unchanged", () => {
  it("email still wins whenever there is one", () => {
    expect(
      resolveChannel({ email: "a@b.ie", phone: "086", instagram_url: "https://www.instagram.com/real/" })
    ).toBe("email");
  });

  it("a real Instagram still beats a real Facebook, which still beats LinkedIn", () => {
    expect(
      resolveChannel({
        instagram_url: "https://www.instagram.com/real/",
        facebook_url: "https://www.facebook.com/real",
        linkedin_url: "https://www.linkedin.com/company/real",
      })
    ).toBe("instagram");
    expect(
      resolveChannel({
        facebook_url: "https://www.facebook.com/real",
        linkedin_url: "https://www.linkedin.com/company/real",
      })
    ).toBe("facebook");
  });

  it("a real social still beats the phone — cold DMs are still the default", () => {
    expect(
      resolveChannel({ phone: "086 111 1111", instagram_url: "https://www.instagram.com/real/" })
    ).toBe("instagram");
  });
});

describe("the page is wired to the fixed rule", () => {
  it("resolves the three links ONCE and picks the channel from them", () => {
    expect(PAGE).toContain("const igLink = cleanSocialUrl(prospect.instagram_url ?? \"\")");
    expect(PAGE).toContain("const fbLink = cleanSocialUrl(prospect.facebook_url ?? \"\")");
    expect(PAGE).toContain("const liLink = cleanSocialUrl(prospect.linkedin_url ?? \"\")");
  });

  it("no longer tests the raw column", () => {
    // The bug in one line. Both the `? :` chain and any re-introduced truthy
    // check on the bare column.
    const from = PAGE.indexOf("const defaultChannel: Channel");
    expect(from, "defaultChannel moved").toBeGreaterThan(-1);
    const decl = PAGE.slice(from, PAGE.indexOf(";", PAGE.indexOf('"sms"', from)));
    expect(decl).not.toContain("prospect.instagram_url");
    expect(decl).not.toContain("prospect.facebook_url");
    expect(decl).not.toContain("prospect.linkedin_url");
    expect(decl).toContain("igLink");
  });

  it("the 'Send it here' row uses the SAME values, so they cannot drift", () => {
    // This is what made the contradiction visible on one screen: the picker
    // said Instagram and the links underneath offered none.
    expect(PAGE).toContain("const ig = igLink;");
    expect(PAGE).toContain("const fb = fbLink;");
    expect(PAGE).toContain("const li = liLink;");
  });

  it("email and phone are still read straight off the prospect", () => {
    // Only the social columns were ambiguous; nothing else changed.
    const from = PAGE.indexOf("const defaultChannel: Channel");
    const decl = PAGE.slice(from, PAGE.indexOf(";", PAGE.indexOf('"sms"', from)));
    expect(decl).toContain("prospect.email");
    expect(decl).toContain("prospect.phone");
  });

  it("the reply-logging select still falls back to the same channel", () => {
    // It shares defaultChannel, so it inherits the fix rather than needing one.
    expect(PAGE).toContain("defaultValue={lastInbound?.channel ?? defaultChannel}");
  });
});
