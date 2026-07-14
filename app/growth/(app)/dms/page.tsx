import Link from "next/link";
import { Send, ExternalLink } from "lucide-react";
import { requireGrowth } from "@/lib/growth/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { selectAllRows } from "@/lib/growth/db";
import { cleanSocialUrl } from "@/lib/growth/research";
import { sanitizeOutreachBody, draftLooksBroken } from "@/lib/growth/email";
import { CHANNEL_META, type Channel } from "@/lib/growth/constants";
import { ActionForm } from "@/components/admin/action-form";
import { SubmitButton } from "@/components/admin/submit-button";
import { CopyButton } from "@/components/portal/copy-button";
import { markMessageSent } from "../inbox/actions";

// Trades get read on Instagram/Facebook before LinkedIn — offer the channel
// most likely to land first when a prospect is on more than one.
const CHANNEL_ORDER: Channel[] = ["instagram", "facebook", "linkedin"];
const SOCIAL_FIELD: Record<string, "instagram_url" | "facebook_url" | "linkedin_url"> = {
  instagram: "instagram_url",
  facebook: "facebook_url",
  linkedin: "linkedin_url",
};

type ProspectRow = {
  id: string;
  company: string;
  contact_name: string;
  lead_score: number | null;
  instagram_url: string | null;
  facebook_url: string | null;
  linkedin_url: string | null;
};

type WorkItem = {
  prospect: ProspectRow;
  channel: Channel;
  link: string;
  messageId: string;
  body: string;
  /** Why this draft shouldn't be pasted as-is (leftover placeholder / invented
   *  name) — null when it's clean and ready. */
  broken: string | null;
};

const MAX_ITEMS = 40;

export default async function DmListPage() {
  await requireGrowth();
  const admin = createAdminClient();

  // Active prospects on at least one social platform, best scores first.
  // Late-stage / closed leads are excluded — this is cold-touch DMing, not
  // pestering someone already in conversation.
  const { data: prospects } = await admin
    .from("ge_prospects")
    .select("id, company, contact_name, lead_score, instagram_url, facebook_url, linkedin_url")
    .not(
      "status",
      "in",
      '("won","lost","do_not_contact","archived","replied","qualified","meeting_booked","proposal_in_progress","proposal_sent","negotiation")'
    )
    .or("instagram_url.not.is.null,facebook_url.not.is.null,linkedin_url.not.is.null")
    .order("lead_score", { ascending: false, nullsFirst: false })
    .limit(200);

  const ids = (prospects ?? []).map((p) => p.id);

  // Their social DM drafts (ready to send) and any already-sent social DMs
  // (so a prospect drops off the list once you've messaged them anywhere).
  // Paged with selectAllRows: an unranged select silently caps at 1,000 rows,
  // and a dropped "sent" row would put an already-DMd prospect BACK on the
  // list — the one mistake this page exists to prevent.
  type MessageRow = { id: string; prospect_id: string; channel: string; status: string; body: string };
  const messages: MessageRow[] = ids.length
    ? await selectAllRows<MessageRow>(() =>
        admin
          .from("ge_messages")
          .select("id, prospect_id, channel, status, body")
          .in("prospect_id", ids)
          .eq("direction", "outbound")
          .in("channel", ["instagram", "facebook", "linkedin"])
          .in("status", ["draft", "sent"])
          .order("id", { ascending: true })
      )
    : [];

  const draftByKey = new Map<string, { id: string; body: string }>();
  const alreadyDmd = new Set<string>();
  for (const m of messages ?? []) {
    if (m.status === "sent") alreadyDmd.add(m.prospect_id);
    else if (m.status === "draft" && !draftByKey.has(`${m.prospect_id}:${m.channel}`)) {
      draftByKey.set(`${m.prospect_id}:${m.channel}`, { id: m.id, body: m.body });
    }
  }

  const items: WorkItem[] = [];
  for (const p of (prospects ?? []) as ProspectRow[]) {
    if (alreadyDmd.has(p.id)) continue;
    // Prefer a channel with a CLEAN draft; only fall back to a flagged one so
    // the prospect still surfaces (with a "fix it" nudge) rather than vanishing.
    let clean: WorkItem | null = null;
    let flagged: WorkItem | null = null;
    for (const channel of CHANNEL_ORDER) {
      const rawUrl = p[SOCIAL_FIELD[channel]];
      const link = rawUrl ? cleanSocialUrl(rawUrl) : null;
      const draft = draftByKey.get(`${p.id}:${channel}`);
      if (!link || !draft) continue;
      const broken = draftLooksBroken(sanitizeOutreachBody(draft.body));
      const item: WorkItem = { prospect: p, channel, link, messageId: draft.id, body: draft.body, broken };
      if (!broken) { clean = item; break; }
      if (!flagged) flagged = item;
    }
    const chosen = clean ?? flagged;
    if (chosen) items.push(chosen);
    if (items.length >= MAX_ITEMS) break;
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1>
            <Send size={20} style={{ verticalAlign: "-3px", marginRight: 8 }} />
            DM list
          </h1>
          <p>
            Your best prospects with a ready DM and their profile link, side by
            side — rip through them: <b>Copy → Open → paste → send → Mark sent</b>.
            Sending stays in your hands (keeps your accounts safe); the engine
            just removes all the hunting between tabs.
          </p>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="panel panel-block">
          <p className="empty-state" style={{ margin: 0 }}>
            No DMs ready right now. This fills up as you research prospects that
            have an Instagram, Facebook or LinkedIn link —{" "}
            <Link href="/growth/prospects?sort=score">research some prospects</Link>{" "}
            and their DM drafts will appear here.
          </p>
        </div>
      ) : (
        <>
          <p style={{ fontSize: 13, color: "var(--faint)", margin: "0 0 12px" }}>
            {items.length} ready to send · highest score first
          </p>
          <div style={{ display: "grid", gap: 12 }}>
            {items.map((it) => (
              <section key={it.messageId} className="panel panel-block">
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 8 }}>
                  <Link href={`/growth/prospects/${it.prospect.id}`}>
                    <strong>{it.prospect.company}</strong>
                  </Link>
                  <span style={{ fontSize: 12.5, color: "var(--faint)" }}>
                    {it.prospect.contact_name} · score {it.prospect.lead_score ?? 0}
                  </span>
                  <span className="badge badge-blue">{CHANNEL_META[it.channel].label}</span>
                  <a
                    href={it.link}
                    target="_blank"
                    rel="noreferrer"
                    className="btn btn-secondary btn-sm"
                    style={{ marginLeft: "auto" }}
                  >
                    Open {CHANNEL_META[it.channel].label}{" "}
                    <ExternalLink size={12} style={{ verticalAlign: "-1px" }} />
                  </a>
                </div>

                <p
                  style={{
                    whiteSpace: "pre-wrap",
                    margin: "0 0 10px",
                    fontSize: 14,
                    background: "var(--bg2, rgba(255,255,255,.03))",
                    border: "1px solid var(--line, rgba(255,255,255,.08))",
                    borderRadius: 8,
                    padding: "10px 12px",
                  }}
                >
                  {it.body}
                </p>

                {it.broken ? (
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                    <span style={{ fontSize: 12.5, color: "var(--orange, #fb923c)" }}>
                      ⚠ this draft needs a quick fix ({it.broken}) — regenerate it before sending
                    </span>
                    <Link
                      href={`/growth/prospects/${it.prospect.id}?tab=studio`}
                      className="btn btn-secondary btn-sm"
                      style={{ marginLeft: "auto" }}
                    >
                      Fix in Studio →
                    </Link>
                  </div>
                ) : (
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                    <CopyButton text={it.body} label="Copy message" />
                    <ActionForm action={markMessageSent} className="inline-form">
                      <input type="hidden" name="message_id" value={it.messageId} />
                      <SubmitButton className="btn btn-primary btn-sm" pendingText="Marking…">
                        Mark sent
                      </SubmitButton>
                    </ActionForm>
                    <span style={{ fontSize: 11.5, color: "var(--faint)" }}>
                      “Mark sent” moves them to Contacted and schedules the follow-up.
                    </span>
                  </div>
                )}
              </section>
            ))}
          </div>
        </>
      )}
    </>
  );
}
