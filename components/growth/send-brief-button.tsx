"use client";

import { useState, useTransition } from "react";
import { Mail } from "lucide-react";
import { sendBriefNow } from "@/app/growth/(app)/jarvis/actions";

/**
 * On-demand "email me my brief now" — the same email the 8am cron sends.
 * A tap-to-get fallback so a late/skipped Vercel Hobby cron never leaves
 * Jude without his morning brief.
 */
export function SendBriefButton() {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
      <button
        type="button"
        className="btn btn-secondary btn-sm"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setMsg(null);
            const res = await sendBriefNow().catch(() => ({
              ok: false,
              detail: "request failed — try again",
            }));
            setMsg(
              res.ok
                ? { ok: true, text: `Sent — check your inbox (${res.detail}).` }
                : { ok: false, text: `Couldn't send: ${res.detail}` }
            );
          })
        }
      >
        <Mail size={13} /> {pending ? "Sending…" : "Email me my brief now"}
      </button>
      {msg && (
        <span
          style={{
            fontSize: 12,
            color: msg.ok ? "var(--green, #34d399)" : "var(--orange, #fb923c)",
          }}
        >
          {msg.text}
        </span>
      )}
    </div>
  );
}
