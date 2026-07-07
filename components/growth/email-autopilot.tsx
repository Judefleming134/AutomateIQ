"use client";

import { useActionState, useEffect, useState } from "react";
import { Mail, Rocket, Clock, RefreshCw } from "lucide-react";
import {
  autopilotAction,
  regenerateFlaggedDrafts,
} from "@/app/growth/(app)/jarvis/actions";
import type { AutopilotCandidate } from "@/lib/growth/autopilot";

type ActionResult = { ok?: boolean; error?: string } | undefined;

/**
 * The email autopilot panel: researched prospects with a ready first-touch
 * email, ticked by default, two triggers — fire now, or queue for the 8am
 * automatic run. Previews expand per row so what's about to go out is one
 * tap from being read.
 */
export function EmailAutopilot({
  candidates,
  queuedCount,
}: {
  candidates: AutopilotCandidate[];
  queuedCount: number;
}) {
  const [state, formAction, pending] = useActionState(
    autopilotAction as (
      prev: ActionResult,
      formData: FormData
    ) => Promise<ActionResult>,
    undefined
  );
  const [regenState, regenAction, regenPending] = useActionState(
    regenerateFlaggedDrafts as (
      prev: ActionResult,
      formData: FormData
    ) => Promise<ActionResult>,
    undefined
  );

  const defaultTicked = candidates.filter((c) => !c.queued && !c.broken).length;
  // Live count of ticked boxes so the buttons say exactly what they'll do
  // ("Queue 20 for the 8am run"). Re-syncs when the list refreshes.
  const [ticked, setTicked] = useState(defaultTicked);
  useEffect(() => setTicked(defaultTicked), [defaultTicked, candidates.length]);

  if (candidates.length === 0 && queuedCount === 0) return null;

  const flagged = candidates.filter((c) => c.broken);

  return (
    <section
      className="panel panel-block"
      style={{ marginBottom: 16, borderLeft: "3px solid var(--green, #34d399)" }}
      aria-label="Email autopilot"
    >
      <h2 className="panel-title">
        <Mail size={16} style={{ verticalAlign: "-3px" }} /> Email autopilot
      </h2>
      {queuedCount > 0 && (
        <p style={{ fontSize: 13, color: "var(--faint)", marginTop: 0 }}>
          <Clock size={13} style={{ verticalAlign: "-2px" }} /> {queuedCount}{" "}
          email{queuedCount === 1 ? "" : "s"} queued — they go out
          automatically on the 8am run.
        </p>
      )}

      {flagged.length > 0 && (
        <form
          action={regenAction}
          style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}
        >
          {flagged.slice(0, 12).map((c) => (
            <input key={c.messageId} type="hidden" name="message_id" value={c.messageId} />
          ))}
          <button type="submit" className="btn btn-secondary" disabled={regenPending}>
            <RefreshCw size={14} />{" "}
            {regenPending
              ? `Jarvis is rewriting ${Math.min(flagged.length, 12)} drafts…`
              : `Fix ${Math.min(flagged.length, 12)} flagged draft${flagged.length === 1 ? "" : "s"} automatically`}
          </button>
          {regenState?.error && (
            <span style={{ fontSize: 12, color: "var(--orange, #fb923c)" }}>{regenState.error}</span>
          )}
          {regenState?.ok && !regenPending && (
            <span style={{ fontSize: 12, color: "var(--green, #34d399)" }}>
              ✓ All rewritten under the new rules — review and queue
            </span>
          )}
        </form>
      )}

      {candidates.length > 0 && (
        <form
          action={formAction}
          onSubmit={(e) => {
            const n = new FormData(e.currentTarget).getAll("message_id").length;
            if (n === 0) {
              e.preventDefault();
              window.alert("Tick at least one email first.");
              return;
            }
            const intent = (
              (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null
            )?.value;
            if (
              intent === "send_now" &&
              !window.confirm(
                `Send ${n} email${n === 1 ? "" : "s"} right now? They go out for real, from your sending address.`
              )
            ) {
              e.preventDefault();
            }
          }}
        >
          <p style={{ fontSize: 13, color: "var(--faint)", margin: "0 0 10px" }}>
            {candidates.length} researched prospect
            {candidates.length === 1 ? " has" : "s have"} a first-touch email
            ready. Untick any you want to hold back, expand a row to read the
            email, then fire.
          </p>

          <div style={{ display: "grid", gap: 6, marginBottom: 12 }}>
            {candidates.map((c) => (
              <details
                key={c.messageId}
                className="panel"
                style={{ padding: "8px 12px" }}
              >
                <summary
                  style={{
                    cursor: "pointer",
                    display: "flex",
                    gap: 10,
                    alignItems: "center",
                    flexWrap: "wrap",
                  }}
                >
                  <input
                    type="checkbox"
                    name="message_id"
                    value={c.messageId}
                    defaultChecked={!c.queued && !c.broken}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) =>
                      setTicked((n) => n + (e.currentTarget.checked ? 1 : -1))
                    }
                    aria-label={`Include ${c.company}`}
                  />
                  <strong>{c.company}</strong>
                  <span style={{ fontSize: 12, color: "var(--faint)" }}>
                    {c.contactName} · {c.industry || "—"} · score {c.leadScore}
                    {c.queued ? " · already queued" : ""}
                  </span>
                  {c.broken && (
                    <span style={{ fontSize: 12, color: "var(--orange, #fb923c)" }}>
                      ⚠ old draft ({c.broken}) — regenerate in the Studio; the
                      autopilot will refuse to send it as-is
                    </span>
                  )}
                  <span style={{ fontSize: 12, color: "var(--faint)", marginLeft: "auto" }}>
                    → {c.email}
                  </span>
                </summary>
                <div style={{ marginTop: 8, fontSize: 13 }}>
                  <p style={{ margin: "0 0 6px" }}>
                    <strong>Subject:</strong> {c.subject}
                  </p>
                  <p style={{ whiteSpace: "pre-wrap", margin: 0, color: "var(--faint)" }}>
                    {c.body}
                  </p>
                </div>
              </details>
            ))}
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <button
              type="submit"
              name="intent"
              value="send_now"
              className="btn btn-primary"
              disabled={pending || ticked === 0}
            >
              <Rocket size={14} />{" "}
              {pending
                ? "Working…"
                : `Send ${ticked} email${ticked === 1 ? "" : "s"} now`}
            </button>
            <button
              type="submit"
              name="intent"
              value="queue"
              className="btn btn-secondary"
              disabled={pending || ticked === 0}
            >
              <Clock size={14} /> Queue {ticked} for the 8am run
            </button>
            {state?.error && (
              <span style={{ fontSize: 12, color: "var(--red, #f87171)" }}>{state.error}</span>
            )}
            {state?.ok && !pending && (
              <span style={{ fontSize: 12, color: "var(--green, #34d399)" }}>
                ✓ Done — the CRM is updated and follow-ups are scheduled
              </span>
            )}
          </div>
        </form>
      )}
    </section>
  );
}
