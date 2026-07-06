"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight, ChevronDown, Gauge, Sparkles, Timer, TrendingUp } from "lucide-react";

/**
 * Two-tier savings calculator, modelled on the AutomateIQ agent and system
 * line-up. Tier 1 (Quick estimate) needs four inputs and fills the gaps with
 * conservative industry assumptions; Tier 2 (Detailed analysis) replaces those
 * assumptions with the customer's real numbers, tightening the estimate range.
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
  missedCalls: number; // per week
  responseMins: number; // typical first-response time
  adminHours: number; // per week, whole team
  hourlyCost: number; // €
  quotesPerWeek: number;
  minsPerQuote: number;
  chasingHours: number; // invoice chasing, per week
  reviewCount: number; // current Google reviews
  vehicles: number; // fleet size, if any
};

const DEFAULTS: Inputs = {
  industry: "trades",
  teamSize: 6,
  jobValue: 850,
  enquiries: 15,
  missedCalls: 8,
  responseMins: 120,
  adminHours: 20,
  hourlyCost: 28,
  quotesPerWeek: 8,
  minsPerQuote: 35,
  chasingHours: 3,
  reviewCount: 24,
  vehicles: 0,
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

  // 1 — Speed-to-Lead: enquiries answered in under a minute instead of hours.
  //     Share of enquiries currently at risk depends on real response time.
  const slowShare = detailed
    ? i.responseMins > 60 ? 0.45 : i.responseMins > 15 ? 0.3 : 0.12
    : 0.35;
  const stl = i.enquiries * perYear * slowShare * 0.3 * close * job;
  push("speed", "Speed-to-Lead Agent", "Enquiries rescued by a <60s reply", stl, "#F59E0B");

  // 2 — AI reception & support: missed calls answered and booked.
  const missed = detailed ? i.missedCalls : i.enquiries * 0.15;
  const reception = missed * perYear * 0.5 * close * job;
  push("reception", "AI Reception & Support", "Missed calls answered and booked", reception, "#22D3EE");

  // 3 — Review Agent: a stronger Google profile lifts inbound enquiries.
  const reviewLift = detailed
    ? i.reviewCount < 30 ? 0.12 : i.reviewCount < 100 ? 0.08 : 0.04
    : 0.08;
  const reviews = i.enquiries * perYear * reviewLift * close * job;
  push("reviews", "Review Agent", "Extra enquiries from a stronger profile", reviews, "#7C3AED");

  // 4 — Instant Quote Agent: quoting time recovered + faster quotes win more.
  const quotes = detailed ? i.quotesPerWeek : i.enquiries * 0.5;
  const quoteMins = detailed ? i.minsPerQuote : 25;
  const quoteHoursWeek = (quotes * quoteMins) / 60;
  const quoting = quoteHoursWeek * perYear * 0.7 * hourly + quotes * perYear * 0.04 * job;
  push("quotes", "Instant Quote Agent", "Quoting time recovered + faster wins", quoting, "#EA580C");

  // 5 — AI Assistant + CRM: routine admin automated (~50% of it).
  const adminHours = detailed ? i.adminHours : Math.min(4 + i.teamSize * 1.5, 35);
  const admin = adminHours * perYear * 0.5 * hourly;
  push("assistant", "AI Assistant + CRM", "Routine admin off your team's plate", admin, "#3B82F6");

  // 6 — Collections follow-up: hours spent chasing invoices, mostly automated.
  const chase = detailed ? i.chasingHours : i.teamSize > 3 ? 2 : 1;
  const chasing = chase * perYear * 0.6 * hourly;
  push("collections", "Automated follow-ups", "Invoice chasing handled for you", chasing, "#34D399");

  // 7 — Content Agent: steady marketing output without agency hours.
  const content = 2.5 * perYear * 0.7 * hourly;
  push("content", "Content Agent", "Campaigns written in your voice", content, "#EC4899");

  // 8 — Logistics Control Centre: routing + utilisation per vehicle (conservative
  //     ~€160/month/vehicle across fuel, time and failed-delivery reduction).
  const fleet = detailed ? i.vehicles : i.industry === "logistics" ? Math.round(i.teamSize * 0.6) : 0;
  const logistics = fleet * 160 * 12;
  push("logistics", "Logistics Control Centre", "Routing & fleet utilisation", logistics, "#FB7185");

  const revenue = stl + reception + reviews + quotes * perYear * 0.04 * job;
  const total = levers.reduce((s, l) => s + l.value, 0);
  const costs = total - Math.round(revenue);
  const hoursWeek =
    adminHours * 0.5 + quoteHoursWeek * 0.7 + chase * 0.6 + 2.5 * 0.7;

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

const eur = new Intl.NumberFormat("en-IE", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
});

/** Animated count-up that respects prefers-reduced-motion. */
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
  label,
  value,
  min,
  max,
  step = 1,
  format,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <label className="sv-slider">
      <span className="sv-slider-head">
        <span className="sv-slider-label">{label}</span>
        <span className="sv-slider-value">{format(value)}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ ["--p" as string]: `${pct}%` }}
        aria-label={label}
      />
    </label>
  );
}

export function SavingsCalculator() {
  const [detailed, setDetailed] = useState(false);
  const [inputs, setInputs] = useState<Inputs>(DEFAULTS);
  const set = <K extends keyof Inputs>(k: K, v: Inputs[K]) =>
    setInputs((p) => ({ ...p, [k]: v }));

  const result = useMemo(() => compute(inputs, detailed), [inputs, detailed]);
  const total = useCountUp(result.total);
  const maxLever = result.levers[0]?.value ?? 1;

  return (
    <div className="sv-wrap">
      {/* ---- Inputs ---- */}
      <div className="sv-inputs panel">
        <div className="sv-tiers" role="tablist" aria-label="Estimate detail level">
          <button
            type="button"
            role="tab"
            aria-selected={!detailed}
            className={`sv-tier ${!detailed ? "on" : ""}`}
            onClick={() => setDetailed(false)}
          >
            <Gauge size={14} /> Quick estimate
            <em>4 questions · 30 seconds</em>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={detailed}
            className={`sv-tier ${detailed ? "on" : ""}`}
            onClick={() => setDetailed(true)}
          >
            <Sparkles size={14} /> Detailed analysis
            <em>Your real numbers · far more accurate</em>
          </button>
        </div>

        <p className="sv-group-label">Your business</p>
        <div className="sv-chips" role="radiogroup" aria-label="Industry">
          {INDUSTRIES.map((ind) => (
            <button
              key={ind.key}
              type="button"
              role="radio"
              aria-checked={inputs.industry === ind.key}
              className={`sv-chip ${inputs.industry === ind.key ? "on" : ""}`}
              onClick={() => {
                set("industry", ind.key);
                set("jobValue", PRESET[ind.key].job);
              }}
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

        {!detailed && (
          <button type="button" className="sv-more" onClick={() => setDetailed(true)}>
            <ChevronDown size={14} /> Add your real numbers for a far more accurate figure
          </button>
        )}
      </div>

      {/* ---- Results ---- */}
      <div className="sv-results panel">
        <p className="sv-results-kicker">
          Estimated annual impact
          <span className={`sv-confidence ${detailed ? "hi" : ""}`}>
            {detailed ? "Detailed" : "Quick"} estimate · ±{result.spreadPct}%
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
                <span
                  className="sv-bar-fill"
                  style={{ width: `${Math.max((l.value / maxLever) * 100, 4)}%`, background: l.accent }}
                />
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
  );
}
