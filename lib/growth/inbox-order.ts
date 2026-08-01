/**
 * When a message actually happened, and who therefore spoke last.
 *
 * `created_at` is when a draft was WRITTEN. `sent_at` is when it went. For a
 * message composed and sent in one go those are the same second, so the
 * difference never shows — but the engine's main path is not that. Autopilot
 * drafts overnight and the 07:00 cron sends, so almost every real outreach
 * message is created hours before it leaves.
 *
 * Ordering an inbox on `created_at` therefore replays the conversation in the
 * order it was TYPED rather than the order it was EXCHANGED:
 *
 *     Mon 09:00  autopilot drafts a follow-up        (queued)
 *     Mon 14:00  the prospect replies                (inbound)
 *     Tue 07:00  the queued draft actually sends     (sent)
 *
 * Read by `created_at`, our message comes first and it looks like they replied
 * to us. They didn't — we wrote to them after they'd already written to us.
 * Worse, "who spoke last" then reads as THEM, so the conversation is flagged
 * "Reply due" when it has already been answered, and Jude replies twice or
 * chases someone who is waiting on nothing.
 *
 * Jarvis's morning brief already works this way ("sent_at is the real send
 * time; created_at is when the draft was written"). This is the same rule,
 * applied to the inbox.
 */

export type TimedMessage = {
  direction: string;
  status: string;
  sent_at?: string | null;
  created_at: string;
};

/**
 * The moment a message entered the conversation.
 *
 * Only a message that genuinely SENT uses `sent_at` — a draft or a queued
 * message has not happened yet, so the time it was written is the only honest
 * thing to order it by.
 */
export function messageInstant(m: TimedMessage): string {
  if (m.direction === "outbound" && m.status === "sent" && m.sent_at) {
    return String(m.sent_at);
  }
  return String(m.created_at);
}

/** Newest first, by when each message actually happened. */
export function sortByInstantDesc<T extends TimedMessage>(messages: T[]): T[] {
  return messages
    .slice()
    .sort((a, b) => (messageInstant(a) < messageInstant(b) ? 1 : -1));
}

/**
 * The latest message that ACTUALLY happened — inbound, or outbound that sent.
 *
 * The engine auto-drafts a suggested reply after every inbound. That unsent
 * draft must not register as "we replied", or the Reply-due flag clears on
 * every conversation the moment the draft is written.
 */
export function latestRealMessage<T extends TimedMessage>(thread: T[]): T | undefined {
  const real = thread.filter((m) => m.direction === "inbound" || m.status === "sent");
  return sortByInstantDesc(real)[0];
}

/** True when the last thing that actually happened was them writing to us. */
export function awaitingReply(thread: TimedMessage[]): boolean {
  return latestRealMessage(thread)?.direction === "inbound";
}
