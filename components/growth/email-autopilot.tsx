"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Mail, Rocket, Clock, RefreshCw, Send } from "lucide-react";
import {
  autopilotAction,
  regenerateFlaggedDrafts,
  sendQueuedNow,
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

  // After a send / queue / regenerate, re-pull the candidate list from the
  // server so the panel refreshes: sent emails drop off, queued ones show
  // as queued, rewritten drafts lose their flag — no manual reload.
  const router = useRouter();
  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state, router]);
  useEffect(() => {
    if (regenState?.ok) router.refresh();
  }, [regenState, router]);

  // Flush the queue on demand — a manual trigger for the same send the 8am
  // cron does, so a late/skipped Hobby cron never traps queued emails.
  const [flushPending, startFlush] = useTransition();
  const [flushMsg, setFlushMsg] = useState<{ ok: boolean; text: string } | null>(
    null
  );

  // Tick by default exactly what the 8am auto-queue would send: unbroken,
  // not-already-queued, and not research-stale. An age-stale draft (just old,
  // but a valid cold intro) is pre-ticked too; only a broken or research-
  // changed draft needs a look/regenerate first.
  const defaultTicked = candidates.filter(
    (c) => !c.queued && !c.broken && c.staleKind !== "research"
  ).length;
  // Live count of ticked boxes so the buttons say exactly what they'll do
  // ("Queue 20 for the 8am run"). After a refresh, recount from the REAL
  // form DOM: React preserves checkbox state for rows whose key survives a
  // router.refresh(), so a count derived from the default-tick rule drifts
  // after any manual untick — the buttons would promise "Queue 20" while
  // the form actually held 17.
  const formRef = useRef<HTMLFormElement>(null);
  const [ticked, setTicked] = useState(defaultTicked);
  useEffect(() => {
    if (formRef.current) {
      setTicked(new FormData(formRef.current).getAll("message_id").length);
    } else {
      setTicked(defaultTicked);
    }
  }, [defaultTicked, candidates]);

  if (candidates.length === 0 && queuedCount === 0) return null;

  // Broken and research-stale drafts get the one-tap regenerate treatment;
  // an age-stale draft is still a valid send, so it isn't flagged for a rewrite.
  const flagged = candidates.filter((c) => c.broken || c.staleKind === "research");

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
        <div
          style={{
            display: "flex",
            gap: 10,
            alignItems: "center",
            flexWrap: "wrap",
            marginBottom: 12,
          }}
        >
          <p style={{ fontSize: 13, color: "var(--faint)", margin: 0 }}>
            <Clock size={13} style={{ verticalAlign: "-2px" }} /> {queuedCount}{" "}
            email{queuedCount === 1 ? "" : "s"} queued — they go out
            automatically on the morning run (~9am).
          </p>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={flushPending}
            onClick={() => {
              if (
                !window.confirm(
                  `Send the ${queuedCount} queued email${queuedCount === 1 ? "" : "s"} right now, for real, from your sending address?`
                )
              )
                return;
              startFlush(async () => {
                setFlushMsg(null);
                const res = await sendQueuedNow().catch(() => ({
                  ok: false,
                  detail: "request failed — try again",
                }));
                setFlushMsg(
                  res.ok
                    ? { ok: true, text: `Sent — ${res.detail}.` }
                    : { ok: false, text: `Couldn't send: ${res.detail}` }
                );
                if (res.ok) router.refresh();
              });
            }}
          >
            <Send size={13} /> {flushPending ? "Sending…" : "Send queued now"}
          </button>
          {flushMsg && (
            <span
              style={{
                fontSize: 12,
                color: flushMsg.ok
                  ? "var(--green, #34d399)"
                  : "var(--orange, #fb923c)",
              }}
            >
              {flushMsg.text}
            </span>
          )}
        </div>
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
          ref={formRef}
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
            ready to add to the run. Queue them and they move onto the morning run (~9am);
            research more leads and the next ones appear here automatically.
            Untick any to hold back, expand a row to read the email, then fire.
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
                    defaultChecked={!c.queued && !c.broken && c.staleKind !== "research"}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => {
                      // Recount from the form itself — no arithmetic to
                      // drift, and no touching the event after dispatch
                      // (reading it inside a deferred state updater was
                      // crashing after rapid unticks).
                      const form = e.currentTarget.form;
                      if (form) {
                        setTicked(new FormData(form).getAll("message_id").length);
                      }
                    }}
                    aria-label={`Include ${c.company}`}
                  />
                  <strong>{c.company}</strong>
                  <span style={{ fontSize: 12, color: "var(--faint)" }}>
                    {/* Guard the contact: company-only leads have no name, and
                        an unguarded value left a dangling "· " before industry. */}
                    {c.contactName ? `${c.contactName} · ` : ""}
                    {c.industry || "—"} · score {c.leadScore}
                    {c.queued ? " · already queued" : ""}
                  </span>
                  {c.broken ? (
                    <span style={{ fontSize: 12, color: "var(--orange, #fb923c)" }}>
                      ⚠ old draft ({c.broken}) — regenerate in the Studio; the
                      autopilot will refuse to send it as-is
                    </span>
                  ) : c.staleKind === "research" ? (
                    <span style={{ fontSize: 12, color: "var(--orange, #fb923c)" }}>
                      ⚠ may be stale ({c.stale}) — regenerate for the freshest
                      angle, or tick to send anyway
                    </span>
                  ) : c.staleKind === "age" ? (
                    <span style={{ fontSize: 12, color: "var(--faint)" }}>
                      older draft, still fine to send — regenerate only if you
                      want a fresher angle
                    </span>
                  ) : null}
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
              <Clock size={14} /> Queue {ticked} for the morning run
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
