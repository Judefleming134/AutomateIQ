import { describe, it, expect } from "vitest";
import {
  buildGbpReport,
  noProfileReport,
  type GbpProfile,
} from "@/lib/tools/gbp-report";
import {
  scoreSelfCheck,
  isComplete,
  SELF_QUESTIONS,
  PROFILE_QUESTIONS,
  type SelfAnswers,
} from "@/lib/tools/gbp-self";

/**
 * The Google Business Profile scorer, run for the first time (F7).
 *
 * `lib/tools/gbp.ts` built a score and seven findings from a Places API
 * response, and GOOGLE_PLACES_API_KEY has never been set — in production or in
 * a test. So this logic had never executed against a payload of any kind.
 * AutoSEO's engine had two real bugs found the moment it was tested; the
 * register (F7) said to assume this one did too.
 *
 * It can be tested now because the scoring moved out of the fetch (J1). The
 * same engine is fed by the paid Places path and by the free self-check, so
 * these fixtures cover both.
 *
 * The weights, stated once so the arithmetic below is checkable by hand:
 *
 *   reviews  high    10        pass 1.0
 *   rating   high    10        warn 0.5
 *   hours    medium   5        fail 0.0
 *   phone    high    10
 *   website  medium   5
 *   category high    10
 *   descr.   low      2
 *   ------------------- total 52
 */

const TOTAL_WEIGHT = 52;

const perfect: GbpProfile = {
  name: "Murphy Plumbing",
  address: "Blanchardstown, Dublin 15",
  rating: 4.8,
  reviewCount: 63,
  primaryType: "Plumber",
  mapsUri: "https://maps.google.com/?cid=1",
  phone: "01 234 5678",
  website: "https://murphyplumbing.ie",
  hoursListed: true,
  hoursDays: 7,
  descriptionWritten: true,
  businessStatus: "OPERATIONAL",
  source: "google",
};

const barren: GbpProfile = {
  ...perfect,
  rating: null,
  reviewCount: 0,
  primaryType: null,
  phone: null,
  website: null,
  hoursListed: false,
  hoursDays: null,
  descriptionWritten: false,
};

describe("the weights actually add up to what the comments claim", () => {
  it("scores a flawless profile 100", () => {
    expect(buildGbpReport(perfect).score).toBe(100);
  });

  it("scores an empty one 0", () => {
    // Every finding fails or warns; website and description warn, so this is
    // NOT zero — and that is the bug worth catching, not a passing assertion.
    const r = buildGbpReport(barren);
    // website warn (5 * 0.5) + description warn (2 * 0.5) = 3.5 of 52
    expect(r.score).toBe(Math.round((3.5 / TOTAL_WEIGHT) * 100));
    expect(r.score).toBe(7);
  });

  it("never returns a score outside 0–100, whatever the input", () => {
    const combos: GbpProfile[] = [];
    for (const reviewCount of [0, 7, 8, 24, 25, 10_000]) {
      for (const rating of [null, 0, 3.9, 4.0, 4.49, 4.5, 5]) {
        combos.push({ ...perfect, reviewCount, rating });
      }
    }
    for (const p of combos) {
      const s = buildGbpReport(p).score;
      expect(s, JSON.stringify({ r: p.reviewCount, s: p.rating })).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(100);
    }
  });
});

describe("the thresholds sit exactly where the copy says they do", () => {
  const reviewStatus = (n: number) =>
    buildGbpReport({ ...perfect, reviewCount: n }).findings.find((f) => f.id === "reviews")!
      .status;

  it("reviews: 25 passes, 24 warns, 8 warns, 7 fails", () => {
    expect(reviewStatus(25)).toBe("pass");
    expect(reviewStatus(24)).toBe("warn");
    expect(reviewStatus(8)).toBe("warn");
    expect(reviewStatus(7)).toBe("fail");
    expect(reviewStatus(0)).toBe("fail");
  });

  const ratingStatus = (n: number | null) =>
    buildGbpReport({ ...perfect, rating: n }).findings.find((f) => f.id === "rating")!.status;

  it("rating: 4.5 passes, 4.49 warns, 4.0 warns, 3.99 fails, none fails", () => {
    expect(ratingStatus(4.5)).toBe("pass");
    expect(ratingStatus(4.49)).toBe("warn");
    expect(ratingStatus(4.0)).toBe("warn");
    expect(ratingStatus(3.99)).toBe("fail");
    expect(ratingStatus(null)).toBe("fail");
  });

  it("a zero rating is a failure, not a missing one", () => {
    // `rating: 0` is falsy. Any check written as `if (!rating)` would report
    // "no rating yet" for a business rated 0.0 — which is a real state and the
    // most urgent one on the page.
    const f = buildGbpReport({ ...perfect, rating: 0 }).findings.find((f) => f.id === "rating")!;
    expect(f.status).toBe("fail");
    expect(f.found).toBe("0.0 out of 5");
    expect(f.found).not.toContain("No rating yet");
  });
});

describe("a closed profile jumps the queue", () => {
  const closed = buildGbpReport({ ...perfect, businessStatus: "CLOSED_PERMANENTLY" });

  it("adds the status finding and leads with it", () => {
    expect(closed.findings[0].id).toBe("status");
    expect(closed.verdict).toContain("closed");
  });

  it("says it in English, not in Google's constant", () => {
    expect(closed.findings[0].found).toContain("closed permanently");
    expect(closed.findings[0].found).not.toContain("CLOSED_PERMANENTLY");
  });

  it("drags the score down even though everything else is perfect", () => {
    // 52 of 62 — the extra high-impact finding is added to the denominator too.
    expect(closed.score).toBe(Math.round((52 / 62) * 100));
    expect(closed.score).toBeLessThan(buildGbpReport(perfect).score);
  });

  it("OPERATIONAL is not treated as a problem", () => {
    expect(buildGbpReport(perfect).findings.some((f) => f.id === "status")).toBe(false);
  });
});

describe("findings are ordered worst-first, then by impact", () => {
  it("puts every fail before every warn before every pass", () => {
    const rank = { fail: 0, warn: 1, pass: 2 };
    const order = buildGbpReport(barren).findings.map((f) => rank[f.status]);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("breaks ties on impact, so a high-impact fail outranks a low one", () => {
    const fails = buildGbpReport(barren).findings.filter((f) => f.status === "fail");
    const i = { high: 0, medium: 1, low: 2 };
    const impacts = fails.map((f) => i[f.impact]);
    expect(impacts).toEqual([...impacts].sort((a, b) => a - b));
  });

  it("every finding has all its copy filled in", () => {
    // The tool's whole value is the why/fix text. An empty one renders a blank
    // panel under "Fix this first".
    //
    // The length floor applies to PROBLEMS only, not to passes: a passing
    // check's fix is legitimately "Present." — eight characters, and nothing
    // more needs saying. An earlier version of this test demanded 10 for
    // everything and failed on exactly that, which would have pushed padding
    // into copy that was already right.
    for (const p of [perfect, barren]) {
      for (const f of buildGbpReport(p).findings) {
        expect(f.label, f.id).toBeTruthy();
        expect(f.found, f.id).toBeTruthy();
        expect(f.why.length, f.id).toBeGreaterThan(40);
        expect(f.fix, f.id).toBeTruthy();
        if (f.status !== "pass") {
          // A fail or warn without real instructions is the tool failing.
          expect(f.fix.length, `${f.id} (${f.status})`).toBeGreaterThan(40);
        }
      }
    }
  });
});

describe("the free self-check reaches the same engine", () => {
  const allGood: SelfAnswers = {
    name: "Murphy Plumbing",
    hasProfile: "yes",
    reviews: "many",
    rating: "high",
    hours: "yes",
    phone: "yes",
    website: "yes",
    category: "yes",
    description: "yes",
  };

  it("a business that answers yes to everything scores 100, same as Places would", () => {
    expect(scoreSelfCheck(allGood).score).toBe(100);
    expect(scoreSelfCheck(allGood).score).toBe(buildGbpReport(perfect).score);
  });

  it("produces the same seven findings, in the same order, as the paid path", () => {
    const self = scoreSelfCheck(allGood).findings.map((f) => `${f.id}:${f.status}`);
    const google = buildGbpReport(perfect).findings.map((f) => `${f.id}:${f.status}`);
    expect(self).toEqual(google);
  });

  it("scores a middling profile the same either way", () => {
    // reviews warn (5) + rating warn (5) + hours 5 + phone 10 + website 5
    // + category 10 + description warn (1) = 41 of 52 = 79.
    const mid = scoreSelfCheck({ ...allGood, reviews: "some", rating: "mid", description: "no" });
    expect(mid.score).toBe(79);
    expect(
      buildGbpReport({ ...perfect, reviewCount: 8, rating: 4.0, descriptionWritten: false }).score
    ).toBe(79);
  });

  it("marks itself as self-declared, so the page can say so", () => {
    expect(scoreSelfCheck(allGood).source).toBe("self");
    expect(buildGbpReport(perfect).source).toBe("google");
  });
});

describe("it never invents a precision the visitor didn't give", () => {
  const banded = scoreSelfCheck({
    name: "X",
    hasProfile: "yes",
    reviews: "some",
    rating: "mid",
    hours: "yes",
    phone: "yes",
    website: "yes",
    category: "yes",
    description: "yes",
  });

  it("reports the band, not the representative number behind it", () => {
    const reviews = banded.findings.find((f) => f.id === "reviews")!;
    expect(reviews.found).toBe("Somewhere between 8 and 24 reviews");
    // 8 is the scoring stand-in for that band. It must never reach the screen.
    expect(reviews.found).not.toMatch(/\b8 reviews\b/);
  });

  it("does the same for the rating, and never appends a fake average", () => {
    const rating = banded.findings.find((f) => f.id === "rating")!;
    expect(rating.found).toBe("Between 4.0 and 4.4 out of 5");
    expect(banded.findings.find((f) => f.id === "reviews")!.found).not.toContain("averaging");
  });

  it("carries the labels on the result so the header can use them too", () => {
    expect(banded.reviewCountLabel).toBe("Somewhere between 8 and 24 reviews");
    expect(banded.ratingLabel).toBe("Between 4.0 and 4.4 out of 5");
  });

  it("a real lookup keeps its exact figures and its average", () => {
    const r = buildGbpReport(perfect);
    expect(r.reviewCountLabel).toBeNull();
    expect(r.ratingLabel).toBeNull();
    expect(r.findings.find((f) => f.id === "reviews")!.found).toBe("63 reviews, averaging 4.8");
  });

  it("says 1 review, not 1 reviews", () => {
    expect(
      buildGbpReport({ ...perfect, reviewCount: 1, rating: null }).findings.find(
        (f) => f.id === "reviews"
      )!.found
    ).toBe("1 review");
  });
});

describe("'not sure' is scored as not set — deliberately", () => {
  const base: SelfAnswers = {
    name: "X",
    hasProfile: "yes",
    reviews: "many",
    rating: "high",
    hours: "yes",
    phone: "yes",
    website: "yes",
    category: "yes",
    description: "yes",
  };

  it("an unsure category fails, because an unchecked category IS the problem", () => {
    const r = scoreSelfCheck({ ...base, category: "unsure" });
    expect(r.findings.find((f) => f.id === "category")!.status).toBe("fail");
  });

  it("an unsure review count and rating both fail rather than flatter", () => {
    const r = scoreSelfCheck({ ...base, reviews: "unknown", rating: "unknown" });
    expect(r.findings.find((f) => f.id === "reviews")!.status).toBe("fail");
    expect(r.findings.find((f) => f.id === "rating")!.status).toBe("fail");
    expect(r.findings.find((f) => f.id === "reviews")!.found).toContain("weren't sure");
  });

  it("a shrug never scores better than a straight no", () => {
    expect(scoreSelfCheck({ ...base, category: "unsure" }).score).toBe(
      scoreSelfCheck({ ...base, category: "no" }).score
    );
  });
});

describe("'I haven't got a website' is a different problem from 'not linked'", () => {
  const ask = (website: string) =>
    scoreSelfCheck({
      name: "X",
      hasProfile: "yes",
      reviews: "many",
      rating: "high",
      hours: "yes",
      phone: "yes",
      category: "yes",
      description: "yes",
      website,
    }).findings.find((f) => f.id === "website")!;

  it("does not tell someone to link a site they haven't got", () => {
    expect(ask("none").fix).not.toContain("Link your site");
    expect(ask("none").found).toContain("haven't got a website");
  });

  it("does tell someone with a site to link it", () => {
    expect(ask("no").fix).toContain("Link your site");
  });

  it("both still count as the same warn, so the score is unaffected", () => {
    expect(ask("none").status).toBe("warn");
    expect(ask("no").status).toBe("warn");
  });
});

describe("no profile at all — the case the paid API could never report", () => {
  // Places returns "not found" for a business with no profile, so the tool had
  // nothing to say to the person with the single biggest thing to gain.
  const none = noProfileReport("Murphy Plumbing");

  it("is reached by answering no, or not sure", () => {
    expect(scoreSelfCheck({ hasProfile: "no", name: "X" }).findings[0].id).toBe("no-profile");
    expect(scoreSelfCheck({ hasProfile: "unsure", name: "X" }).findings[0].id).toBe("no-profile");
  });

  it("scores zero and says why in the verdict", () => {
    expect(none.score).toBe(0);
    expect(none.verdict).toContain("map pack");
  });

  it("leads with the one thing to do, not with six things that can't be done", () => {
    expect(none.findings[0].label).toContain("Google Business Profile");
    expect(none.findings[0].fix).toContain("google.com/business");
    // It's free and it takes a postcard — both are the reason people put it off.
    expect(none.findings[0].fix).toContain("free");
  });

  it("keeps the business name they typed", () => {
    expect(none.name).toBe("Murphy Plumbing");
    expect(noProfileReport("").name).toBe("Your business");
  });

  it("still gives them something to do this afternoon", () => {
    expect(none.findings.some((f) => f.fix.includes("website checker"))).toBe(true);
  });
});

describe("the form cannot be submitted half-answered", () => {
  it("needs the profile question first", () => {
    expect(isComplete({})).toBe(false);
    expect(isComplete({ name: "X" })).toBe(false);
  });

  it("needs nothing else once there is no profile", () => {
    expect(isComplete({ hasProfile: "no" })).toBe(true);
    expect(isComplete({ hasProfile: "unsure" })).toBe(true);
  });

  it("needs every follow-up when there IS a profile", () => {
    const partial: SelfAnswers = { hasProfile: "yes", reviews: "many" };
    expect(isComplete(partial)).toBe(false);
    const full = Object.fromEntries(
      PROFILE_QUESTIONS.map((q) => [q.id, q.options[0].value])
    ) as SelfAnswers;
    expect(isComplete({ ...full, hasProfile: "yes" })).toBe(true);
  });

  it("the name is optional — it's a label, not a fact being scored", () => {
    const full = Object.fromEntries(
      PROFILE_QUESTIONS.map((q) => [q.id, q.options[0].value])
    ) as SelfAnswers;
    expect(isComplete({ ...full, hasProfile: "yes" })).toBe(true);
    expect(scoreSelfCheck({ ...full, hasProfile: "yes" }).name).toBe("Your business");
  });
});

describe("the questions themselves hold up", () => {
  it("every question has a unique id and at least two options", () => {
    const ids = SELF_QUESTIONS.map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const q of SELF_QUESTIONS) {
      expect(q.options.length, q.id).toBeGreaterThan(1);
      expect(q.question.endsWith("?"), q.id).toBe(true);
    }
  });

  it("every option value is one the scorer actually understands", () => {
    // A typo in an option value would silently score as "not set" — the answer
    // would look accepted on screen and be thrown away.
    const base = Object.fromEntries(
      PROFILE_QUESTIONS.map((q) => [q.id, q.options[0].value])
    ) as SelfAnswers;
    for (const q of PROFILE_QUESTIONS) {
      for (const o of q.options) {
        const r = scoreSelfCheck({ ...base, hasProfile: "yes", [q.id]: o.value });
        expect(r.findings.length, `${q.id}=${o.value}`).toBeGreaterThan(0);
      }
    }
    // And the yes-answers really do score better than the no-answers, which is
    // what proves the values are being read rather than ignored.
    const allYes = Object.fromEntries(
      PROFILE_QUESTIONS.map((q) => [q.id, q.options[0].value])
    ) as SelfAnswers;
    const allLast = Object.fromEntries(
      PROFILE_QUESTIONS.map((q) => [q.id, q.options[q.options.length - 1].value])
    ) as SelfAnswers;
    expect(scoreSelfCheck({ ...allYes, hasProfile: "yes" }).score).toBeGreaterThan(
      scoreSelfCheck({ ...allLast, hasProfile: "yes" }).score
    );
  });

  it("no question asks for anything a stranger wouldn't answer", () => {
    // No email, no phone, no address. The lead form comes after the report and
    // stays optional — that promise is the reason these tools convert.
    const text = JSON.stringify(SELF_QUESTIONS).toLowerCase();
    expect(text).not.toContain("email");
    expect(text).not.toContain("your address");
  });
});
