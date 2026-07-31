"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  ChevronDown,
  ClipboardCheck,
  Gauge,
  Sparkles,
  Timer,
  TrendingUp,
} from "lucide-react";

/**
 * Three-tier savings calculator + operations audit, modelled on the AutomateIQ
 * agent and system line-up.
 *
 *   Tier 1 — Quick estimate: 4 inputs, conservative industry assumptions, ±35%.
 *   Tier 2 — Detailed analysis: the customer's real numbers, ±15%.
 *   Tier 3 — Operations audit: everything above plus how the business actually
 *            runs today. Produces a personalised bottleneck report — each with
 *            the evidence, the annual cost, the objection we always hear, and
 *            the straight answer — before they've ever seen the dashboard.
 *
 * All figures are deliberately conservative — this is a credibility tool for
 * strategy calls, not a hype machine.
 */

type Industry = "trades" | "logistics" | "retail" | "services" | "other";

const INDUSTRIES: { key: Industry; label: string }[] = [
  { key: "trades", label: "Trades & field services" },
  { key: "logistics", label: "Logistics & delivery" },
  { key: "retail", label: "Retail & e-commerce" },
  { key: "services", label: "Professional services" },
  { key: "other", label: "Something else" },
];

// Conservative close-rate + default job value per industry.
const PRESET: Record<Industry, { close: number; job: number }> = {
  trades: { close: 0.45, job: 850 },
  logistics: { close: 0.35, job: 400 },
  retail: { close: 0.3, job: 120 },
  services: { close: 0.4, job: 1500 },
  other: { close: 0.35, job: 600 },
};

type Inputs = {
  industry: Industry;
  teamSize: number;
  jobValue: number;
  enquiries: number; // per week
  // Tier 2
  missedCalls: number;
  responseMins: number;
  adminHours: number;
  hourlyCost: number;
  quotesPerWeek: number;
  minsPerQuote: number;
  chasingHours: number;
  reviewCount: number;
  vehicles: number;
  // Tier 3 — how the business runs today
  tracking: "paper" | "sheets" | "crm" | "custom";
  doubleEntry: "rare" | "sometimes" | "constant";
  afterHours: "nobody" | "voicemail" | "oncall";
  quoteFollowUp: "rarely" | "sometimes" | "always";
  marketing: "none" | "occasional" | "regular";
  socialDms: "ignored" | "slow" | "ontop";
  noShows: number; // per month
  ownerEvenings: number; // owner admin h/week outside hours
  toolCount: number;
};

// Everything starts at its neutral minimum so the page opens with (almost)
// nothing pre-filled — the estimate builds live as the visitor's own numbers
// go up, instead of landing on a canned figure.
const DEFAULTS: Inputs = {
  industry: "trades",
  teamSize: 1,
  jobValue: 50,
  enquiries: 1,
  missedCalls: 0,
  responseMins: 5,
  adminHours: 0,
  hourlyCost: 15,
  quotesPerWeek: 0,
  minsPerQuote: 10,
  chasingHours: 0,
  reviewCount: 0,
  vehicles: 0,
  tracking: "crm",
  doubleEntry: "rare",
  afterHours: "oncall",
  quoteFollowUp: "always",
  marketing: "regular",
  socialDms: "ontop",
  noShows: 0,
  ownerEvenings: 0,
  toolCount: 1,
};

type Lever = { key: string; label: string; sub: string; value: number; accent: string };
type Result = {
  total: number;
  revenue: number;
  costs: number;
  hoursWeek: number;
  spreadPct: number;
  levers: Lever[];
};

function compute(i: Inputs, detailed: boolean): Result {
  const preset = PRESET[i.industry];
  const close = preset.close;
  const job = i.jobValue;
  const perYear = 52;
  const hourly = detailed ? i.hourlyCost : 28;

  const levers: Lever[] = [];
  const push = (key: string, label: string, sub: string, value: number, accent: string) => {
    if (value > 0) levers.push({ key, label, sub, value: Math.round(value), accent });
  };

  const slowShare = detailed
    ? i.responseMins > 60 ? 0.45 : i.responseMins > 15 ? 0.3 : 0.12
    : 0.35;
  const stl = i.enquiries * perYear * slowShare * 0.3 * close * job;
  push("speed", "LeadIQ", "Enquiries rescued by a <60s reply", stl, "#F59E0B");

  const missed = detailed ? i.missedCalls : i.enquiries * 0.15;
  const reception = missed * perYear * 0.5 * close * job;
  push("reception", "AI Reception & Support", "Missed calls answered and booked", reception, "#22D3EE");

  const reviewLift = detailed
    ? i.reviewCount < 30 ? 0.12 : i.reviewCount < 100 ? 0.08 : 0.04
    : 0.08;
  const reviews = i.enquiries * perYear * reviewLift * close * job;
  push("reviews", "ReputationIQ", "Extra enquiries from a stronger profile", reviews, "#7C3AED");

  const quotes = detailed ? i.quotesPerWeek : i.enquiries * 0.5;
  const quoteMins = detailed ? i.minsPerQuote : 25;
  const quoteHoursWeek = (quotes * quoteMins) / 60;
  const quoting = quoteHoursWeek * perYear * 0.7 * hourly + quotes * perYear * 0.04 * job;
  push("quotes", "QuoteIQ", "Quoting time recovered + faster wins", quoting, "#EA580C");

  // Quick-tier baselines scale from zero with the business profile, so a
  // fresh page (all minimums) reads ~€0 and grows as the numbers do.
  const adminHours = detailed ? i.adminHours : Math.min((i.teamSize - 1) * 2, 35);
  const admin = adminHours * perYear * 0.5 * hourly;
  push("assistant", "AssistIQ + ClientIQ", "Routine admin off your team's plate", admin, "#3B82F6");

  const chase = detailed ? i.chasingHours : i.teamSize > 3 ? 2 : i.teamSize > 1 ? 1 : 0;
  const chasing = chase * perYear * 0.6 * hourly;
  push("collections", "Automated follow-ups", "Invoice chasing handled for you", chasing, "#34D399");

  const content = Math.min(i.enquiries * 0.25, 2.5) * perYear * 0.7 * hourly;
  push("content", "ContentIQ", "Campaigns written in your voice", content, "#EC4899");

  const fleet = detailed ? i.vehicles : i.industry === "logistics" ? Math.round(i.teamSize * 0.6) : 0;
  const logistics = fleet * 160 * 12;
  push("logistics", "FleetIQ", "Routing & fleet utilisation", logistics, "#FB7185");

  const revenue = stl + reception + reviews + quotes * perYear * 0.04 * job;
  const total = levers.reduce((s, l) => s + l.value, 0);
  const costs = total - Math.round(revenue);
  const hoursWeek = adminHours * 0.5 + quoteHoursWeek * 0.7 + chase * 0.6 + 2.5 * 0.7;

  levers.sort((a, b) => b.value - a.value);
  return {
    total: Math.round(total),
    revenue: Math.round(revenue),
    costs: Math.max(costs, 0),
    hoursWeek: Math.round(hoursWeek),
    spreadPct: detailed ? 15 : 35,
    levers,
  };
}

// ---------------------------------------------------------------------------
// Tier 3 — the operations audit engine.
// ---------------------------------------------------------------------------
type Severity = "high" | "medium" | "low";
type Bottleneck = {
  key: string;
  severity: Severity;
  title: string;
  evidence: string; // "what you told us"
  impact?: number; // €/yr where derivable
  objection: string; // what we always hear
  answer: string; // the straight answer
  agent: string;
  accent: string;
};
type Audit = { score: number; leakage: number; bottlenecks: Bottleneck[] };

function runAudit(i: Inputs, r: Result): Audit {
  const close = PRESET[i.industry].close;
  const job = i.jobValue;
  const b: Bottleneck[] = [];
  const lever = (k: string) => r.levers.find((l) => l.key === k)?.value ?? 0;

  if (i.missedCalls > 3) {
    b.push({
      key: "missed", severity: i.missedCalls > 10 ? "high" : "medium",
      title: "Calls are ringing out",
      evidence: `${i.missedCalls} calls a week go unanswered`,
      impact: lever("reception"),
      objection: "“An AI answering our phone will put customers off.”",
      answer: "It answers naturally in your business's voice, books straight into your calendar and hands anything sensitive to a human. Customers don't get put off — they get answered. The alternative they're getting today is a ring-out.",
      agent: "AI Reception & Support", accent: "#22D3EE",
    });
  }
  if (i.responseMins > 30) {
    b.push({
      key: "slow", severity: i.responseMins > 120 ? "high" : "medium",
      title: "Leads go cold before you reply",
      evidence: `Typical first reply after ${i.responseMins >= 60 ? `${Math.round(i.responseMins / 60)} hour${i.responseMins >= 120 ? "s" : ""}` : `${i.responseMins} minutes`}`,
      impact: lever("speed"),
      objection: "“We always get back to people eventually.”",
      answer: "Most jobs go to whoever answers first — 'eventually' is where enquiries die. LeadIQ replies in under 60 seconds, every time, day or night, then hands the warm conversation to you.",
      agent: "LeadIQ", accent: "#F59E0B",
    });
  }
  if (i.afterHours !== "oncall") {
    b.push({
      key: "afterhours", severity: i.afterHours === "nobody" ? "high" : "medium",
      title: "After-hours enquiries are lost",
      evidence: i.afterHours === "nobody" ? "Nobody handles evenings & weekends" : "After-hours callers get voicemail",
      impact: Math.round(i.enquiries * 52 * 0.2 * 0.5 * close * job),
      objection: "“People can just call back in the morning.”",
      answer: "Some do. Most ring the next name on Google. Your AI agents work 24/7 — the 9pm enquiry is answered, qualified and booked before your competitors open.",
      agent: "AI Reception & Support", accent: "#22D3EE",
    });
  }
  if (i.quoteFollowUp !== "always" && i.quotesPerWeek > 0) {
    b.push({
      key: "quotefollow", severity: i.quoteFollowUp === "rarely" ? "high" : "medium",
      title: "Quotes die without follow-up",
      evidence: `${i.quotesPerWeek} quotes a week, followed up ${i.quoteFollowUp === "rarely" ? "rarely" : "only sometimes"}`,
      impact: Math.round(i.quotesPerWeek * 52 * 0.1 * close * job * 0.5),
      objection: "“Chasing people feels pushy.”",
      answer: "A polite, well-timed nudge isn't pushy — it's professional. The CRM tracks every open quote and follows up automatically until there's a yes or a no, so nothing just fades away.",
      agent: "QuoteIQ + ClientIQ", accent: "#EA580C",
    });
  }
  if (i.tracking === "paper" || i.tracking === "sheets") {
    b.push({
      key: "tracking", severity: "medium",
      title: "No single source of truth",
      evidence: i.tracking === "paper" ? "Jobs tracked on paper / whiteboard" : "Jobs tracked across spreadsheets",
      impact: Math.round(lever("assistant") * 0.4),
      objection: "“Spreadsheets have worked fine for years.”",
      answer: "They work until the day one detail goes missing on a big job. Every lead, quote, job and payment lives on one Job Record — nothing typed twice, nothing lost between tools, and you keep the tools you like.",
      agent: "AssistIQ + ClientIQ", accent: "#3B82F6",
    });
  }
  if (i.doubleEntry !== "rare") {
    b.push({
      key: "doubleentry", severity: i.doubleEntry === "constant" ? "high" : "medium",
      title: "The same information is typed twice",
      evidence: i.doubleEntry === "constant" ? "Details re-typed between systems constantly" : "Details re-typed between systems regularly",
      impact: Math.round(lever("assistant") * 0.3),
      objection: "“That's just how our systems are.”",
      answer: "It doesn't have to be. We connect what you already use so information entered once flows everywhere it's needed — the hours that frees up are in the number above.",
      agent: "AssistIQ + ClientIQ", accent: "#3B82F6",
    });
  }
  if (i.ownerEvenings > 4) {
    b.push({
      key: "owner", severity: i.ownerEvenings > 8 ? "high" : "medium",
      title: "The owner is the system",
      evidence: `~${i.ownerEvenings} hours of evening/weekend admin on the owner`,
      objection: "“Nobody can run this the way I do.”",
      answer: "Exactly — which is why we encode the way you do it into the workflows, so the system runs your way without you typing it all in at 10pm. You stay in control; you stop being the bottleneck.",
      agent: "AssistIQ + workflows", accent: "#3B82F6",
    });
  }
  if (i.reviewCount < 50) {
    b.push({
      key: "reviews", severity: "medium",
      title: "Under-represented on Google",
      evidence: `${i.reviewCount} Google reviews today`,
      impact: lever("reviews"),
      objection: "“Our work speaks for itself.”",
      answer: "To existing customers, yes. Strangers check reviews first — and choose the business with 150 of them. The ReputationIQ asks every happy customer at the right moment, automatically, until your profile matches your work.",
      agent: "ReputationIQ", accent: "#7C3AED",
    });
  }
  if (i.noShows > 2) {
    b.push({
      key: "noshows", severity: i.noShows > 6 ? "high" : "medium",
      title: "No-shows are burning booked slots",
      evidence: `~${i.noShows} no-shows or late cancellations a month`,
      impact: Math.round(i.noShows * 12 * job * 0.5),
      objection: "“Reminders won't stop people cancelling.”",
      answer: "They won't stop all of it — they reliably cut it. Automated confirmations and well-timed reminders mean fewer forgotten appointments, and cancelled slots get refilled instead of sitting empty.",
      agent: "Automated follow-ups", accent: "#34D399",
    });
  }
  if (i.marketing !== "regular") {
    b.push({
      key: "marketing", severity: "low",
      title: "Feast-and-famine pipeline",
      evidence: i.marketing === "none" ? "No regular marketing output" : "Marketing happens when there's time",
      impact: lever("content"),
      objection: "“There's no time for marketing when we're busy.”",
      answer: "That's precisely when the pipeline dries up for next month. The ContentIQ keeps campaigns going in your voice while you're on the tools — so busy months feed the quiet ones.",
      agent: "ContentIQ", accent: "#EC4899",
    });
  }
  if (i.socialDms !== "ontop") {
    b.push({
      key: "dms", severity: "low",
      title: "Social DMs sit unanswered",
      evidence: i.socialDms === "ignored" ? "Instagram/Facebook messages go unanswered" : "DMs answered when someone gets a minute",
      objection: "“DMs are just people asking prices.”",
      answer: "Price-checkers are buyers mid-decision. The DM Setter answers instantly, qualifies the serious ones and books them into your calendar — straight from the conversation.",
      agent: "SocialIQ", accent: "#E1306C",
    });
  }
  if (i.toolCount >= 5) {
    b.push({
      key: "sprawl", severity: "low",
      title: "Tool sprawl",
      evidence: `${i.toolCount}+ separate software tools in daily use`,
      objection: "“We've already paid for all these tools.”",
      answer: "Keep them. We don't rip out what works — we connect it under one operating layer so your team works in one place and the tools stay in sync behind the scenes.",
      agent: "AutomateIQ platform", accent: "#3B82F6",
    });
  }
  if (i.vehicles > 3) {
    b.push({
      key: "fleet", severity: "medium",
      title: "No live view of the fleet",
      evidence: `${i.vehicles} vehicles on the road`,
      impact: lever("logistics"),
      objection: "“GPS trackers are expensive and we'd not use the data.”",
      answer: "The Control Centre works with the trackers you have (or none, to start) and turns positions into answers — where's the van, which deliveries are at risk, which routes waste hours. You use answers, not data.",
      agent: "FleetIQ", accent: "#FB7185",
    });
  }

  const weight: Record<Severity, number> = { high: 12, medium: 7, low: 3 };
  const order: Record<Severity, number> = { high: 0, medium: 1, low: 2 };
  b.sort((x, y) => order[x.severity] - order[y.severity] || (y.impact ?? 0) - (x.impact ?? 0));
  const score = Math.max(25, Math.min(95, 100 - b.reduce((s, x) => s + weight[x.severity], 0)));
  const leakage = b.reduce((s, x) => s + (x.impact ?? 0), 0);
  return { score, leakage, bottlenecks: b };
}

// ---------------------------------------------------------------------------

const eur = new Intl.NumberFormat("en-IE", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
});

function useCountUp(target: number): number {
  const [shown, setShown] = useState(target);
  const fromRef = useRef(target);
  useEffect(() => {
    if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      fromRef.current = target;
      setShown(target);
      return;
    }
    const from = fromRef.current;
    fromRef.current = target;
    if (from === target) return;
    const start = performance.now();
    const dur = 650;
    let raf = 0;
    const tick = (now: number) => {
      const t = Math.min((now - start) / dur, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      setShown(Math.round(from + (target - from) * eased));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target]);
  return shown;
}

function Slider({
  label, value, min, max, step = 1, format, onChange,
}: {
  label: string; value: number; min: number; max: number; step?: number;
  format: (v: number) => string; onChange: (v: number) => void;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <label className="sv-slider">
      <span className="sv-slider-head">
        <span className="sv-slider-label">{label}</span>
        <span className="sv-slider-value">{format(value)}</span>
      </span>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ ["--p" as string]: `${pct}%` }}
        aria-label={label}
      />
    </label>
  );
}

function ChipGroup<T extends string>({
  label, options, value, onChange,
}: {
  label: string;
  options: { key: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="sv-chiprow">
      <span className="sv-chiprow-label">{label}</span>
      <div className="sv-chips" role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button
            key={o.key} type="button" role="radio" aria-checked={value === o.key}
            className={`sv-chip ${value === o.key ? "on" : ""}`}
            onClick={() => onChange(o.key)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function ScoreRing({ score }: { score: number }) {
  const R = 52;
  const C = 2 * Math.PI * R;
  const shown = useCountUp(score);
  const color = score >= 70 ? "#34D399" : score >= 50 ? "#F59E0B" : "#F87171";
  return (
    <div className="sv-score" role="img" aria-label={`Operations score ${score} out of 100`}>
      <svg viewBox="0 0 120 120" width="128" height="128">
        <circle cx="60" cy="60" r={R} fill="none" stroke="rgba(255,255,255,.08)" strokeWidth="9" />
        <circle
          cx="60" cy="60" r={R} fill="none" stroke={color} strokeWidth="9"
          strokeLinecap="round" strokeDasharray={C}
          strokeDashoffset={C - (C * score) / 100}
          transform="rotate(-90 60 60)"
          className="sv-score-arc"
        />
      </svg>
      <span className="sv-score-num" style={{ color }}>{shown}</span>
      <span className="sv-score-cap">operations score</span>
    </div>
  );
}

const SEV_LABEL: Record<Severity, string> = { high: "Critical", medium: "Costing you", low: "Worth fixing" };

// ---------------------------------------------------------------------------

export function SavingsCalculator() {
  const [tier, setTier] = useState<0 | 1 | 2>(0);
  const [inputs, setInputs] = useState<Inputs>(DEFAULTS);
  const set = <K extends keyof Inputs>(k: K, v: Inputs[K]) =>
    setInputs((p) => ({ ...p, [k]: v }));

  const detailed = tier >= 1;
  const result = useMemo(() => compute(inputs, detailed), [inputs, detailed]);
  const audit = useMemo(() => (tier === 2 ? runAudit(inputs, result) : null), [tier, inputs, result]);
  const total = useCountUp(result.total);
  const maxLever = result.levers[0]?.value ?? 1;

  return (
    <>
      <div className="sv-wrap">
        {/* ---- Inputs ---- */}
        <div className="sv-inputs panel">
          <div className="sv-tiers sv-tiers-3" role="tablist" aria-label="Estimate detail level">
            <button type="button" role="tab" aria-selected={tier === 0} className={`sv-tier ${tier === 0 ? "on" : ""}`} onClick={() => setTier(0)}>
              <Gauge size={14} /> Quick estimate
              <em>4 questions · 30 seconds</em>
            </button>
            <button type="button" role="tab" aria-selected={tier === 1} className={`sv-tier ${tier === 1 ? "on" : ""}`} onClick={() => setTier(1)}>
              <Sparkles size={14} /> Detailed analysis
              <em>Your real numbers · ±15%</em>
            </button>
            <button type="button" role="tab" aria-selected={tier === 2} className={`sv-tier sv-tier-audit ${tier === 2 ? "on" : ""}`} onClick={() => setTier(2)}>
              <ClipboardCheck size={14} /> Operations audit
              <em>Full bottleneck report</em>
            </button>
          </div>

          <p className="sv-group-label">Your business</p>
          <div className="sv-chips" role="radiogroup" aria-label="Industry">
            {INDUSTRIES.map((ind) => (
              <button
                key={ind.key} type="button" role="radio" aria-checked={inputs.industry === ind.key}
                className={`sv-chip ${inputs.industry === ind.key ? "on" : ""}`}
                onClick={() => { set("industry", ind.key); set("jobValue", PRESET[ind.key].job); }}
              >
                {ind.label}
              </button>
            ))}
          </div>

          <Slider label="People in the business" value={inputs.teamSize} min={1} max={50} format={(v) => `${v}`} onChange={(v) => set("teamSize", v)} />
          <Slider label="Average job / order value" value={inputs.jobValue} min={50} max={5000} step={25} format={(v) => eur.format(v)} onChange={(v) => set("jobValue", v)} />
          <Slider label="New enquiries per week" value={inputs.enquiries} min={1} max={100} format={(v) => `${v}`} onChange={(v) => set("enquiries", v)} />

          <div className={`sv-detail ${detailed ? "open" : ""}`} aria-hidden={!detailed}>
            <p className="sv-group-label">Your real numbers <span>— each one sharpens the estimate</span></p>
            <Slider label="Calls that ring out per week" value={inputs.missedCalls} min={0} max={60} format={(v) => `${v}`} onChange={(v) => set("missedCalls", v)} />
            <Slider label="Typical first reply to a new lead" value={inputs.responseMins} min={5} max={480} step={5} format={(v) => (v >= 60 ? `${Math.round(v / 60)} hr${v >= 120 ? "s" : ""}` : `${v} min`)} onChange={(v) => set("responseMins", v)} />
            <Slider label="Team admin hours per week" value={inputs.adminHours} min={0} max={80} format={(v) => `${v} h`} onChange={(v) => set("adminHours", v)} />
            <Slider label="Average staff cost per hour" value={inputs.hourlyCost} min={15} max={60} format={(v) => eur.format(v)} onChange={(v) => set("hourlyCost", v)} />
            <Slider label="Quotes sent per week" value={inputs.quotesPerWeek} min={0} max={60} format={(v) => `${v}`} onChange={(v) => set("quotesPerWeek", v)} />
            <Slider label="Minutes to prepare a quote" value={inputs.minsPerQuote} min={10} max={120} step={5} format={(v) => `${v} min`} onChange={(v) => set("minsPerQuote", v)} />
            <Slider label="Hours chasing invoices per week" value={inputs.chasingHours} min={0} max={20} format={(v) => `${v} h`} onChange={(v) => set("chasingHours", v)} />
            <Slider label="Google reviews today" value={inputs.reviewCount} min={0} max={500} step={5} format={(v) => `${v}`} onChange={(v) => set("reviewCount", v)} />
            <Slider label="Vehicles on the road (if any)" value={inputs.vehicles} min={0} max={40} format={(v) => `${v}`} onChange={(v) => set("vehicles", v)} />
          </div>

          <div className={`sv-detail ${tier === 2 ? "open" : ""}`} aria-hidden={tier !== 2}>
            <p className="sv-group-label">How you run today <span>— this builds your bottleneck report</span></p>
            <ChipGroup label="Where jobs are tracked" value={inputs.tracking} onChange={(v) => set("tracking", v)}
              options={[{ key: "paper", label: "Paper / whiteboard" }, { key: "sheets", label: "Spreadsheets" }, { key: "crm", label: "A CRM" }, { key: "custom", label: "Custom system" }]} />
            <ChipGroup label="Same details typed into more than one place" value={inputs.doubleEntry} onChange={(v) => set("doubleEntry", v)}
              options={[{ key: "rare", label: "Rarely" }, { key: "sometimes", label: "Sometimes" }, { key: "constant", label: "Constantly" }]} />
            <ChipGroup label="Evenings & weekends, enquiries are…" value={inputs.afterHours} onChange={(v) => set("afterHours", v)}
              options={[{ key: "nobody", label: "Missed" }, { key: "voicemail", label: "Voicemail" }, { key: "oncall", label: "Covered" }]} />
            <ChipGroup label="Unanswered quotes get followed up" value={inputs.quoteFollowUp} onChange={(v) => set("quoteFollowUp", v)}
              options={[{ key: "rarely", label: "Rarely" }, { key: "sometimes", label: "Sometimes" }, { key: "always", label: "Always" }]} />
            <ChipGroup label="Marketing output" value={inputs.marketing} onChange={(v) => set("marketing", v)}
              options={[{ key: "none", label: "None" }, { key: "occasional", label: "When there's time" }, { key: "regular", label: "Every week" }]} />
            <ChipGroup label="Instagram / Facebook messages" value={inputs.socialDms} onChange={(v) => set("socialDms", v)}
              options={[{ key: "ignored", label: "Go unanswered" }, { key: "slow", label: "Answered late" }, { key: "ontop", label: "On top of them" }]} />
            <Slider label="No-shows / late cancellations per month" value={inputs.noShows} min={0} max={20} format={(v) => `${v}`} onChange={(v) => set("noShows", v)} />
            <Slider label="Owner's evening/weekend admin hours" value={inputs.ownerEvenings} min={0} max={20} format={(v) => `${v} h`} onChange={(v) => set("ownerEvenings", v)} />
            <Slider label="Separate software tools in daily use" value={inputs.toolCount} min={1} max={12} format={(v) => `${v}`} onChange={(v) => set("toolCount", v)} />
          </div>

          {tier < 2 && (
            <button type="button" className="sv-more" onClick={() => setTier((t) => (t === 0 ? 1 : 2))}>
              <ChevronDown size={14} />
              {tier === 0 ? "Add your real numbers for a far more accurate figure" : "Answer 9 more for your full operations audit"}
            </button>
          )}
        </div>

        {/* ---- Results ---- */}
        <div className="sv-results panel">
          <p className="sv-results-kicker">
            Estimated annual impact
            <span className={`sv-confidence ${detailed ? "hi" : ""}`}>
              {tier === 2 ? "Audit-grade" : tier === 1 ? "Detailed" : "Quick"} estimate · ±{result.spreadPct}%
            </span>
          </p>
          <p className="sv-total" aria-live="polite">{eur.format(total)}</p>
          <p className="sv-range">
            Likely range {eur.format(Math.round(result.total * (1 - result.spreadPct / 100)))} –{" "}
            {eur.format(Math.round(result.total * (1 + result.spreadPct / 100)))} per year
          </p>

          <div className="sv-splits">
            <div className="sv-split">
              <span className="sv-split-icon" style={{ color: "#34D399" }}><TrendingUp size={15} /></span>
              <span className="sv-split-v">{eur.format(result.revenue)}</span>
              <span className="sv-split-k">revenue recovered</span>
            </div>
            <div className="sv-split">
              <span className="sv-split-icon" style={{ color: "#3B82F6" }}><Gauge size={15} /></span>
              <span className="sv-split-v">{eur.format(result.costs)}</span>
              <span className="sv-split-k">costs saved</span>
            </div>
            <div className="sv-split">
              <span className="sv-split-icon" style={{ color: "#F59E0B" }}><Timer size={15} /></span>
              <span className="sv-split-v">{result.hoursWeek} h</span>
              <span className="sv-split-k">freed every week</span>
            </div>
          </div>

          <p className="sv-group-label" style={{ marginTop: 26 }}>Where it comes from</p>
          <div className="sv-bars">
            {result.levers.map((l) => (
              <div key={l.key} className="sv-bar">
                <span className="sv-bar-head">
                  <span className="sv-bar-label">{l.label}</span>
                  <span className="sv-bar-value">{eur.format(l.value)}</span>
                </span>
                <span className="sv-bar-track">
                  <span className="sv-bar-fill" style={{ width: `${Math.max((l.value / maxLever) * 100, 4)}%`, background: l.accent }} />
                </span>
                <span className="sv-bar-sub">{l.sub}</span>
              </div>
            ))}
          </div>

          <Link href="/book" className="btn btn-primary sv-cta">
            Bring these numbers to a free strategy session <ArrowRight size={15} />
          </Link>
          <p className="sv-note">
            Conservative estimate based on typical results for a business with your profile — not a
            guarantee. On a strategy call we rebuild it line by line from your actual figures.
          </p>
        </div>
      </div>

      {/* ---- Tier 3: the operations audit report ---- */}
      {audit && (
        <div className="sv-audit">
          <div className="sv-audit-head panel">
            <div className="sv-audit-brand">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/logo-aiq.png" alt="AutomateIQ" />
              <div>
                <p className="sv-audit-kicker">Operations Audit</p>
                <h2>Your bottleneck report</h2>
                <p className="sv-audit-sub">
                  Built live from your answers — the same diagnosis we run at the start of every
                  engagement, before you&apos;ve even seen the dashboard.
                </p>
              </div>
            </div>
            <div className="sv-audit-summary">
              <ScoreRing score={audit.score} />
              <div className="sv-audit-stats">
                <div className="sv-audit-stat">
                  <span className="sv-audit-stat-v">{audit.bottlenecks.length}</span>
                  <span className="sv-audit-stat-k">bottlenecks found</span>
                </div>
                <div className="sv-audit-stat">
                  <span className="sv-audit-stat-v">{eur.format(audit.leakage)}</span>
                  <span className="sv-audit-stat-k">est. annual leakage</span>
                </div>
                <div className="sv-audit-stat">
                  <span className="sv-audit-stat-v">{audit.bottlenecks.filter((x) => x.severity === "high").length}</span>
                  <span className="sv-audit-stat-k">critical priorities</span>
                </div>
              </div>
            </div>
          </div>

          {audit.bottlenecks.length === 0 ? (
            <div className="panel sv-audit-clean">
              <h3>Remarkably tight operation.</h3>
              <p>
                Nothing above our thresholds — the calculator&apos;s figure is pure upside. A strategy
                call would focus on scaling what already works.
              </p>
            </div>
          ) : (
            <div className="sv-audit-grid">
              {audit.bottlenecks.map((x) => (
                <article key={x.key} className={`panel sv-bn sv-bn-${x.severity}`}>
                  <header className="sv-bn-head">
                    <span className={`sv-bn-sev sv-bn-sev-${x.severity}`}>{SEV_LABEL[x.severity]}</span>
                    {typeof x.impact === "number" && x.impact > 0 && (
                      <span className="sv-bn-impact">{eur.format(x.impact)}<em>/yr</em></span>
                    )}
                  </header>
                  <h3>{x.title}</h3>
                  <p className="sv-bn-evidence">You told us: {x.evidence}</p>
                  <blockquote className="sv-bn-objection">{x.objection}</blockquote>
                  <p className="sv-bn-answer"><strong>The straight answer —</strong> {x.answer}</p>
                  <footer className="sv-bn-agent">
                    <span className="sv-bn-dot" style={{ background: x.accent }} />
                    Solved by {x.agent}
                  </footer>
                </article>
              ))}
            </div>
          )}

          <div className="panel sv-audit-cta">
            <div>
              <h3>This report took you two minutes. Imagine the system behind it.</h3>
              <p>
                Everything above is generated before you&apos;ve seen the dashboard. On a free strategy
                session we walk each bottleneck, rebuild the numbers from your books, and show the
                agents fixing them live.
              </p>
            </div>
            <Link href="/book" className="btn btn-primary">
              Book your free strategy session <ArrowRight size={15} />
            </Link>
          </div>
        </div>
      )}
    </>
  );
}
