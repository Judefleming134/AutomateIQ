"use client";

import { useState } from "react";
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
  const [current, setCurrent] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);

  if (pending.length === 0 && !summary) return null;

  async function start() {
    setRunning(true);
    setSummary(null);
    setDone(0);
    let enriched = 0;
    for (let i = 0; i < pending.length; i++) {
      const p = pending[i];
      setCurrent(p.company);
      const res = await harvestOne(p.id).catch(() => null);
      if (res && res.ok && !/nothing new|unreachable/.test(res.found)) enriched++;
      setDone(i + 1);
      await sleep(300);
    }
    setCurrent(null);
    setRunning(false);
    setSummary(
      `✓ Checked ${pending.length} website${pending.length === 1 ? "" : "s"} — found new contact details for ${enriched}.`
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
          <strong>
            Checking {done}/{pending.length}
            {current ? ` — ${current}…` : "…"}
          </strong>
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
                background: "var(--ac1, #8b5cf6)",
                transition: "width .3s",
              }}
            />
          </div>
        </div>
      )}
      {summary && !running && (
        <strong style={{ color: "var(--green, #34d399)" }}>{summary}</strong>
      )}
    </div>
  );
}
