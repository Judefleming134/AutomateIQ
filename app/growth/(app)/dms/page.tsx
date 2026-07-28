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
/** Prospects pulled by score before the already-DM'd filter runs. */
const POOL_LIMIT = 600;
/** How far down the un-DM'd pool to look for drafts to fill one screen. */
const DRAFT_LOOKUP = 150;

const SOCIAL_CHANNELS = ["instagram", "facebook", "linkedin"];

export default async function DmListPage() {
  await requireGrowth();
  const admin = createAdminClient();

  // Active prospects on at least one social platform, best scores first.
  // Late-stage / closed leads are excluded — this is cold-touch DMing, not
  // pestering someone already in conversation.
  //
  // The already-DM'd exclusion runs against a POOL, fetched ahead of it. It
  // used to work the other way round: fetch the top 200 by score, then drop
  // the DM'd ones from that slice. So as Jude worked through his best leads
  // the 200 filled up with people he'd already messaged, the list starved,
  // and it eventually showed "No DMs ready — research some prospects" while
  // hundreds of researched, drafted, un-DM'd prospects sat just below the
  // score cut. Same shape as the call-list bug: a score cap applied before
  // the "still to work" filter can only reorder what it happens to contain.
  const [{ data: pool }, dmdRows] = await Promise.all([
    admin
      .from("ge_prospects")
      .select("id, company, contact_name, lead_score, instagram_url, facebook_url, linkedin_url")
      .not(
        "status",
        "in",
        '("won","lost","do_not_contact","archived","replied","qualified","meeting_booked","proposal_in_progress","proposal_sent","negotiation")'
      )
      .or("instagram_url.not.is.null,facebook_url.not.is.null,linkedin_url.not.is.null")
      .order("lead_score", { ascending: false, nullsFirst: false })
      .limit(POOL_LIMIT),
    // Everyone already DM'd on ANY social channel. Fetched on its own terms,
    // paged with selectAllRows: an unranged select silently caps at 1,000
    // rows, and a dropped "sent" row would put an already-DM'd prospect BACK
    // on the list — the one mistake this page exists to prevent.
    selectAllRows<{ prospect_id: string }>(() =>
      admin
        .from("ge_messages")
        .select("prospect_id")
        .eq("direction", "outbound")
        .in("channel", SOCIAL_CHANNELS)
        .eq("status", "sent")
        .order("prospect_id", { ascending: true })
    ),
  ]);

  const alreadyDmd = new Set(dmdRows.map((r) => r.prospect_id));
  // Everyone genuinely still to DM, best score first — the true remaining
  // pool, not "whatever survived the cut".
  const available = ((pool ?? []) as ProspectRow[]).filter((p) => !alreadyDmd.has(p.id));
  const poolMaxedOut = (pool ?? []).length >= POOL_LIMIT;

  // Only look up drafts for the slice we might actually render.
  const candidates = available.slice(0, DRAFT_LOOKUP);
  const ids = candidates.map((p) => p.id);

  type MessageRow = { id: string; prospect_id: string; channel: string; body: string };
  const messages: MessageRow[] = ids.length
    ? await selectAllRows<MessageRow>(() =>
        admin
          .from("ge_messages")
          .select("id, prospect_id, channel, body")
          .in("prospect_id", ids)
          .eq("direction", "outbound")
          .in("channel", SOCIAL_CHANNELS)
          .eq("status", "draft")
          .order("id", { ascending: true })
      )
    : [];

  const draftByKey = new Map<string, { id: string; body: string }>();
  for (const m of messages ?? []) {
    if (!draftByKey.has(`${m.prospect_id}:${m.channel}`)) {
      draftByKey.set(`${m.prospect_id}:${m.channel}`, { id: m.id, body: m.body });
    }
  }

  const items: WorkItem[] = [];
  for (const p of candidates) {
    // Prefer a channel with a CLEAN draft; only fall back to a flagged one so
    // the prospect still surfaces (with a "fix it" nudge) rather than vanishing.
    let clean: WorkItem | null = null;
    let flagged: WorkItem | null = null;
    for (const channel of CHANNEL_ORDER) {
      const rawUrl = p[SOCIAL_FIELD[channel]];
      const link = rawUrl ? cleanSocialUrl(rawUrl) : null;
      const draft = draftByKey.get(`${p.id}:${channel}`);
      if (!link || !draft) continue;
      // Show and COPY the sanitized text: the scrubber quietly fixes what it
      // can (e.g. "[Your Name]" → "Jude"), and that fixed version is what the
      // broken-check approves — copying the raw body would paste the
      // unfixed placeholder straight into a DM.
      const body = sanitizeOutreachBody(draft.body);
      const broken = draftLooksBroken(body);
      const item: WorkItem = { prospect: p, channel, link, messageId: draft.id, body, broken };
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
          {/* Two very different empty states. "Nobody left to DM" is a finish
              line; "plenty left but none have drafts" is a missing-drafts
              problem, and telling him to research MORE prospects there sends
              him the wrong way entirely. */}
          <p className="empty-state" style={{ margin: 0 }}>
            {available.length > 0 ? (
              <>
                You&apos;ve DM&apos;d everyone who has a message ready.{" "}
                <strong>{available.length}</strong>
                {poolMaxedOut ? "+" : ""} prospect
                {available.length === 1 ? "" : "s"} with a profile link are
                still waiting on a DM draft — open one and generate it in the
                Studio, or run the overnight engine and they&apos;ll be written
                for you.{" "}
                <Link href="/growth/prospects?sort=score">See them →</Link>
              </>
            ) : (
              <>
                No DMs ready right now. This fills up as you research prospects
                that have an Instagram, Facebook or LinkedIn link —{" "}
                <Link href="/growth/prospects?sort=score">research some prospects</Link>{" "}
                and their DM drafts will appear here.
              </>
            )}
          </p>
        </div>
      ) : (
        <>
          <p style={{ fontSize: 13, color: "var(--faint)", margin: "0 0 12px" }}>
            {items.length} ready to send · highest score first
            {/* The real number still to work, so the page never implies 40 is
                all there is. */}
            {available.length > items.length && (
              <>
                {" "}·{" "}
                <strong>
                  {available.length - items.length}
                  {poolMaxedOut ? "+" : ""} more
                </strong>{" "}
                still to DM — mark these sent and the next batch loads
              </>
            )}
          </p>
          <div style={{ display: "grid", gap: 12 }}>
            {items.map((it) => (
              <section key={it.messageId} className="panel panel-block">
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 8 }}>
                  <Link href={`/growth/prospects/${it.prospect.id}`}>
                    <strong>{it.prospect.company}</strong>
                  </Link>
                  <span style={{ fontSize: 12.5, color: "var(--faint)" }}>
                    {/* Guard the contact: company-only leads have no name, and
                        an unguarded value left a dangling "· score" here. */}
                    {it.prospect.contact_name ? `${it.prospect.contact_name} · ` : ""}
                    score {it.prospect.lead_score ?? 0}
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
