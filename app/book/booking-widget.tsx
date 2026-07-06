"use client";

import { useState } from "react";
import { Check, Calendar, Clock, ArrowRight, Loader2 } from "lucide-react";
import type { BookingDay } from "@/lib/booking/slots";

type Status = "idle" | "submitting" | "success" | "error";

export function BookingWidget({ days }: { days: BookingDay[] }) {
  const [activeDate, setActiveDate] = useState<string>(days[0]?.date ?? "");
  const [slot, setSlot] = useState<{ iso: string; label: string; dayLabel: string } | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string>("");

  const activeDay = days.find((d) => d.date === activeDate);

  if (days.length === 0) {
    return (
      <div className="panel panel-block book-empty">
        <p>
          There are no open slots in the next few weeks right now. Please email{" "}
          <a href="mailto:jude@automateiq.ie">jude@automateiq.ie</a> and we&apos;ll find a time.
        </p>
      </div>
    );
  }

  if (status === "success") {
    return (
      <div className="panel book-success">
        <span className="book-success-icon"><Check size={28} /></span>
        <h3>You&apos;re booked in</h3>
        <p>
          Your AI Strategy Session for <strong>{slot?.dayLabel} · {slot?.label}</strong> is
          reserved. We&apos;ve sent a confirmation to your email — check your inbox (and spam, just
          in case). We look forward to speaking with you.
        </p>
      </div>
    );
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!slot) return;
    setStatus("submitting");
    setError("");
    const form = new FormData(e.currentTarget);
    try {
      const res = await fetch("/api/book", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          slot: slot.iso,
          name: form.get("name"),
          company: form.get("company"),
          email: form.get("email"),
          phone: form.get("phone"),
          businessType: form.get("businessType"),
          message: form.get("message"),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStatus("error");
        setError(data.error ?? "Something went wrong. Please try again.");
        // A taken/expired slot means the calendar is stale — nudge a refresh.
        if (res.status === 409) setSlot(null);
        return;
      }
      setStatus("success");
    } catch {
      setStatus("error");
      setError("Network error. Please check your connection and try again.");
    }
  }

  return (
    <div className="book-widget panel">
      {/* Step 1 — date */}
      <div className="book-step">
        <p className="book-step-label"><Calendar size={14} /> 1. Pick a day</p>
        <div className="book-dates">
          {days.map((d) => (
            <button
              key={d.date}
              type="button"
              className={`book-date-chip ${activeDate === d.date ? "is-active" : ""}`}
              onClick={() => { setActiveDate(d.date); }}
            >
              <span className="book-date-dow">{d.weekday.slice(0, 3)}</span>
              <span className="book-date-num">{d.dayLabel.split(", ")[1]}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Step 2 — time */}
      <div className="book-step">
        <p className="book-step-label"><Clock size={14} /> 2. Pick a time</p>
        <div className="book-times">
          {(activeDay?.slots ?? []).map((s) => (
            <button
              key={s.iso}
              type="button"
              className={`book-time-chip ${slot?.iso === s.iso ? "is-active" : ""}`}
              onClick={() =>
                setSlot({ iso: s.iso, label: s.label, dayLabel: activeDay?.dayLabel ?? "" })
              }
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {/* Step 3 — details */}
      <form className="book-form" onSubmit={submit}>
        <p className="book-step-label"><ArrowRight size={14} /> 3. Your details</p>
        {slot && (
          <p className="book-selected">
            Selected: <strong>{slot.dayLabel} · {slot.label}</strong>
          </p>
        )}
        <div className="book-field-grid">
          <label className="field">
            <span>Name *</span>
            <input name="name" type="text" required autoComplete="name" placeholder="Your name" />
          </label>
          <label className="field">
            <span>Company</span>
            <input name="company" type="text" autoComplete="organization" placeholder="Your business" />
          </label>
          <label className="field">
            <span>Email *</span>
            <input name="email" type="email" required autoComplete="email" placeholder="you@business.ie" />
          </label>
          <label className="field">
            <span>Phone (optional)</span>
            <input name="phone" type="tel" autoComplete="tel" placeholder="+353…" />
          </label>
        </div>
        <label className="field">
          <span>Business type</span>
          <input name="businessType" type="text" placeholder="e.g. Plumbing, retail, professional services" />
        </label>
        <label className="field">
          <span>What would you like help with?</span>
          <textarea name="message" rows={4} placeholder="Briefly, what takes up the most time in your business right now?" />
        </label>

        {status === "error" && <p className="book-error">{error}</p>}

        <button type="submit" className="btn btn-primary book-submit" disabled={!slot || status === "submitting"}>
          {status === "submitting" ? (
            <><Loader2 size={16} className="book-spin" /> Booking…</>
          ) : !slot ? (
            "Select a date and time above"
          ) : (
            "Confirm my free session"
          )}
        </button>
        <p className="book-fineprint">
          Free · No obligation · We&apos;ll never share your details. By booking you agree to be
          contacted about your session.
        </p>
      </form>
    </div>
  );
}
