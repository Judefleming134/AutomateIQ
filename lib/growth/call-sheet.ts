/**
 * Which past touch the call sheet is allowed to quote.
 *
 * The prospect workspace builds a per-business call script with no AI call at
 * all, from what the page already knows. Several of its lines are written from
 * "the last touch":
 *
 *   OPENER:     "I sent you an email on Monday about …"
 *   IF THEY SAY "Send me an email" → "I did — Monday, …"
 *   VOICEMAIL:  "I emailed you about …"
 *
 * Every one of those describes something that was SENT. But the history it
 * read from — `outreachTouches` — deliberately mixes three things: messages
 * that went out, and logged CALLS and MEETINGS. Taking the most recent of all
 * three produced, verbatim:
 *
 *   "I sent you a call on Monday about what AI could take off Walsh
 *    Joinery's plate, and wanted to put a voice to it."
 *
 * and told a prospect he had emailed them when he had only rung. The second
 * dial to the same prospect is exactly when a logged call is the most recent
 * touch, so the script was at its most wrong precisely when it was needed
 * most — and it is read aloud, down the phone, to a stranger.
 *
 * The rule: a sentence about something sent may only be built from a MESSAGE.
 * A dial is still worth knowing about, so it is returned separately and gets
 * its own wording ("I tried you on Monday") rather than being described as a
 * send.
 */

export type ScriptTouch = {
  /** ISO timestamp. The caller sorts oldest-first; this module does not care. */
  at: string;
  /** "Email", "Instagram", "Call", "Meeting", … — display only. */
  channelLabel: string;
  subject: string | null;
  kind: "message" | "call" | "meeting";
  /** True only for the email channel. "I did" is a lie on any other. */
  isEmail?: boolean;
  /** Replies are history, never something WE sent. */
  inbound?: boolean;
};

export type ScriptTouches = {
  /** Most recent thing actually sent to them, or null. */
  lastMessage: ScriptTouch | null;
  /** Most recent call or meeting, or null. */
  lastDial: ScriptTouch | null;
  /** True when they were rung AFTER the last message went out — the opener
   *  should then acknowledge the chase instead of opening cold. */
  dialledSinceMessage: boolean;
};

/**
 * Splits an oldest-first touch history into the two things the script needs.
 *
 * Inbound touches are excluded from both: a reply is something THEY did, and
 * "I sent you a reply on Monday" is the same class of error one step removed.
 *
 * @param touches oldest-first, as the workspace builds them
 */
export function pickScriptTouches(touches: readonly ScriptTouch[]): ScriptTouches {
  const sent = touches.filter((t) => !t.inbound);
  const lastMessage = sent.filter((t) => t.kind === "message").pop() ?? null;
  const lastDial =
    sent.filter((t) => t.kind === "call" || t.kind === "meeting").pop() ?? null;
  return {
    lastMessage,
    lastDial,
    dialledSinceMessage: Boolean(lastMessage && lastDial && lastDial.at > lastMessage.at),
  };
}
