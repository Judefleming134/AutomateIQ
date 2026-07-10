"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { researchOne } from "@/app/growth/(app)/prospects/actions";

export type QueueItem = { id: string; company: string };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * "Import, press one button, come back to a researched pipeline."
 * Runs research sequentially over every unresearched prospect — one request
 * per company (each gets the route's full time budget), a short pause
 * between calls to stay inside free-tier AI rate limits, and one automatic
 * retry per company before moving on. The tab must stay open while it runs.
 */
/** Two researches in flight at once: each call spends most of its life
 *  waiting on the website + the model, so pairing them roughly halves the
 *  batch without straining free-tier AI rate limits. */
const CONCURRENCY = 2;
/** One click researches at most this many. A big import (hundreds of leads)
 *  researched in one go would run for hours with the tab open and cost real
 *  money — so research goes in deliberate batches: run, work them, run the
 *  next batch. Keeps AI spend visible and the tab session short. */
const BATCH_SIZE = 40;

export function ResearchQueue({
  pending,
  totalPending,
  claude = false,
}: {
  /** A bounded working slice of unresearched prospects (the server sends a
   *  few hundred, not the whole database). */
  pending: QueueItem[];
  /** The TRUE number of unresearched prospects across every import batch —
   *  may be far larger than `pending.length`. Drives the count + "N still to
   *  go" copy so it stays accurate no matter how many were imported. */
  totalPending?: number;
  /** True when the server runs on the Anthropic key: no daily cap and no
   *  10-requests-per-minute wall, so the queue paces itself tighter. */
  claude?: boolean;
}) {
  // Observed per-company wall time (fetch + model + pacing), for the ETA.
  const SECONDS_PER_COMPANY = claude ? 35 : 40;
  const total = totalPending ?? pending.length;
  // This run researches at most BATCH_SIZE; the rest wait for the next click.
  const batch = pending.slice(0, BATCH_SIZE);
  const remaining = Math.max(0, total - batch.length);
  const idleGap = claude ? 600 : 1500;
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(0);
  const [active, setActive] = useState<string[]>([]);
  const [failures, setFailures] = useState<string[]>([]);
  const [finished, setFinished] = useState(false);
  const [pauseNote, setPauseNote] = useState<string | null>(null);
  const [stopReason, setStopReason] = useState<string | null>(null);
  // Frozen at run start: `batch` recomputes from live `pending` on every
  // router.refresh(), so it shrinks as prospects get researched — but the
  // running loop targets the batch captured at click-time. Use this fixed
  // total for the progress UI so the denominator can't fall below `done`
  // (which would show e.g. "40/10" and a >100% bar near the list's end).
  const [batchTotal, setBatchTotal] = useState(0);

  async function start() {
    setRunning(true);
    setFinished(false);
    setFailures([]);
    setDone(0);
    setStopReason(null);
    setPauseNote(null);
    setBatchTotal(batch.length);

    const failed: string[] = [];
    const inFlight = new Set<string>();
    let nextIndex = 0;
    let completed = 0;
    let stopped: string | null = null;
    // After the first rate-limit sighting, drop to one-at-a-time — hammering
    // a throttled API with two workers just doubles the failures.
    let throttled = false;

    const worker = async (stagger: number, workerIndex: number) => {
      await sleep(stagger);
      for (;;) {
        if (stopped) return;
        if (throttled && workerIndex > 0) return; // collapse to serial
        const i = nextIndex++;
        if (i >= batch.length) return;
        const p = batch[i];
        inFlight.add(p.company);
        setActive([...inFlight]);

        const tryOnce = () =>
          researchOne(p.id).catch(() => ({
            ok: false as const,
            error: "Network hiccup",
          }));

        let result = await tryOnce();
        let tries = 1;
        while (!result.ok && tries < 4 && !stopped) {
          const msg = result.error;
          if (/DAILY AI QUOTA/i.test(msg)) {
            stopped = msg;
            break;
          }
          const isThrottle = /rate limit|overloaded|429|quota/i.test(msg);
          if (isThrottle) throttled = true;
          const wait = isThrottle ? 65000 : 8000;
          setPauseNote(
            isThrottle
              ? `AI rate limit — paused ${Math.round(wait / 1000)}s, then retrying ${p.company} (attempt ${tries + 1}/4)…`
              : `Retrying ${p.company} (attempt ${tries + 1}/4)…`
          );
          await sleep(wait);
          setPauseNote(null);
          result = await tryOnce();
          tries++;
        }

        if (!result.ok && !stopped) {
          failed.push(`${p.company} — ${result.error}`);
          setFailures([...failed]);
        }
        if (result.ok) {
          // Success clears the throttle flag so speed recovers.
          throttled = false;
        }

        inFlight.delete(p.company);
        if (result.ok || !stopped) completed++;
        setActive([...inFlight]);
        setDone(completed);
        // Live update: the table's statuses, scores and dots refresh as each
        // company lands, not just at the end of the batch.
        router.refresh();
        if (stopped) return;
        await sleep(throttled ? 8000 : idleGap);
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, batch.length) }, (_, w) =>
        worker(w * 4000, w)
      )
    );

    setActive([]);
    setPauseNote(null);
    setRunning(false);
    setFinished(true);
    if (stopped) setStopReason(stopped);
    router.refresh();
  }

  if (total === 0 && !finished) return null;

  return (
    <div
      className="panel panel-block"
      style={{ marginBottom: 12, borderLeft: "3px solid var(--ac2, #3b82f6)" }}
    >
      {!running && !finished && (
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 260px" }}>
            <strong>
              {total} prospect{total === 1 ? "" : "s"} not researched yet
            </strong>
            <p style={{ fontSize: 12, color: "var(--faint)", margin: "4px 0 0" }}>
              Each run researches up to {BATCH_SIZE} — reports, solution
              recommendations, lead scores and outreach drafts. This batch:{" "}
              {batch.length} prospect{batch.length === 1 ? "" : "s"}, roughly{" "}
              {Math.ceil((batch.length * SECONDS_PER_COMPANY) / 60 / CONCURRENCY)}{" "}
              min — keep this tab open while it runs.
              {remaining > 0
                ? ` The other ${remaining} wait for the next click, so you research in controlled batches (and watch the AI spend).`
                : ""}
            </p>
          </div>
          <button type="button" className="btn btn-primary" onClick={start}>
            <Sparkles size={14} />{" "}
            {remaining > 0
              ? `Research next ${batch.length}`
              : `Research all ${batch.length}`}
          </button>
        </div>
      )}

      {running && (
        <div>
          <strong>
            Researching {done}/{batchTotal}
            {active.length > 0 ? ` — working on ${active.join(" + ")}…` : "…"}
          </strong>
          <span style={{ fontSize: 12, color: "var(--faint)", marginLeft: 8 }}>
            ≈{" "}
            {Math.max(
              1,
              Math.ceil(((batchTotal - done) * SECONDS_PER_COMPANY) / 60 / CONCURRENCY)
            )}{" "}
            min left
          </span>
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
            aria-valuemax={batchTotal}
          >
            <div
              style={{
                width: `${Math.round((done / Math.max(1, batchTotal)) * 100)}%`,
                height: "100%",
                background: "var(--ac2, #3b82f6)",
                transition: "width .4s",
              }}
            />
          </div>
          <p style={{ fontSize: 12, color: "var(--faint)", margin: "6px 0 0" }}>
            {pauseNote ?? "Keep this tab open. You can work in another tab meanwhile."}
          </p>
        </div>
      )}

      {finished && (
        <div>
          {stopReason ? (
            <strong style={{ color: "var(--orange, #fb923c)" }}>
              ⏸ Batch stopped after {done}/{batchTotal}: {stopReason}
            </strong>
          ) : (
            <strong style={{ color: "var(--green, #34d399)" }}>
              ✓ Batch finished — {done - failures.length}/{batchTotal} researched
              {remaining > 0
                ? ` · ${remaining} still to go — reload and click for the next batch`
                : ""}
            </strong>
          )}
          {stopReason && (
            <p style={{ fontSize: 12, color: "var(--faint)", margin: "6px 0 0" }}>
              The remaining prospects are untouched — reload this page and the
              button will offer them again once the quota resets.
            </p>
          )}
          {failures.length > 0 && (
            <div style={{ fontSize: 12, color: "var(--faint)", marginTop: 6 }}>
              Couldn&apos;t research (reload the page and run the batch again —
              only these will be retried):
              {failures.map((f) => (
                <div key={f}>· {f}</div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
