"use client";

import { useState } from "react";
import { ChevronDown, Check } from "lucide-react";
import { SystemIcon } from "@/lib/systems/icons";
import type { BusinessSystem } from "@/lib/systems/catalog";

/**
 * Interactive showcase card for one bespoke business system. The feature list
 * expands on demand — kept collapsed by default so the page reads as a set of
 * capabilities, not a fixed product spec.
 */
export function SystemCard({ system }: { system: BusinessSystem }) {
  const [open, setOpen] = useState(false);

  return (
    <article className="sys-card panel" style={{ "--sys-accent": system.accent } as React.CSSProperties}>
      <div className="sys-card-top">
        <span className="sys-card-icon"><SystemIcon name={system.icon} size={24} /></span>
        <div>
          <h3>{system.name}</h3>
          <p className="sys-card-tagline">{system.tagline}</p>
        </div>
      </div>

      <p className="sys-card-overview">{system.overview}</p>

      <div className="sys-card-benefits">
        {system.benefits.map((b) => (
          <span key={b} className="sys-benefit"><Check size={13} /> {b}</span>
        ))}
      </div>

      <button
        type="button"
        className={`sys-card-toggle ${open ? "is-open" : ""}`}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? "Hide capabilities" : "Explore capabilities"}
        <ChevronDown size={15} />
      </button>

      {open && (
        <div className="sys-card-detail">
          <p className="sys-card-detail-label">Example capabilities</p>
          <ul className="sys-feature-list">
            {system.features.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
          <p className="sys-card-note">
            Illustrative only — every capability is designed, extended and integrated around your
            exact operation.
          </p>
        </div>
      )}

      <div className="sys-card-industries">
        <span className="sys-industries-label">Suited to</span>
        {system.industries.map((i) => (
          <span key={i} className="sys-industry-chip">{i}</span>
        ))}
      </div>
    </article>
  );
}
