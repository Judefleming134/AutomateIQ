/**
 * Whether a one-tap dial should be offered for a prospect.
 *
 * This exists because of a specific accident that became possible the moment
 * the inbound classifier began setting `do_not_contact` AUTOMATICALLY on an
 * opt-out reply. Before that, the status only appeared because Jude set it —
 * he knew. Now a prospect can carry it without him ever touching the record.
 *
 * On the prospects list that mattered more than it sounds. The "Do not contact"
 * badge lives in the Status column; the tap-to-call button lives in the FIRST
 * column, deliberately, so it falls under his thumb on a phone. The table is
 * min-width 900, so on a phone the badge is roughly four columns of horizontal
 * scrolling away from the button. Scanning a list at speed, one tap is all it
 * takes to ring someone who asked him to stop — which is a reputational and an
 * ePrivacy problem, not an inconvenience.
 *
 * The number itself is never hidden. Only the one-tap dial is withheld, and
 * only on the list. The prospect workspace keeps its tel: link on purpose: it
 * already opens with an explicit panel saying outreach is off for this lead,
 * and it is the right place for a deliberate override when the classifier read
 * a reply wrong.
 */
export function canDial(status: string | null | undefined): boolean {
  return status !== "do_not_contact";
}
