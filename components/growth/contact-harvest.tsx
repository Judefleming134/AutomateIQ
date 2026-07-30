"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AtSign } from "lucide-react";
import { harvestOne } from "@/app/growth/(app)/prospects/actions";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type WakeSentinel = { release: () => Promise<void> } | null;

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

  // Screen Wake Lock, same pattern as the research queue: without it a phone
  // locking mid-run suspends the tab and the harvest silently stalls — the
  // exact failure mode that plagued mobile research runs.
  const wakeLock = useRef<WakeSentinel>(null);
  const acquireWakeLock = async () => {
    try {
      const nav = navigator as Navigator & {
        wakeLock?: { request: (t: "screen") => Promise<WakeSentinel> };
      };
      if (nav.wakeLock && !wakeLock.current) {
        wakeLock.current = await nav.wakeLock.request("screen");
      }
    } catch {
      // Unsupported/denied — the run still works with the screen kept awake.
    }
  };
  const releaseWakeLock = () => {
    void wakeLock.current?.release().catch(() => {});
    wakeLock.current = null;
  };
  // The OS drops the lock when the tab hides; re-acquire on return mid-run.
  useEffect(() => {
    if (!running) return;
    const onVisible = () => {
      if (document.visibilityState === "visible") void acquireWakeLock();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [running]);

  if (pending.length === 0 && !summary) return null;

  async function start() {
    const items = pending; // freeze the list for this run
    stopRequested.current = false;
    void acquireWakeLock(); // keep the screen awake so the tab can't freeze
    setRunning(true);
    setSummary(null);
    setDone(0);
    setTotal(items.length);
    let enriched = 0;
    let checked = 0;
    let failed = 0;
    let succeeded = 0;
    let broke: string | null = null;
    // try/finally so a throw can never leave the button stuck on "Checking…"
    // with the screen wake lock held (same guard as the research queue).
    try {
      for (let i = 0; i < items.length; i++) {
        if (stopRequested.current) break; // finish cleanly after the current site
        const p = items[i];
        setCurrent(p.company);
        const res = await harvestOne(p.id).catch(() => null);
        // A failure USED TO BE swallowed silently and still counted as
        // "checked". So if every call failed — expired session, network down, a
        // deploy mid-run — the run ground through all 100 prospects doing
        // nothing and finished with "✓ Checked 100 websites — found new contact
        // details for 0". Jude would reasonably conclude those 100 leads have no
        // findable email and move on, when in fact not one was ever read. Never
        // report success for work that didn't happen.
        if (!res || !res.ok) failed++;
        else {
          succeeded++;
          if (!/nothing new|unreachable/.test(res.found)) enriched++;
        }
        checked = i + 1;
        setDone(i + 1);
        // Circuit breaker, same reasoning as the research queue's: five
        // failures with ZERO successes means the problem is systemic, not the
        // websites. Stop rather than burn minutes proving it 95 more times.
        if (succeeded === 0 && failed >= 5) {
          broke = `couldn't reach the finder for the first ${failed} — stopped early. Nothing was checked, so these leads are all still queued; try again in a moment.`;
          break;
        }
        await sleep(300);
      }
    } finally {
      setCurrent(null);
      releaseWakeLock();
      setRunning(false);
      // Only claim a clean run when nothing failed. Otherwise say plainly how
      // many couldn't be read, so a zero-result run is never mistaken for
      // "these leads genuinely have no email".
      if (broke) {
        setSummary(`⚠ ${broke}`);
      } else if (failed > 0) {
        setSummary(
          `Checked ${checked - failed} of ${checked} website${checked === 1 ? "" : "s"} — found new contact details for ${enriched}. ${failed} couldn't be read (no website on file, or the site didn't respond).`
        );
      } else {
        setSummary(
          `${stopRequested.current ? "Stopped — checked" : "✓ Checked"} ${checked} website${checked === 1 ? "" : "s"} — found new contact details for ${enriched}.`
        );
      }
      router.refresh();
    }
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
