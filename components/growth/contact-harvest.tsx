"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AtSign } from "lucide-react";
import { harvestOne } from "@/app/growth/(app)/prospects/actions";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * One-button backfill: reads each listed prospect's website and fills blank
 * email/phone/social fields. No AI involved — just fetching pages — so it's
 * free and fast (~2s per site). Exists to enrich leads researched before
 * automatic contact harvesting shipped; new research does this by itself.
 */
export function ContactHarvest({
  pending,
}: {
  pending: { id: string; company: string }[];
}) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(0);
  // Snapshot of the batch size taken when the run starts — the `pending`
  // prop can shrink mid-run as found emails drop rows out of the server
  // query, which made the live denominator wrong (e.g. "64/40").
  const [total, setTotal] = useState(0);
  const [current, setCurrent] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  // A ref, not state: the running loop reads it between sites, and a state
  // value would be stale inside the loop's closure.
  const stopRequested = useRef(false);

  if (pending.length === 0 && !summary) return null;

  async function start() {
    const items = pending; // freeze the list for this run
    stopRequested.current = false;
    setRunning(true);
    setSummary(null);
    setDone(0);
    setTotal(items.length);
    let enriched = 0;
    let checked = 0;
    for (let i = 0; i < items.length; i++) {
      if (stopRequested.current) break; // finish cleanly after the current site
      const p = items[i];
      setCurrent(p.company);
      const res = await harvestOne(p.id).catch(() => null);
      checked = i + 1;
      if (res && res.ok && !/nothing new|unreachable/.test(res.found)) enriched++;
      setDone(i + 1);
      await sleep(300);
    }
    setCurrent(null);
    setRunning(false);
    setSummary(
      `${stopRequested.current ? "Stopped — checked" : "✓ Checked"} ${checked} website${checked === 1 ? "" : "s"} — found new contact details for ${enriched}.`
    );
    router.refresh();
  }

  return (
    <div
      className="panel panel-block"
      style={{ marginBottom: 12, borderLeft: "3px solid var(--ac1, #8b5cf6)" }}
    >
      {!running && !summary && (
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 260px" }}>
            <strong>
              {pending.length} prospect{pending.length === 1 ? "" : "s"} missing an
              email address
            </strong>
            <p style={{ fontSize: 12, color: "var(--faint)", margin: "4px 0 0" }}>
              One click reads their websites and pulls emails, phone numbers and
              Instagram/Facebook/LinkedIn links into the CRM. No AI usage —
              takes about {Math.max(1, Math.ceil((pending.length * 2.5) / 60))}{" "}
              min. Feeds the email autopilot and Jarvis&apos;s DM lists.
            </p>
          </div>
          <button type="button" className="btn btn-secondary" onClick={start}>
            <AtSign size={14} /> Find emails &amp; socials
          </button>
        </div>
      )}
      {running && (
        <div>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <strong style={{ flex: "1 1 200px" }}>
              Checking {done}/{total}
              {current ? ` — ${current}…` : "…"}
            </strong>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                stopRequested.current = true;
              }}
            >
              Stop after this one
            </button>
          </div>
          <div
            style={{
              marginTop: 8,
              height: 6,
              borderRadius: 3,
              background: "rgba(255,255,255,.08)",
              overflow: "hidden",
            }}
            role="progressbar"
            aria-valuenow={done}
            aria-valuemax={total}
          >
            <div
              style={{
                width: `${total > 0 ? Math.round((done / total) * 100) : 0}%`,
                height: "100%",
                background: "var(--ac1, #8b5cf6)",
                transition: "width .3s",
              }}
            />
          </div>
        </div>
      )}
      {summary && !running && (
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <strong style={{ color: "var(--green, #34d399)" }}>{summary}</strong>
          {pending.length > 0 && (
            // The list refreshed at run end, so `pending` is the NEXT slice of
            // prospects still missing an email — continue without a reload.
            <button type="button" className="btn btn-secondary btn-sm" onClick={start}>
              <AtSign size={13} /> Check next {pending.length}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
