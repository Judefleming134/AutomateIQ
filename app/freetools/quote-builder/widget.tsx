"use client";

import { useMemo, useState } from "react";
import { Phone, Send } from "lucide-react";
import { euro, type QuoteConfig } from "@/lib/tools/quote-config";

/**
 * The customer-facing widget. Rendered standalone at /embed/quote
 * so it can be dropped into any site in an iframe.
 *
 * It never posts anywhere. A finished quote opens the VISITOR's own mail client
 * addressed to the business — so no server of ours sends mail on a stranger's
 * behalf, and the business gets the enquiry from the customer's real address,
 * which is the one they need to reply to anyway.
 */
export function QuoteWidget({ config, embedded }: { config: QuoteConfig; embedded?: boolean }) {
  const [picked, setPicked] = useState<Record<number, number>>({});
  const [mods, setMods] = useState<Record<number, boolean>>({});
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [detail, setDetail] = useState("");

  const total = useMemo(() => {
    let sum = config.base;
    const lines: string[] = [];
    if (config.base > 0) lines.push(`Call-out / base: ${euro(config.base)}`);
    config.s.forEach((svc, i) => {
      const qty = picked[i] ?? 0;
      if (qty <= 0) return;
      const amount = svc.k === "u" ? svc.p * qty : svc.p;
      sum += amount;
      lines.push(
        svc.k === "u"
          ? `${svc.n} × ${qty}${svc.u ? ` ${svc.u}` : ""}: ${euro(amount)}`
          : `${svc.n}: ${euro(amount)}`
      );
    });
    let pct = 0;
    config.m.forEach((m, i) => {
      if (mods[i]) {
        pct += m.pct;
        lines.push(`${m.n}: ${m.pct > 0 ? "+" : ""}${m.pct}%`);
      }
    });
    const final = Math.max(0, sum * (1 + pct / 100));
    return { final, lines, anyPicked: lines.length > (config.base > 0 ? 1 : 0) };
  }, [config, picked, mods]);

  const mailto = useMemo(() => {
    if (!config.e) return null;
    const body = [
      `Name: ${name || "(not given)"}`,
      `Contact: ${contact || "(not given)"}`,
      "",
      "Quote requested:",
      ...total.lines.map((l) => `  ${l}`),
      "",
      `Estimated total: ${euro(total.final)}`,
      "",
      detail ? `Extra detail: ${detail}` : "",
      "",
      "(Sent from the instant quote form on your website.)",
    ]
      .filter(Boolean)
      .join("\n");
    return `mailto:${encodeURIComponent(config.e)}?subject=${encodeURIComponent(
      `Quote request — ${euro(total.final)}`
    )}&body=${encodeURIComponent(body)}`;
  }, [config.e, name, contact, detail, total]);

  return (
    <div className={embedded ? "qw-embed" : ""}>
      <div className="aseo-head" style={{ marginBottom: 16, display: "block" }}>
        <strong style={{ fontSize: 17 }}>{config.b}</strong>
        <p style={{ fontSize: 13, color: "var(--faint)", margin: "3px 0 0" }}>
          Instant estimate — pick what you need.
        </p>
      </div>

      {config.s.map((svc, i) => (
        <div key={i} style={{ marginBottom: 12 }}>
          <label
            htmlFor={`qw-s-${i}`}
            style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}
          >
            <strong style={{ fontSize: 14.5 }}>{svc.n}</strong>
            <span style={{ color: "var(--faint)", fontSize: 13 }}>
              {euro(svc.p)}
              {svc.k === "u" ? ` per ${svc.u || "unit"}` : ""}
            </span>
          </label>
          {svc.k === "u" ? (
            <input
              id={`qw-s-${i}`}
              type="number"
              min={0}
              max={999}
              value={picked[i] ?? 0}
              onChange={(e) =>
                setPicked((p) => ({ ...p, [i]: Math.max(0, Math.min(999, Number(e.target.value) || 0)) }))
              }
              style={{ width: "100%", marginTop: 4 }}
              aria-label={`How many ${svc.u || "units"} of ${svc.n}`}
            />
          ) : (
            <button
              id={`qw-s-${i}`}
              type="button"
              className={`btn btn-sm ${picked[i] ? "btn-primary" : "btn-secondary"}`}
              onClick={() => setPicked((p) => ({ ...p, [i]: p[i] ? 0 : 1 }))}
              style={{ marginTop: 4 }}
            >
              {picked[i] ? "✓ Included" : "Add this"}
            </button>
          )}
        </div>
      ))}

      {config.m.length > 0 && (
        <div style={{ margin: "16px 0" }}>
          <p className="aseo-block-label">Anything else apply?</p>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {config.m.map((m, i) => (
              <button
                key={i}
                type="button"
                className={`btn btn-sm ${mods[i] ? "btn-primary" : "btn-secondary"}`}
                onClick={() => setMods((p) => ({ ...p, [i]: !p[i] }))}
              >
                {m.n} ({m.pct > 0 ? "+" : ""}
                {m.pct}%)
              </button>
            ))}
          </div>
        </div>
      )}

      <div className={`aseo-hero ${total.anyPicked ? "is-good" : "is-warn"}`} style={{ marginTop: 18 }}>
        <h3 style={{ marginBottom: 4 }}>{total.anyPicked ? euro(total.final) : "Pick a service"}</h3>
        <p style={{ margin: 0, fontSize: 13.5, color: "var(--faint)" }}>
          {total.anyPicked
            ? config.note || "Estimate only — final price confirmed after a look at the job."
            : "Choose what you need above and the price appears here."}
        </p>

        {total.anyPicked && (
          <>
            <div className="aseo-block">
              <p className="aseo-block-label">What&apos;s in that</p>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13.5, lineHeight: 1.7 }}>
                {total.lines.map((l, i) => (
                  <li key={i}>{l}</li>
                ))}
              </ul>
            </div>

            <div className="aseo-block">
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your name"
                  maxLength={80}
                  aria-label="Your name"
                  style={{ flex: "1 1 140px" }}
                />
                <input
                  value={contact}
                  onChange={(e) => setContact(e.target.value)}
                  placeholder="Phone or email"
                  maxLength={120}
                  aria-label="Your phone or email"
                  style={{ flex: "1 1 160px" }}
                />
              </div>
              <input
                value={detail}
                onChange={(e) => setDetail(e.target.value)}
                placeholder="Anything else we should know? (optional)"
                maxLength={300}
                aria-label="Extra detail"
                style={{ width: "100%", marginTop: 8 }}
              />
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                {mailto && (
                  <a href={mailto} className="btn btn-primary btn-sm">
                    <Send size={13} /> Send this quote
                  </a>
                )}
                {config.p && (
                  <a
                    href={`tel:${config.p.replace(/[^\d+]/g, "")}`}
                    className="btn btn-secondary btn-sm"
                  >
                    <Phone size={13} /> Call {config.p}
                  </a>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      <p style={{ fontSize: 11, color: "var(--faint)", marginTop: 12, textAlign: "center" }}>
        Instant quotes by{" "}
        <a href="https://automateiq.ie/freetools/quote-builder" target="_blank" rel="noreferrer">
          AutomateIQ
        </a>
      </p>
    </div>
  );
}
