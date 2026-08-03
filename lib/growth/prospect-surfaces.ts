/**
 * Every page that renders prospect rows, in one list.
 *
 * THE BUG THIS EXISTS FOR. Only the two actions that live ON the call list —
 * "Log call" and "No answer" — ever revalidated `/growth/call-list`. Every
 * other action that changes what that page shows revalidated the dashboard and
 * the prospects table and stopped there, so the call list kept serving a
 * cached copy of a prospect that had already moved on:
 *
 *   mark a lead Won or Not interested in the Details tab  → still on the list,
 *                                                           still offering the
 *                                                           number to ring
 *   correct a wrong phone number                          → still offers the
 *                                                           OLD number
 *   change the follow-up date                             → still sorted into
 *                                                           yesterday's tier
 *   archive or delete from the prospects table            → still listed; a
 *                                                           deleted one 404s
 *                                                           when tapped
 *   import a batch with phone numbers                     → none of them appear
 *
 * Ringing a lead who is already closed is the expensive one. It is also
 * completely invisible: the page looks fine, the data behind it is right, and
 * the only symptom is Jude having a conversation he shouldn't be having.
 *
 * The comment in addActivity already said the right thing — "name that page
 * explicitly rather than relying on the dashboard's revalidation to carry it"
 * — it just wasn't applied anywhere else. So the rule lives here now, and the
 * two working lists Jude spends his day on can't be forgotten again.
 *
 * `/growth/dms` is included for the same reason: it reads prospects by social
 * link and status, so a status change or an import is invisible to it too.
 *
 * Purely additive. revalidatePath only drops a cache entry — it cannot change
 * what a page renders, only how fresh it is.
 */
import { revalidatePath } from "next/cache";

/** The lists that read prospect rows and are worked from directly. */
export const PROSPECT_SURFACES = [
  "/growth",
  "/growth/prospects",
  "/growth/call-list",
  "/growth/dms",
] as const;

/**
 * Refresh every prospect surface, plus one prospect's workspace when given.
 *
 * Callers keep any extra revalidations of their own (analytics, campaigns,
 * Jarvis) — this is the floor, not the ceiling.
 */
export function revalidateProspectSurfaces(prospectId?: string | null): void {
  for (const path of PROSPECT_SURFACES) revalidatePath(path);
  if (prospectId) revalidatePath(`/growth/prospects/${prospectId}`);
}
