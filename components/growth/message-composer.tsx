"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, Send, Save, Clock, CheckCheck, Copy, Check, Undo2 } from "lucide-react";
import {
  draftGrowthMessage,
  composeMessage,
} from "@/app/growth/(app)/inbox/actions";
import {
  CHANNELS,
  CHANNEL_META,
  OBJECTIVES,
  OBJECTIVE_META,
  TONES,
  type Channel,
  type MessageObjective,
  type MessagePurpose,
  type Tone,
} from "@/lib/growth/constants";

// The composer picks an OBJECTIVE; the message stores a PURPOSE. Map them so a
// follow-up sent from the inbox is actually tracked as a follow-up (status
// advancement, the follow-up autopilot's counting) and a queued cold touch is
// caught by the reply-race gate — the Studio already records purpose; the inbox
// used to drop it (stored null).
const OBJECTIVE_TO_PURPOSE: Record<MessageObjective, MessagePurpose> = {
  initial: "first",
  follow_up: "follow_up",
  re_engagement: "follow_up",
  confirmation: "meeting_confirmation",
  reply: "reply",
};

export type ComposerTemplate = {
  id: string;
  name: string;
  channel: Channel;
  subject: string | null;
  body: string;
};

/**
 * The AI Message Generator + send controls. The AI only ever fills the
 * editable fields below — a human reads, edits and explicitly dispatches
 * every message. Email can send directly (Resend); LinkedIn / Instagram /
 * SMS are copy-and-mark-sent (no unofficial automation against those
 * platforms' terms).
 */
export function MessageComposer({
  prospectId,
  prospectEmail,
  defaultChannel = "email",
  defaultObjective = "initial",
  replyContext,
  templates = [],
}: {
  prospectId: string;
  prospectEmail: string | null;
  defaultChannel?: Channel;
  defaultObjective?: MessageObjective;
  /** Latest inbound message, offered as context when replying. */
  replyContext?: string;
  /** Templates with {{placeholders}} already filled for this prospect. */
  templates?: ComposerTemplate[];
}) {
  const router = useRouter();
  const [channel, setChannel] = useState<Channel>(defaultChannel);
  const [objective, setObjective] = useState<MessageObjective>(defaultObjective);
  const [tone, setTone] = useState<Tone>("professional");
  const [instructions, setInstructions] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  // The saved draft's row id. composeMessage returns it so the next save
  // UPDATES that row instead of inserting a new one — without it, every
  // "Save draft" click duplicated the draft in the inbox.
  const [messageId, setMessageId] = useState<string | null>(null);
  const [drafting, setDrafting] = useState(false);
  // What the last AI draft or template application replaced, so it can be put
  // back in one tap. Both overwrite subject AND body outright — and applying a
  // template is a DROPDOWN, so brushing it wiped a half-written reply to a
  // prospect who'd just messaged back, with no way to recover it. Channel is
  // captured too: a template switches channel, and restoring text without it
  // would drop the reply into the wrong one. Same guard as the Message Studio.
  const [undo, setUndo] = useState<
    { channel: Channel; subject: string; body: string } | null
  >(null);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();

  async function handleDraft() {
    setNotice(null);
    setDrafting(true);
    // try/finally: a thrown action (network blip, redeploy mid-session) must
    // never leave the button stuck on "Drafting…" until a full page reload.
    try {
      const result = await draftGrowthMessage({
        prospectId,
        channel,
        objective,
        tone,
        instructions: instructions || undefined,
        replyContext: objective === "reply" ? replyContext : undefined,
      });
      if (!result.ok) {
        setNotice({ kind: "error", text: result.error });
        return;
      }
      const replaced = body.trim() || subject.trim();
      setUndo(replaced ? { channel, subject, body } : null);
      if (result.subject) setSubject(result.subject);
      setBody(result.body);
      setNotice({
        kind: "ok",
        text: replaced
          ? "Draft ready — your previous text was replaced."
          : "Draft ready — review and edit before sending.",
      });
    } catch {
      setNotice({
        kind: "error",
        text: "Connection hiccup — the draft didn't come back. Your text is untouched; try again.",
      });
    } finally {
      setDrafting(false);
    }
  }

  function applyTemplate(id: string) {
    const t = templates.find((tpl) => tpl.id === id);
    if (!t) return;
    // Capture first — a template replaces everything already typed.
    const replaced = body.trim() || subject.trim();
    setUndo(replaced ? { channel, subject, body } : null);
    setChannel(t.channel);
    if (t.subject) setSubject(t.subject);
    setBody(t.body);
    setNotice(
      replaced
        ? { kind: "ok", text: "Template applied — your previous text was replaced." }
        : null
    );
  }

  /** Put back whatever the last draft or template replaced. */
  function restoreUndo() {
    if (!undo) return;
    setChannel(undo.channel);
    setSubject(undo.subject);
    setBody(undo.body);
    setUndo(null);
    setNotice({ kind: "ok", text: "Your original text is back." });
  }

  function dispatch(mode: "draft" | "queue" | "send_email" | "mark_sent") {
    setNotice(null);
    // Guard against sending/recording an email with a blank subject — it
    // looks broken to the recipient and hurts deliverability. Saving a draft
    // is fine (still a work in progress).
    if (channel === "email" && mode !== "draft" && !subject.trim()) {
      setNotice({
        kind: "error",
        text: "Add a subject line first — an email with no subject looks broken and hurts deliverability.",
      });
      return;
    }
    startTransition(async () => {
      let result: Awaited<ReturnType<typeof composeMessage>>;
      try {
        result = await composeMessage({
          prospectId,
          channel,
          subject: channel === "email" ? subject : null,
          body,
          mode,
          purpose: OBJECTIVE_TO_PURPOSE[objective],
          tone,
          scheduledAt:
            mode === "queue" && scheduledAt
              ? new Date(scheduledAt).toISOString()
              : null,
          // Re-save updates the draft saved earlier in this session instead
          // of inserting a duplicate row.
          messageId: messageId ?? undefined,
        });
      } catch {
        // Thrown action (network blip) — nothing was confirmed; keep the text
        // so the user can simply press the button again.
        setNotice({
          kind: "error",
          text: "Connection hiccup — that didn't go through. Your draft is untouched; try again.",
        });
        return;
      }
      if (!result.ok) {
        setNotice({ kind: "error", text: result.error });
        return;
      }
      const doneText = {
        draft: messageId ? "Draft updated." : "Saved as draft.",
        queue: "Added to the outreach queue.",
        send_email: "Email sent ✓",
        mark_sent: "Recorded as sent.",
      }[mode];
      setNotice({ kind: "ok", text: doneText });
      if (mode === "draft") {
        // Remember the row so further saves keep updating it in place.
        setMessageId(result.messageId);
      } else {
        // Queued/sent — the composer resets for a fresh message.
        setMessageId(null);
        setBody("");
        setSubject("");
        // The message is sent — restoring pre-draft text into an empty
        // composer would only confuse.
        setUndo(null);
      }
      router.refresh();
    });
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(
        channel === "email" && subject ? `${subject}\n\n${body}` : body
      );
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard unavailable — no-op.
    }
  }

  const busy = drafting || pending;

  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
        <div style={{ flex: "1 1 130px" }}>
          <label htmlFor="mc-channel" style={{ fontSize: 12, color: "var(--faint)" }}>
            Channel
          </label>
          <select
            id="mc-channel"
            value={channel}
            onChange={(e) => setChannel(e.target.value as Channel)}
            style={{ width: "100%" }}
          >
            {CHANNELS.map((c) => (
              <option key={c} value={c}>
                {CHANNEL_META[c].label}
              </option>
            ))}
          </select>
        </div>
        <div style={{ flex: "1 1 180px" }}>
          <label htmlFor="mc-objective" style={{ fontSize: 12, color: "var(--faint)" }}>
            Objective
          </label>
          <select
            id="mc-objective"
            value={objective}
            onChange={(e) => setObjective(e.target.value as MessageObjective)}
            style={{ width: "100%" }}
          >
            {OBJECTIVES.map((o) => (
              <option key={o} value={o} disabled={o === "reply" && !replyContext}>
                {OBJECTIVE_META[o].label}
              </option>
            ))}
          </select>
        </div>
        <div style={{ flex: "1 1 130px" }}>
          <label htmlFor="mc-tone" style={{ fontSize: 12, color: "var(--faint)" }}>
            Tone
          </label>
          <select
            id="mc-tone"
            value={tone}
            onChange={(e) => setTone(e.target.value as Tone)}
            style={{ width: "100%" }}
          >
            {TONES.map((t) => (
              <option key={t} value={t}>
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </option>
            ))}
          </select>
        </div>
        {templates.length > 0 && (
          <div style={{ flex: "1 1 180px" }}>
            <label htmlFor="mc-template" style={{ fontSize: 12, color: "var(--faint)" }}>
              Start from template
            </label>
            <select
              id="mc-template"
              defaultValue=""
              onChange={(e) => applyTemplate(e.target.value)}
              style={{ width: "100%" }}
            >
              <option value="">—</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div style={{ marginTop: 10 }}>
        <label htmlFor="mc-instructions" style={{ fontSize: 12, color: "var(--faint)" }}>
          Extra instructions for the AI (optional)
        </label>
        <input
          id="mc-instructions"
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          placeholder="e.g. mention their new Cork branch, keep it under 60 words"
          maxLength={1000}
          style={{ width: "100%" }}
        />
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <button
          type="button"
          className="btn btn-primary"
          onClick={handleDraft}
          disabled={busy}
        >
          <Sparkles size={14} /> {drafting ? "Drafting…" : "Draft with AI"}
        </button>
      </div>

      {channel === "email" && (
        <div style={{ marginTop: 12 }}>
          <label
            htmlFor="mc-subject"
            style={{ fontSize: 12, color: "var(--faint)", display: "flex", justifyContent: "space-between", gap: 8 }}
          >
            <span>Subject</span>
            {/* Inboxes cut a subject off around 78 chars, so a longer one gets
                truncated in the preview and reads worse — a subtle live hint
                nudges Jude to keep it tight without blocking anything. */}
            {subject.length > 0 && (
              <span
                style={{
                  color: subject.length > 78 ? "var(--orange, #fb923c)" : "var(--faint)",
                }}
              >
                {subject.length}/78{subject.length > 78 ? " · may truncate in inboxes" : ""}
              </span>
            )}
          </label>
          <input
            id="mc-subject"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            maxLength={300}
            style={{ width: "100%" }}
          />
        </div>
      )}

      <div style={{ marginTop: 10 }}>
        <label htmlFor="mc-body" style={{ fontSize: 12, color: "var(--faint)" }}>
          Message — always review before it goes anywhere
        </label>
        <textarea
          id="mc-body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={8}
          maxLength={10000}
          style={{ width: "100%" }}
          placeholder="Write the message yourself, start from a template, or draft it with AI…"
        />
      </div>

      {notice && (
        <p
          role="status"
          style={{
            color: notice.kind === "ok" ? "var(--green, #34d399)" : "var(--red, #f87171)",
            fontSize: 13,
            margin: "8px 0 0",
          }}
        >
          {notice.text}
        </p>
      )}

      {/* One tap back to whatever the last draft or template overwrote. */}
      {undo && (
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={restoreUndo}
          style={{ marginTop: 8 }}
        >
          <Undo2 size={13} /> Undo — put my original text back
        </button>
      )}

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
          marginTop: 12,
          alignItems: "center",
        }}
      >
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => dispatch("draft")}
          disabled={busy || !body.trim()}
        >
          <Save size={13} /> Save draft
        </button>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => dispatch("queue")}
          disabled={busy || !body.trim()}
        >
          <Clock size={13} /> Queue
        </button>
        <input
          type="datetime-local"
          aria-label="Schedule for"
          value={scheduledAt}
          onChange={(e) => setScheduledAt(e.target.value)}
          style={{ maxWidth: 200 }}
        />
        {channel === "email" ? (
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => dispatch("send_email")}
            disabled={busy || !body.trim() || !prospectEmail}
            title={prospectEmail ? `Sends to ${prospectEmail}` : "No email on file"}
          >
            <Send size={13} /> {pending ? "Sending…" : "Send email now"}
          </button>
        ) : (
          <>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={handleCopy}
              disabled={!body.trim()}
            >
              {copied ? <Check size={13} style={{ color: "var(--green)" }} /> : <Copy size={13} />}
              {copied ? "Copied!" : "Copy text"}
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => dispatch("mark_sent")}
              disabled={busy || !body.trim()}
              title="Record that you sent this manually in the app"
            >
              <CheckCheck size={13} /> Mark as sent
            </button>
          </>
        )}
      </div>
      {channel !== "email" && (
        <p style={{ fontSize: 12, color: "var(--faint)", marginTop: 8 }}>
          {channel === "call"
            ? "Use the text as your call script, make the call yourself, then mark it sent so tracking stays accurate."
            : `${CHANNEL_META[channel].label} has no official sending API here — copy the text, send it in the app, then mark it sent so tracking stays accurate.`}
        </p>
      )}
    </div>
  );
}
