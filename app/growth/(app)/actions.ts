"use server";

import { revalidatePath } from "next/cache";
import { requireGrowth } from "@/lib/growth/auth";
import { sendDueEmailFollowupsNow } from "@/lib/growth/autopilot";

type Result = { ok?: boolean; error?: string; notice?: string } | undefined;

/**
 * Dashboard "Send due email follow-ups now" button. Fires every due email
 * follow-up that already has a clean drafted reply, on demand, through the
 * same review gates as the 8am autopilot. Returns a human-readable summary so
 * Jude sees exactly what went out and what's waiting.
 */
export async function sendDueFollowups(_prev: Result, _formData: FormData): Promise<Result> {
  const { member } = await requireGrowth();
  const { sent, held, noDraft, due } = await sendDueEmailFollowupsNow(
    `${member.name} (manual send)`,
    member.id
  );

  revalidatePath("/growth");
  revalidatePath("/growth/inbox");

  if (due === 0) {
    return { notice: "No email follow-ups are due right now." };
  }
  const bits = [`Sent ${sent} follow-up${sent === 1 ? "" : "s"}`];
  if (noDraft > 0) {
    bits.push(`${noDraft} still to be drafted (they go on the morning run)`);
  }
  if (held > 0) {
    bits.push(`${held} held for review (see the prospect)`);
  }
  return { ok: sent > 0, notice: `${bits.join(" · ")}.` };
}
