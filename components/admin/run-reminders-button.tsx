"use client";

import { useState } from "react";
import { Play } from "lucide-react";
import { runReminderSweep, type SweepResult } from "@/app/admin/actions";

export function RunRemindersButton() {
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<SweepResult | null>(null);

  async function handleRun() {
    setPending(true);
    setResult(null);
    const res = await runReminderSweep();
    setResult(res);
    setPending(false);
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
      <button
        type="button"
        className="btn btn-secondary"
        onClick={handleRun}
        disabled={pending}
      >
        <Play size={14} />
        {pending ? "Running…" : "Run reminder sweep"}
      </button>
      {result &&
        (result.ok ? (
          <span style={{ fontSize: 13, color: "var(--green)" }}>
            ✓ {result.claimed} due · {result.sent} sent
            {result.failed > 0 ? ` · ${result.failed} failed` : ""}
          </span>
        ) : (
          <span className="login-error" style={{ margin: 0 }}>
            {result.error}
          </span>
        ))}
    </div>
  );
}
