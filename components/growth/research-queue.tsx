"use client";

import { useRef, useState } from "react";
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
  failedRecently = [],
  failedTotal,
  claude = false,
}: {
  /** A bounded working slice of unresearched prospects (the server sends a
   *  few hundred, not the whole database). Server-sorted: fresh leads first,
   *  recently-failed ones parked at the back. */
  pending: QueueItem[];
  /** The TRUE number of unresearched prospects across every import batch —
   *  may be far larger than `pending.length`. Drives the count + "N still to
   *  go" copy so it stays accurate no matter how many were imported. */
  totalPending?: number;
  /** Leads parked in the research_failed group — completely separate from
   *  fresh batches; retryable here or bulk archive/delete via the table's
   *  Status filter. */
  failedRecently?: QueueItem[];
  /** True size of the failed group (the list above is a bounded slice). */
  failedTotal?: number;
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
  // Mirrors the loop-local `throttled` flag into render state ONLY so the
  // "min left" estimate can reflect that the queue collapsed to serial after
  // a rate-limit — otherwise the ETA reads ~half the real remaining time
  // during exactly the batch a user is anxiously watching.
  const [throttledUi, setThrottledUi] = useState(false);
  // Frozen at run start: `batch` recomputes from live `pending` on every
  // router.refresh(), so it shrinks as prospects get researched — but the
  // running loop targets the batch captured at click-time. Use this fixed
  // total for the progress UI so the denominator can't fall below `done`
  // (which would show e.g. "40/10" and a >100% bar near the list's end).
  const [batchTotal, setBatchTotal] = useState(0);
  // A ref, not state: workers read it mid-loop, and state would be stale
  // inside their closures. Set by the Stop button; workers exit cleanly
  // after the company they're on (nothing half-written).
  const stopRequested = useRef(false);

  async function start(itemsOverride?: QueueItem[]) {
    // Default run = the next fresh batch; a retry run passes the failed list.
    const items = itemsOverride ?? batch;
    stopRequested.current = false;
    setRunning(true);
    setFinished(false);
    setFailures([]);
    setDone(0);
    setStopReason(null);
    setPauseNote(null);
    setThrottledUi(false);
    setBatchTotal(items.length);

    const failed: string[] = [];
    const inFlight = new Set<string>();
    let nextIndex = 0;
    let completed = 0;
    let stopped: string | null = null;
    // After the first rate-limit sighting, drop to one-at-a-time — hammering
    // a throttled API with two workers just doubles the failures.
    let throttled = false;
    // Circuit breaker: when EVERY company is failing the problem is systemic
    // (dead API key, provider outage, quota) — grinding through the rest of
    // the batch wastes minutes and teaches nothing. Track the failure streak
    // and the most common error so the stop message says the real reason.
    let successCount = 0;
    let failStreak = 0;
    const errorTally = new Map<string, number>();
    const topError = () =>
      [...errorTally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ??
      "unknown error";

    const worker = async (stagger: number, workerIndex: number) => {
      await sleep(stagger);
      for (;;) {
        if (stopped) return;
        if (stopRequested.current) return; // user pressed Stop — take no new work
        if (throttled && workerIndex > 0) return; // collapse to serial
        const i = nextIndex++;
        if (i >= items.length) return;
        const p = items[i];
        inFlight.add(p.company);
        setActive([...inFlight]);

        const tryOnce = () =>
          researchOne(p.id).catch(() => ({
            ok: false as const,
            error: "Network hiccup",
          }));

        let result = await tryOnce();
        let tries = 1;
        let lastError = "";
        while (!result.ok && tries < 4 && !stopped) {
          const msg = result.error;
          // Account-level failures kill the WHOLE batch on first sighting —
          // zero retries, zero further attempts, nothing burned.
          if (/DAILY AI QUOTA|AI CREDITS EMPTY/i.test(msg)) {
            stopped = msg;
            break;
          }
          const isThrottle = /rate limit|overloaded|429|quota/i.test(msg);
          if (isThrottle) {
            throttled = true;
            setThrottledUi(true);
          }
          // A 4xx is a rejected request — retrying the identical request
          // can never succeed. Fail immediately, move on.
          if (!isThrottle && /\(HTTP 4\d\d/.test(msg)) break;
          // Same non-throttle error twice in a row = it won't fix itself by
          // retrying (bad key, broken site) — fail fast, move on.
          if (!isThrottle && msg === lastError) break;
          lastError = msg;
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
          failStreak++;
          errorTally.set(result.error, (errorTally.get(result.error) ?? 0) + 1);
          // Break the circuit: 6 failures with zero successes, or a 10-long
          // streak mid-batch, means the problem is systemic — stop, say why,
          // and leave the rest of the batch untouched for the retry.
          if ((successCount === 0 && failStreak >= 6) || failStreak >= 10) {
            stopped = `every attempt is failing (${topError()}) — stopped early so the rest of the batch isn't wasted. The leads are all still in the queue.`;
          }
        }
        if (result.ok) {
          // Success clears the throttle flag so speed recovers.
          throttled = false;
          setThrottledUi(false);
          successCount++;
          failStreak = 0;
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
      Array.from({ length: Math.min(CONCURRENCY, items.length) }, (_, w) =>
        worker(w * 4000, w)
      )
    );

    setActive([]);
    setPauseNote(null);
    setRunning(false);
    setFinished(true);
    if (stopped) setStopReason(stopped);
    else if (stopRequested.current) {
      setStopReason(
        "stopped by you — everything already researched is saved, and the rest of the batch stays queued for the next click."
      );
    }
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
          <button type="button" className="btn btn-primary" onClick={() => start()}>
            <Sparkles size={14} />{" "}
            {remaining > 0
              ? `Research next ${batch.length}`
              : `Research all ${batch.length}`}
          </button>
        </div>
      )}

      {!running && failedRecently.length > 0 && (
        <div
          style={{
            marginTop: finished || total > 0 ? 12 : 0,
            paddingTop: 10,
            borderTop: "1px solid rgba(255,255,255,.08)",
            fontSize: 12,
            color: "var(--faint)",
          }}
        >
          <strong style={{ color: "var(--orange, #fb923c)" }}>
            ⚠ {failedTotal ?? failedRecently.length} in the Research-failed
            group
          </strong>{" "}
          — completely separate from fresh batches; each prospect&apos;s
          timeline says why. Retry them here, or{" "}
          <a href="/growth/prospects?status=research_failed">
            open the group in the list
          </a>{" "}
          to tick and bulk archive/delete. First few:{" "}
          {failedRecently
            .slice(0, 6)
            .map((f) => f.company)
            .join(", ")}
          {(failedTotal ?? failedRecently.length) > 6
            ? `, +${(failedTotal ?? failedRecently.length) - 6} more`
            : ""}
          <div style={{ marginTop: 8 }}>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => start(failedRecently.slice(0, BATCH_SIZE))}
            >
              <Sparkles size={13} /> Retry {Math.min(failedRecently.length, BATCH_SIZE)} failed
            </button>
          </div>
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
              Math.ceil(
                ((batchTotal - done) * SECONDS_PER_COMPANY) /
                  60 /
                  // Rate-limited runs go one-at-a-time, so the estimate must
                  // stop assuming two lanes or it reads ~half the real time.
                  (throttledUi ? 1 : CONCURRENCY)
              )
            )}{" "}
            min left{throttledUi ? " (rate-limited — going slower)" : ""}
          </span>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            style={{ marginLeft: 10 }}
            onClick={() => {
              stopRequested.current = true;
            }}
          >
            Stop after these finish
          </button>
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
          ) : failures.length >= batchTotal && batchTotal > 0 ? (
            <strong style={{ color: "var(--orange, #fb923c)" }}>
              ✗ 0 of {batchTotal} researched — every attempt failed. Nothing
              was lost: all {total} leads are still queued. Check the first
              failure reason below; it&apos;s almost always the AI provider
              (quota, key or rate limit), not your leads.
            </strong>
          ) : (
            <strong style={{ color: "var(--green, #34d399)" }}>
              ✓ Batch finished — {done - failures.length}/{batchTotal} researched
              (now scored in the list below, best drafts on the autopilot)
              {total > 0 ? ` · ${total} still to research` : " · all done 🎉"}
            </strong>
          )}
          {stopReason && (
            <p style={{ fontSize: 12, color: "var(--faint)", margin: "6px 0 0" }}>
              The remaining prospects are untouched — once the quota resets,
              the button below will offer them again.
            </p>
          )}
          {failures.length > 0 && (
            <div style={{ fontSize: 12, color: "var(--faint)", marginTop: 6 }}>
              Couldn&apos;t research (they stay in the queue — the next batch
              retries them):
              {failures.slice(0, 8).map((f) => (
                <div key={f}>· {f}</div>
              ))}
              {failures.length > 8 && (
                <div>
                  · …and {failures.length - 8} more with the same kind of
                  failure.
                </div>
              )}
            </div>
          )}
          {batch.length > 0 && (
            // The list already refreshed (router.refresh() ran at batch end),
            // so `batch` here is the NEXT unresearched slice — researched ones
            // have dropped out. One click continues; no page reload needed.
            <div style={{ marginTop: 10 }}>
              <button type="button" className="btn btn-primary" onClick={() => start()}>
                <Sparkles size={14} /> Research next {batch.length}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
