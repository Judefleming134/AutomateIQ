import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { selectAllRowsByIds } from "./db";

type Client = SupabaseClient;

/**
 * "How many replies are actually waiting on me?"
 *
 * Three surfaces answer that question and they were not answering it the same
 * way:
 *
 *   the inbox      "Reply due" — latest REAL message is inbound
 *   the dashboard  "N replies are waiting on you" — same rule, inline
 *   Jarvis         `week.replies` — replies RECEIVED in the last 7 days
 *
 * The third is a different question. It counts a reply Jude answered on Monday
 * exactly the same as one nobody has touched, so the "What matters right now"
 * panel — the most attention-getting thing on the Jarvis page — told him
 * "3 replies this week — every one gets an answer today" on a morning when
 * every one of them had already been answered. Clicking through landed on an
 * inbox with nothing due.
 *
 * A count that doesn't match what its click-through shows, which is one of the
 * recurring classes in CLAUDE.md.
 *
 * The RULE lives here now, so the three surfaces cannot drift again. The
 * dashboard keeps its richer per-prospect panel and calls `isAwaiting` for the
 * decision; Jarvis just needs the number and calls `countAwaitingReplies`.
 */

/**
 * Is this conversation waiting on us?
 *
 * True when they replied and we have not genuinely sent anything since. A
 * DRAFT is not an answer — the engine auto-drafts a suggested reply after
 * every inbound, and treating that as "we replied" would clear the flag on
 * every conversation at once. Callers must pass the last SENT outbound.
 */
export function isAwaiting(
  latestInboundAt: string,
  latestSentAt: string | null | undefined
): boolean {
  if (!latestSentAt) return true; // they wrote, we never answered
  return latestInboundAt > latestSentAt;
}

/** The shape both callers already have to hand. */
type Msg = { prospect_id: string; sent_at?: string | null; created_at: string };

/**
 * The real timestamp of an outbound message: `sent_at` when it went, falling
 * back to `created_at`. Same rule as lib/growth/inbox-order.ts — a draft is
 * written hours before the 07:00 cron sends it, so comparing a reply against
 * `created_at` can make an answer look older than the question it answers.
 */
const sentInstant = (m: Msg) => m.sent_at ?? m.created_at;

/** Newest real send per prospect, from rows already fetched. */
export function latestSentByProspect(rows: Msg[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of rows) {
    const at = sentInstant(m);
    const current = out.get(m.prospect_id);
    if (!current || at > current) out.set(m.prospect_id, at);
  }
  return out;
}

/** How many inbound messages to look back over. */
export const INBOUND_SCAN = 400;

/**
 * The count of conversations waiting on a reply.
 *
 * Two queries and no per-prospect round trips: the newest inbound messages,
 * then every genuine send to those same prospects. Deliberately returns a
 * NUMBER — the dashboard already renders the list and does not need this.
 */
export async function countAwaitingReplies(admin: Client): Promise<number> {
  const { data: inboundRows } = await admin
    .from("ge_messages")
    .select("prospect_id, created_at")
    .eq("direction", "inbound")
    .order("created_at", { ascending: false })
    .limit(INBOUND_SCAN);

  // Rows arrive newest-first, so the first sighting of a prospect is their
  // most recent reply.
  const latestInbound = new Map<string, string>();
  for (const m of inboundRows ?? []) {
    if (!latestInbound.has(m.prospect_id)) latestInbound.set(m.prospect_id, m.created_at);
  }
  const ids = [...latestInbound.keys()];
  if (ids.length === 0) return 0;

  // The bound that stops this query growing for ever.
  //
  // Naively this fetches EVERY sent message to all ~400 replied prospects,
  // purely to work out the newest one for each — so it grew with send history
  // rather than with the thing being measured, and a prospect emailed for a
  // year dragged a year of rows across to answer a yes/no question.
  //
  // It doesn't need them. A send older than the OLDEST latest-reply in the set
  // is older than every prospect's latest reply, so it cannot make anyone
  // "answered" — for each id the test is `latestInbound > latestSent`, and a
  // send below the floor loses that comparison for every id at once. Dropping
  // those rows cannot change a single answer, and a prospect left with no
  // qualifying send correctly reads as awaiting.
  //
  // Expressed on the same instant the rule uses: `sent_at` when set (which
  // recordOutreachSent always does), `created_at` only for legacy rows that
  // predate it. Bounding on `created_at` alone would have been WRONG — a draft
  // written last week and sent this morning would fall outside it.
  const floor = [...latestInbound.values()].reduce((a, b) => (a < b ? a : b));
  const instantAtOrAfterFloor = `sent_at.gte.${floor},and(sent_at.is.null,created_at.gte.${floor})`;

  // CHUNKED for the same reason the dashboard chunks: every id rides in the
  // request URL at ~40 chars per UUID, and 400 of them is a ~16KB URL that
  // simply fails — which would report ZERO sends and therefore mark every
  // conversation as awaiting, inflating the very number this exists to fix.
  const sentRows = await selectAllRowsByIds<Msg>(ids, (chunk) =>
    admin
      .from("ge_messages")
      .select("prospect_id, sent_at, created_at")
      .eq("direction", "outbound")
      .eq("status", "sent")
      .or(instantAtOrAfterFloor)
      .in("prospect_id", chunk)
  );
  const latestSent = latestSentByProspect(sentRows ?? []);

  let n = 0;
  for (const [id, inboundAt] of latestInbound) {
    if (isAwaiting(inboundAt, latestSent.get(id))) n += 1;
  }
  return n;
}
