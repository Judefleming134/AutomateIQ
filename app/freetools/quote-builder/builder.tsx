"use client";

import { useMemo, useState } from "react";
import { ToolLeadForm } from "@/components/tools/tool-lead-form";
import { Check, Copy, Plus, Trash2 } from "lucide-react";
import { encodeQuoteConfig, quoteConfigSchema, type QuoteConfig } from "@/lib/tools/quote-config";
import { QuoteWidget } from "./widget";

const SITE = "https://automateiq.ie";

const STARTER: QuoteConfig = {
  b: "Murphy Plumbing",
  e: "",
  p: "",
  base: 60,
  s: [
    { n: "Blocked drain", p: 90, k: "f", u: "" },
    { n: "Radiator fitted", p: 75, k: "u", u: "radiator" },
    { n: "Bathroom refit", p: 2400, k: "f", u: "" },
  ],
  m: [
    { n: "Out of hours", pct: 50 },
    { n: "Same day", pct: 25 },
  ],
  note: "Estimate only — final price confirmed after a look at the job.",
};

export function QuoteBuilder() {
  const [cfg, setCfg] = useState<QuoteConfig>(STARTER);
  const [copied, setCopied] = useState<"" | "url" | "code">("");

  const valid = useMemo(() => quoteConfigSchema.safeParse(cfg), [cfg]);
  const embedUrl = useMemo(
    // /embed/* deliberately sits outside the /tools layout — the widget renders
    // inside a customer's own website, so it must carry no header or nav of ours.
    () => (valid.success ? `${SITE}/embed/quote?c=${encodeQuoteConfig(valid.data)}` : ""),
    [valid]
  );
  const snippet = embedUrl
    ? `<iframe src="${embedUrl}"
        style="width:100%;max-width:560px;height:760px;border:0"
        title="Instant quote"
        loading="lazy"></iframe>`
    : "";

  const copy = async (text: string, which: "url" | "code") => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(which);
      setTimeout(() => setCopied(""), 2000);
    } catch {
      setCopied("");
    }
  };

  const setService = (i: number, patch: Partial<QuoteConfig["s"][number]>) =>
    setCfg((c) => ({ ...c, s: c.s.map((s, j) => (j === i ? { ...s, ...patch } : s)) }));

  return (
    <div className="grid-main-side" style={{ gap: 20, alignItems: "start" }}>
      {/* ---- left: the settings ---- */}
      <div>
        <p className="aseo-step-label">1. Your details</p>
        <div className="panel panel-block">
          <label htmlFor="qb-b">Business name</label>
          <input
            id="qb-b"
            value={cfg.b}
            maxLength={60}
            onChange={(e) => setCfg((c) => ({ ...c, b: e.target.value }))}
          />
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
            <div style={{ flex: "1 1 200px" }}>
              <label htmlFor="qb-e">Where quotes should go</label>
              <input
                id="qb-e"
                value={cfg.e}
                maxLength={120}
                placeholder="you@yourbusiness.ie"
                onChange={(e) => setCfg((c) => ({ ...c, e: e.target.value }))}
              />
            </div>
            <div style={{ flex: "1 1 140px" }}>
              <label htmlFor="qb-p">Phone (optional)</label>
              <input
                id="qb-p"
                value={cfg.p}
                maxLength={32}
                placeholder="085 123 4567"
                onChange={(e) => setCfg((c) => ({ ...c, p: e.target.value }))}
              />
            </div>
          </div>
          <label htmlFor="qb-base" style={{ marginTop: 10, display: "block" }}>
            Call-out fee added to every quote (€)
          </label>
          <input
            id="qb-base"
            type="number"
            min={0}
            max={100000}
            value={cfg.base}
            onChange={(e) => setCfg((c) => ({ ...c, base: Math.max(0, Number(e.target.value) || 0) }))}
          />
        </div>

        <p className="aseo-step-label">2. What you charge</p>
        <div className="panel panel-block">
          {cfg.s.map((s, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                gap: 6,
                flexWrap: "wrap",
                alignItems: "flex-end",
                paddingBottom: 10,
                marginBottom: 10,
                borderBottom: "1px solid var(--line)",
              }}
            >
              <div style={{ flex: "2 1 150px" }}>
                <label htmlFor={`qb-s-${i}`} style={{ fontSize: 12 }}>
                  Service
                </label>
                <input
                  id={`qb-s-${i}`}
                  value={s.n}
                  maxLength={60}
                  onChange={(e) => setService(i, { n: e.target.value })}
                />
              </div>
              <div style={{ flex: "1 1 80px" }}>
                <label htmlFor={`qb-p-${i}`} style={{ fontSize: 12 }}>
                  Price €
                </label>
                <input
                  id={`qb-p-${i}`}
                  type="number"
                  min={0}
                  value={s.p}
                  onChange={(e) => setService(i, { p: Math.max(0, Number(e.target.value) || 0) })}
                />
              </div>
              <div style={{ flex: "1 1 110px" }}>
                <label htmlFor={`qb-k-${i}`} style={{ fontSize: 12 }}>
                  Priced
                </label>
                <select
                  id={`qb-k-${i}`}
                  value={s.k}
                  onChange={(e) => setService(i, { k: e.target.value as "u" | "f" })}
                >
                  <option value="f">Fixed</option>
                  <option value="u">Per unit</option>
                </select>
              </div>
              {s.k === "u" && (
                <div style={{ flex: "1 1 90px" }}>
                  <label htmlFor={`qb-u-${i}`} style={{ fontSize: 12 }}>
                    Unit
                  </label>
                  <input
                    id={`qb-u-${i}`}
                    value={s.u}
                    maxLength={20}
                    placeholder="hour"
                    onChange={(e) => setService(i, { u: e.target.value })}
                  />
                </div>
              )}
              {cfg.s.length > 1 && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  aria-label={`Remove ${s.n || "service"}`}
                  onClick={() => setCfg((c) => ({ ...c, s: c.s.filter((_, j) => j !== i) }))}
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          ))}
          {cfg.s.length < 12 && (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() =>
                setCfg((c) => ({ ...c, s: [...c.s, { n: "", p: 0, k: "f" as const, u: "" }] }))
              }
            >
              <Plus size={13} /> Add a service
            </button>
          )}
        </div>

        <p className="aseo-step-label">3. Price adjustments (optional)</p>
        <div className="panel panel-block">
          {cfg.m.map((m, i) => (
            <div key={i} style={{ display: "flex", gap: 6, alignItems: "flex-end", marginBottom: 8 }}>
              <div style={{ flex: "2 1 140px" }}>
                <input
                  value={m.n}
                  maxLength={60}
                  aria-label="Adjustment name"
                  onChange={(e) =>
                    setCfg((c) => ({
                      ...c,
                      m: c.m.map((x, j) => (j === i ? { ...x, n: e.target.value } : x)),
                    }))
                  }
                />
              </div>
              <div style={{ flex: "1 1 70px" }}>
                <input
                  type="number"
                  min={-90}
                  max={300}
                  value={m.pct}
                  aria-label="Percentage"
                  onChange={(e) =>
                    setCfg((c) => ({
                      ...c,
                      m: c.m.map((x, j) => (j === i ? { ...x, pct: Number(e.target.value) || 0 } : x)),
                    }))
                  }
                />
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                aria-label={`Remove ${m.n || "adjustment"}`}
                onClick={() => setCfg((c) => ({ ...c, m: c.m.filter((_, j) => j !== i) }))}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          {cfg.m.length < 6 && (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setCfg((c) => ({ ...c, m: [...c.m, { n: "", pct: 25 }] }))}
            >
              <Plus size={13} /> Add an adjustment
            </button>
          )}
        </div>

        <p className="aseo-step-label">4. Put it on your site</p>
        <div className="panel panel-block">
          {!valid.success ? (
            <p style={{ color: "var(--orange, #fb923c)", fontSize: 13.5, margin: 0 }}>
              Fill in a business name and at least one service with a name, and the embed
              code appears here.
            </p>
          ) : (
            <>
              <p style={{ fontSize: 13.5, margin: "0 0 10px", color: "var(--faint)" }}>
                Paste this wherever you want the quote form to appear. Works on
                WordPress, Wix, Squarespace, Shopify — anywhere you can add HTML.
              </p>
              <div className="aseo-code-head">
                <span className="aseo-block-label" style={{ margin: 0 }}>
                  Embed code
                </span>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => copy(snippet, "code")}
                >
                  {copied === "code" ? <Check size={13} /> : <Copy size={13} />}{" "}
                  {copied === "code" ? "Copied" : "Copy"}
                </button>
              </div>
              <pre className="aseo-code">
                <code>{snippet}</code>
              </pre>
              <div className="aseo-code-head" style={{ marginTop: 12 }}>
                <span className="aseo-block-label" style={{ margin: 0 }}>
                  Or just share the link
                </span>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => copy(embedUrl, "url")}
                >
                  {copied === "url" ? <Check size={13} /> : <Copy size={13} />}{" "}
                  {copied === "url" ? "Copied" : "Copy link"}
                </button>
              </div>
              <p style={{ fontSize: 12, color: "var(--faint)", margin: "8px 0 0" }}>
                Your settings live inside that link, so there&apos;s no account and nothing
                to log into — but it also means anyone with the link can read your prices.
                Only put prices in here that you&apos;re happy to publish. Changed your
                mind on pricing? Edit above and paste the new code.
              </p>
            </>
          )}
        </div>
      </div>

      {/* ---- right: live preview ---- */}
      <div>
        <p className="aseo-step-label">Live preview</p>
        <div className="panel panel-block">
          {valid.success ? (
            <QuoteWidget config={valid.data} />
          ) : (
            <p style={{ color: "var(--faint)", fontSize: 13.5, margin: 0 }}>
              Add a business name and a service to see the preview.
            </p>
          )}
        </div>
      </div>
    {valid.success && (
        <ToolLeadForm
          tool="quote-builder"
          subject={valid.data.b}
          headline={`${valid.data.s.length} service${valid.data.s.length === 1 ? "" : "s"} priced`}
          title="Want us to put it on your site?"
          blurb="Leave your email and we'll send the code with instructions — or we'll install it and wire the quotes into your inbox for you."
        />
      )}
    </div>
  );
}
