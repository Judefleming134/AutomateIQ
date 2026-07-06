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
/** Observed per-company wall time (fetch + model + pacing), for the ETA. */
const SECONDS_PER_COMPANY = 40;

export function ResearchQueue({ pending }: { pending: QueueItem[] }) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(0);
  const [active, setActive] = useState<string[]>([]);
  const [failures, setFailures] = useState<string[]>([]);
  const [finished, setFinished] = useState(false);

  async function start() {
    setRunning(true);
    setFinished(false);
    setFailures([]);
    setDone(0);

    const failed: string[] = [];
    const inFlight = new Set<string>();
    let nextIndex = 0;
    let completed = 0;

    const worker = async (stagger: number) => {
      await sleep(stagger);
      for (;;) {
        const i = nextIndex++;
        if (i >= pending.length) return;
        const p = pending[i];
        inFlight.add(p.company);
        setActive([...inFlight]);

        let result = await researchOne(p.id).catch(() => ({
          ok: false as const,
          error: "Network hiccup",
        }));
        if (!result.ok) {
          // One retry after a breather — free-tier rate limits recover fast.
          await sleep(8000);
          result = await researchOne(p.id).catch(() => ({
            ok: false as const,
            error: "Network hiccup",
          }));
        }
        if (!result.ok) {
          failed.push(`${p.company} — ${result.error}`);
          setFailures([...failed]);
        }

        inFlight.delete(p.company);
        completed++;
        setActive([...inFlight]);
        setDone(completed);
        // Live update: the table's statuses, scores and dots refresh as each
        // company lands, not just at the end of the batch.
        router.refresh();
        await sleep(1500);
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, pending.length) }, (_, w) =>
        worker(w * 4000)
      )
    );

    setActive([]);
    setRunning(false);
    setFinished(true);
    router.refresh();
  }

  if (pending.length === 0 && !finished) return null;

  return (
    <div
      className="panel panel-block"
      style={{ marginBottom: 12, borderLeft: "3px solid var(--ac2, #3b82f6)" }}
    >
      {!running && !finished && (
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 260px" }}>
            <strong>
              {pending.length} prospect{pending.length === 1 ? "" : "s"} not researched yet
            </strong>
            <p style={{ fontSize: 12, color: "var(--faint)", margin: "4px 0 0" }}>
              Research them all in one go — reports, solution recommendations,
              lead scores and outreach drafts for every one. Roughly{" "}
              {Math.ceil((pending.length * SECONDS_PER_COMPANY) / 60 / CONCURRENCY)}{" "}
              min for the batch (two at a time); keep this tab open while it
              runs.
            </p>
          </div>
          <button type="button" className="btn btn-primary" onClick={start}>
            <Sparkles size={14} /> Research all {pending.length}
          </button>
        </div>
      )}

      {running && (
        <div>
          <strong>
            Researching {done}/{pending.length}
            {active.length > 0 ? ` — working on ${active.join(" + ")}…` : "…"}
          </strong>
          <span style={{ fontSize: 12, color: "var(--faint)", marginLeft: 8 }}>
            ≈{" "}
            {Math.max(
              1,
              Math.ceil(((pending.length - done) * SECONDS_PER_COMPANY) / 60 / CONCURRENCY)
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
            aria-valuemax={pending.length}
          >
            <div
              style={{
                width: `${Math.round((done / pending.length) * 100)}%`,
                height: "100%",
                background: "var(--ac2, #3b82f6)",
                transition: "width .4s",
              }}
            />
          </div>
          <p style={{ fontSize: 12, color: "var(--faint)", margin: "6px 0 0" }}>
            Keep this tab open. You can work in another tab meanwhile.
          </p>
        </div>
      )}

      {finished && (
        <div>
          <strong style={{ color: "var(--green, #34d399)" }}>
            ✓ Batch finished — {pending.length - failures.length}/{pending.length} researched
          </strong>
          {failures.length > 0 && (
            <div style={{ fontSize: 12, color: "var(--faint)", marginTop: 6 }}>
              Couldn&apos;t research (open them individually and press Research
              company):
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
