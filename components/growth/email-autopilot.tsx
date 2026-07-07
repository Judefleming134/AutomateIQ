"use client";

import { useActionState } from "react";
import { Mail, Rocket, Clock } from "lucide-react";
import {
  autopilotAction,
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

  if (candidates.length === 0 && queuedCount === 0) return null;

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
                    defaultChecked={!c.queued}
                    onClick={(e) => e.stopPropagation()}
                    aria-label={`Include ${c.company}`}
                  />
                  <strong>{c.company}</strong>
                  <span style={{ fontSize: 12, color: "var(--faint)" }}>
                    {c.contactName} · {c.industry || "—"} · score {c.leadScore}
                    {c.queued ? " · already queued" : ""}
                  </span>
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
              disabled={pending}
            >
              <Rocket size={14} /> {pending ? "Working…" : "Send ticked now"}
            </button>
            <button
              type="submit"
              name="intent"
              value="queue"
              className="btn btn-secondary"
              disabled={pending}
            >
              <Clock size={14} /> Queue for the 8am run
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
