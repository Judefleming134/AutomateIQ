"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, PhoneMissed } from "lucide-react";

/**
 * What unanswered enquiries cost, in euro.
 *
 * Every figure here is the owner's own — nothing is assumed and nothing is
 * inflated. The one industry number used (that roughly half of enquiries to a
 * small trade go unanswered at the first attempt) is stated on screen as a
 * starting point and is fully editable, because a calculator that argues with
 * someone about their own business gets closed.
 */

const money = (n: number) =>
  new Intl.NumberFormat("en-IE", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(Math.round(n));

type Field = {
  key: keyof Inputs;
  label: string;
  hint: string;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  prefix?: string;
};

type Inputs = {
  enquiries: number;
  missedPct: number;
  jobValue: number;
  closeRate: number;
};

const FIELDS: Field[] = [
  {
    key: "enquiries",
    label: "Enquiries a week",
    hint: "Calls, form fills, WhatsApps, DMs — everything that's someone asking about work.",
    min: 1,
    max: 200,
    step: 1,
  },
  {
    key: "missedPct",
    label: "How many you don't get to first time",
    hint: "On the tools, driving, mid-job. Half is typical for a small trade — change it to your reality.",
    min: 0,
    max: 90,
    step: 5,
    suffix: "%",
  },
  {
    key: "jobValue",
    label: "Average job worth",
    hint: "What a typical job invoices at, not your biggest one.",
    min: 50,
    max: 20000,
    step: 50,
    prefix: "€",
  },
  {
    key: "closeRate",
    label: "Of the ones you DO speak to, how many book",
    hint: "Your close rate when you actually get them on the phone.",
    min: 5,
    max: 100,
    step: 5,
    suffix: "%",
  },
];

export function MissedCallsCalculator() {
  const [v, setV] = useState<Inputs>({
    enquiries: 20,
    missedPct: 45,
    jobValue: 450,
    closeRate: 40,
  });

  const result = useMemo(() => {
    const missedPerWeek = v.enquiries * (v.missedPct / 100);
    // Not every missed enquiry is lost — some ring back, and you catch some
    // later. The recapture assumption is deliberately generous to the status
    // quo (a third come back to you anyway) so the number is defensible when
    // someone pushes back on it.
    const RECAPTURED = 0.33;
    const trulyLost = missedPerWeek * (1 - RECAPTURED);
    const jobsLostWeek = trulyLost * (v.closeRate / 100);
    const weekly = jobsLostWeek * v.jobValue;
    return {
      missedPerWeek,
      jobsLostWeek,
      weekly,
      monthly: weekly * 4.33,
      yearly: weekly * 52,
      // What answering everything inside five minutes would recover. Not 100%:
      // some of those enquiries were never going to book with anyone.
      recoverable: weekly * 52 * 0.7,
    };
  }, [v]);

  const set = (key: keyof Inputs, n: number) => setV((p) => ({ ...p, [key]: n }));

  return (
    <div>
      <div className="aseo-head" style={{ marginBottom: 22 }}>
        <div style={{ flex: "1 1 100%" }}>
          {FIELDS.map((f) => (
            <div key={f.key} style={{ marginBottom: 18 }}>
              <label
                htmlFor={`mc-${f.key}`}
                style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}
              >
                <strong style={{ fontSize: 14.5 }}>{f.label}</strong>
                <span style={{ color: "var(--ac2, #3b82f6)", fontWeight: 700, fontSize: 15 }}>
                  {f.prefix ?? ""}
                  {v[f.key].toLocaleString("en-IE")}
                  {f.suffix ?? ""}
                </span>
              </label>
              <input
                id={`mc-${f.key}`}
                type="range"
                min={f.min}
                max={f.max}
                step={f.step}
                value={v[f.key]}
                onChange={(e) => set(f.key, Number(e.target.value))}
                style={{ width: "100%", marginTop: 6 }}
              />
              <p style={{ fontSize: 12, color: "var(--faint)", margin: "2px 0 0" }}>{f.hint}</p>
            </div>
          ))}
        </div>
      </div>

      <p className="aseo-step-label">
        <PhoneMissed size={13} /> What that adds up to
      </p>

      <div className="aseo-hero">
        <h3 style={{ marginBottom: 6 }}>{money(result.yearly)} a year</h3>
        <p style={{ margin: "0 0 16px", color: "var(--faint)", fontSize: 14 }}>
          walking out the door in enquiries nobody got back to.
        </p>

        <div className="aseo-next" style={{ marginBottom: 16 }}>
          <div className="aseo-next-card">
            <strong>{money(result.weekly)}</strong>
            <span>every week</span>
          </div>
          <div className="aseo-next-card">
            <strong>{money(result.monthly)}</strong>
            <span>every month</span>
          </div>
          <div className="aseo-next-card">
            <strong>
              {result.jobsLostWeek < 1
                ? result.jobsLostWeek.toFixed(1)
                : Math.round(result.jobsLostWeek)}{" "}
              job{Math.round(result.jobsLostWeek) === 1 ? "" : "s"}
            </strong>
            <span>lost a week</span>
          </div>
        </div>

        <div className="aseo-block">
          <p className="aseo-block-label">How this is worked out</p>
          <p style={{ fontSize: 13.5, color: "var(--faint)" }}>
            {v.enquiries} enquiries a week × {v.missedPct}% missed ={" "}
            {result.missedPerWeek.toFixed(1)} unanswered. A third of those ring back or
            get caught later, so {(result.missedPerWeek * 0.67).toFixed(1)} are genuinely
            gone. At your {v.closeRate}% close rate that&apos;s{" "}
            {result.jobsLostWeek.toFixed(1)} jobs a week at {money(v.jobValue)} each.
            Deliberately conservative — no multipliers, no repeat-custom or
            referral value added on top.
          </p>
        </div>
      </div>

      <div
        className="panel panel-block"
        style={{ marginTop: 20, borderLeft: "3px solid var(--ac1, #8b5cf6)" }}
      >
        <strong>Roughly {money(result.recoverable)} of that is recoverable</strong>
        <p style={{ fontSize: 13.5, color: "var(--faint)", margin: "6px 0 10px" }}>
          Not all of it — some of those people were never booking with anyone. But an
          agent that answers every call, text and DM inside five minutes, day or night,
          gets most of it back. That&apos;s the thing we build.
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Link href="/book" className="btn btn-primary btn-sm">
            See it working <ArrowRight size={13} />
          </Link>
          <Link href="/freetools/response-time" className="btn btn-secondary btn-sm">
            Test your actual response time
          </Link>
        </div>
      </div>
    </div>
  );
}
