import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { computeGrowthMetrics, type GrowthData } from "./metrics";

/**
 * "Reply rate" counted out-of-office bounces as replies.
 *
 * lib/growth/metrics.ts is the shared source — its own docstring says so: "one
 * pass … producing every number the dashboard, analytics, campaign and report
 * screens show, so 'reply rate' can never mean two different things on two
 * different screens." It feeds the dashboard, analytics, the campaigns list,
 * the CSV exports, Jarvis's stats and the morning brief's stats.
 *
 * And it counted raw inbound:
 *
 *     const inbound = wMessages.filter((m) => m.direction === "inbound");
 *     …
 *     replies: inbound.length,
 *     replyRate: pct([...repliedIds].filter(id => contactedIds.has(id)).length, …)
 *
 * Every other surface had already been fixed one at a time — the awaiting count
 * (#548), the brief's reply list (#552), the inbox (#592), Jarvis's chat (#595)
 * — each classifying locally. This was the one underneath all of them, so the
 * headline metric and every per-campaign, per-industry and per-tone rate under
 * it were still computed over bounces.
 *
 * It is not evenly-spread noise. Auto-responders fire at the addresses that
 * were emailed most recently, which is exactly the campaign and the tone being
 * judged — so it inflates the row you are about to act on, and "best performing
 * style" gets copied into every future message.
 *
 * Replayed over one realistic Irish August week (below):
 *
 *   sixteen leads emailed, sixteen "replies" — two of them people
 *
 *                     OLD    NEW
 *     replies          16      2   (+ 14 reported as autoReplies)
 *     reply rate      100%    13%
 *     "warm" tone     100%    13%   ← the style copied into every message
 *     Roofing replies   8      0   ← "top-performing industry"
 *
 * The auto-replies are not hidden — `autoReplies` reports them.
 *
 * FAILS OPEN by design: an inbound row with no matching detail entry counts as
 * human. If the extra load ever comes back short, the numbers degrade to what
 * they were before this change rather than collapsing the engine's headline
 * metric to zero and looking like every prospect went quiet.
 */

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const SRC = readFileSync(path.join(ROOT, "lib", "growth", "metrics.ts"), "utf8");

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.now();
const iso = (daysAgo: number) => new Date(NOW - daysAgo * DAY).toISOString();

const OOO = "I am on annual leave and will return on 12 August. For urgent matters contact the office.";
const STOP = "Please unsubscribe me and remove my details.";
const REAL = "Interesting — what would this cost for 6 vans?";

/** 16 leads emailed; 12 holiday bounces, 2 opt-outs, 2 real replies. */
const COMPANIES = Array.from({ length: 16 }, (_, i) => `p${i}`);

const prospects: GrowthData["prospects"] = COMPANIES.map((id, i) => ({
  id,
  status: "contacted",
  industry: i < 8 ? "Roofing" : "Plumbing",
  campaign_id: "c1",
  pipeline_value: null,
  qualification_status: null,
  created_at: iso(20),
}));

/** Every lead got a "warm" first touch three days ago. */
const sends: GrowthData["messages"] = COMPANIES.map((id) => ({
  prospect_id: id,
  campaign_id: "c1",
  channel: "email",
  direction: "outbound",
  status: "sent",
  sentiment: null,
  tone: "warm",
  created_at: iso(3),
  sent_at: iso(3),
}));

/** All sixteen "answered". Two of those were people. */
const REPLIERS: [string, string][] = [
  ...COMPANIES.slice(0, 12).map((id) => [id, OOO] as [string, string]),
  [COMPANIES[12], STOP],
  [COMPANIES[13], STOP],
  [COMPANIES[14], REAL],
  [COMPANIES[15], "Can you do a demo Thursday morning?"],
];

const inbound: GrowthData["messages"] = REPLIERS.map(([id]) => ({
  prospect_id: id,
  campaign_id: "c1",
  channel: "email",
  direction: "inbound",
  status: "received",
  sentiment: "neutral",
  tone: null,
  created_at: iso(1),
  sent_at: null,
}));

const data: GrowthData = {
  prospects,
  messages: [...sends, ...inbound],
  inboundDetail: REPLIERS.map(([id, body]) => ({
    prospect_id: id,
    created_at: iso(1),
    subject: body === OOO ? "Out of office" : "Re: quick question",
    body,
  })),
  meetings: [],
  campaigns: [{ id: "c1", name: "Roofers & plumbers", status: "active" }],
  research: [],
  proposals: [],
};

/** The same data as it looked BEFORE: no detail rows, so everything is human. */
const asItWas: GrowthData = { ...data, inboundDetail: [] };

const now = computeGrowthMetrics(data, 7);
const old = computeGrowthMetrics(asItWas, 7);

describe("one realistic Irish August week", () => {
  it("sixteen leads, sixteen 'replies' — two of them people", () => {
    expect(old.replies).toBe(16);
    expect(now.replies).toBe(2);
    expect(now.autoReplies).toBe(14);
    expect(now.replies + now.autoReplies).toBe(old.replies);
  });

  it("the headline reply rate read 100%, and is 13%", () => {
    expect(old.replyRate).toBe(100);
    expect(now.replyRate).toBe(13);
  });

  it("the tone table crowned a style off twelve bounces", () => {
    // "Best performing outreach style" is the row that gets copied into every
    // future message, so a fake 100% is the most expensive number on the page.
    const oldWarm = old.toneStats.find((t) => t.tone === "warm")!;
    const newWarm = now.toneStats.find((t) => t.tone === "warm")!;
    expect(oldWarm.replyRate).toBe(100);
    expect(newWarm.replyRate).toBe(13);
    expect(newWarm.sent).toBe(oldWarm.sent); // the denominator didn't move
  });

  it("and 'top-performing industries' picked the one with the most holidays", () => {
    const oldRoofing = old.topIndustries.find((i) => i.industry === "Roofing")!;
    const newRoofing = now.topIndustries.find((i) => i.industry === "Roofing")!;
    expect(oldRoofing.replies).toBe(8);
    expect(newRoofing.replies).toBe(0);
    expect(newRoofing.sent).toBe(oldRoofing.sent);
  });

  it("the campaign funnel counted them too", () => {
    expect(old.topCampaigns[0].replies).toBe(16);
    expect(now.topCampaigns[0].replies).toBe(2);
    expect(now.topCampaigns[0].sent).toBe(old.topCampaigns[0].sent);
  });

  it("'prospects who replied' counted everyone the bounce came from", () => {
    // repliedProspects is the distinct-people figure behind the rate, so it
    // carried the same error — sixteen leads on holiday read as sixteen
    // conversations started.
    expect(old.repliedProspects).toBe(16);
    expect(now.repliedProspects).toBe(2);
  });
});

describe("nothing is hidden, and nothing else moved", () => {
  it("the auto-replies are reported, not discarded", () => {
    expect(now.autoReplies).toBe(14);
    expect(SRC).toContain("autoReplies,");
    expect(SRC).toContain("/** Inbound in the window that was an auto-reply or an opt-out, not a person. */");
  });

  it("every non-reply metric is byte-identical", () => {
    for (const k of [
      "leadsAdded", "prospectsTotal", "contacted", "outreachSent",
      "meetingsBooked", "pipelineValue", "qualified", "won",
      "queuedOutreach", "draftOutreach", "companiesResearched", "proposalsSent",
    ] as const) {
      expect(now[k], k).toEqual(old[k]);
    }
    expect(now.outreachByChannel).toEqual(old.outreachByChannel);
  });

  it("a week of only real replies is unchanged by the filter", () => {
    const clean: GrowthData = {
      ...data,
      inboundDetail: data.inboundDetail.map((d) => ({
        ...d,
        subject: "Re: quick question",
        body: REAL,
      })),
    };
    expect(computeGrowthMetrics(clean, 7)).toEqual(computeGrowthMetrics(asItWas, 7));
  });
});

describe("it fails OPEN", () => {
  it("no detail rows at all → today's behaviour, not zero replies", () => {
    // The failure mode that matters: a short load must not make the engine
    // look like every prospect went silent.
    expect(computeGrowthMetrics(asItWas, 7).replies).toBe(16);
    expect(computeGrowthMetrics(asItWas, 7).replies).not.toBe(0);
  });

  it("a partially short load only classifies what it can see", () => {
    const partial: GrowthData = { ...data, inboundDetail: data.inboundDetail.slice(0, 6) };
    const m = computeGrowthMetrics(partial, 7);
    expect(m.replies).toBe(10); // 6 seen and classified as bounces, 10 unseen → counted
    expect(m.replies).toBeGreaterThan(now.replies);
    expect(m.replies).toBeLessThan(old.replies);
  });

  it("the fail-open rule is stated where it is enforced", () => {
    expect(SRC).toContain("FAILS OPEN, deliberately");
    expect(SRC).toContain("humanInboundKeys.has(key) || !detailKeys.has(key)");
  });
});

describe("the load that makes it possible stays cheap", () => {
  it("subject and body are fetched on their own, inbound only", () => {
    expect(SRC).toContain('.select("prospect_id, created_at, subject, body")');
    expect(SRC).toContain('.eq("direction", "inbound")');
  });

  it("they are NOT added to the every-row messages select", () => {
    // 10,000-character bodies on every row would go through the dashboard,
    // Jarvis and the 07:00 brief to classify the few per cent that are inbound.
    expect(SRC).toContain(
      '.select("prospect_id, campaign_id, channel, direction, status, sentiment, tone, created_at, sent_at")'
    );
  });

  it("it honours the same window floor, in the same one wave", () => {
    expect((SRC.match(/await Promise\.all\(\[/g) ?? [])).toHaveLength(1);
    const wave = SRC.slice(SRC.indexOf("await Promise.all(["), SRC.indexOf("return { prospects, messages, inboundDetail"));
    expect(wave).toContain("sinceIso ? q.gte(\"created_at\", sinceIso) : q");
  });

  it("it uses the shared classifier, not another copy of the rule", () => {
    expect(SRC).toContain('import { isHumanReply } from "@/lib/growth/awaiting";');
  });
});

describe("the tone table's 'replied' uses the same rule", () => {
  it("an auto-responder does not make a tone convert", () => {
    // The lookup that decides "did this send get an answer" is built from raw
    // inbound; without filtering it too, the tone rate stays wrong even though
    // the reply COUNT is right.
    expect(SRC).toContain("if (!isHumanRow(m)) continue;");
    const warm = now.toneStats.find((t) => t.tone === "warm")!;
    expect(warm.replied).toBe(2);
  });
});
