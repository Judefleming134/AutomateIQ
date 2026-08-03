import Link from "next/link";
import { Send, ExternalLink } from "lucide-react";
import { requireGrowth } from "@/lib/growth/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { selectAllRows, selectAllRowsByIds } from "@/lib/growth/db";
import { cleanSocialUrl } from "@/lib/growth/research";
import { sanitizeOutreachBody, draftLooksBroken } from "@/lib/growth/email";
import { CHANNEL_META, type Channel } from "@/lib/growth/constants";
import { summariseDmQueue } from "@/lib/growth/dm-list";
import {
  collectDmPool,
  dmEmptyReason,
  MAX_POOL_PAGES,
  POOL_PAGE,
} from "@/lib/growth/dm-pool";
import { ActionForm } from "@/components/admin/action-form";
import { SubmitButton } from "@/components/admin/submit-button";
import { DmSendButton } from "@/components/growth/dm-send-button";
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
  // Everyone already DM'd on ANY social channel. Fetched on its own terms,
  // paged with selectAllRows: an unranged select silently caps at 1,000
  // rows, and a dropped "sent" row would put an already-DM'd prospect BACK
  // on the list — the one mistake this page exists to prevent.
  const dmdRows = await selectAllRows<{ prospect_id: string }>(() =>
    admin
      .from("ge_messages")
      .select("prospect_id")
      .eq("direction", "outbound")
      .in("channel", SOCIAL_CHANNELS)
      .eq("status", "sent")
      .order("prospect_id", { ascending: true })
  );
  const alreadyDmd = new Set(dmdRows.map((r) => r.prospect_id));

  // Read DOWN the score order until enough genuinely un-DM'd prospects are
  // found, rather than taking one fixed slice and hoping it contains some.
  // A fixed slice means the already-DM'd filter can only reorder what that
  // slice happens to hold, so the list starves once Jude has worked through
  // that many — which is the bug this page has now had twice, at 200 and at
  // 600. See lib/growth/dm-pool.ts. Bounded, and it stops as soon as it has
  // enough, so the common case costs exactly what the single slice did.
  const { available, exhausted } = await collectDmPool<ProspectRow>(
    async (from, to) => {
      const { data } = await admin
        .from("ge_prospects")
        .select("id, company, contact_name, lead_score, instagram_url, facebook_url, linkedin_url")
        .not(
          "status",
          "in",
          '("won","lost","do_not_contact","archived","replied","qualified","meeting_booked","proposal_in_progress","proposal_sent","negotiation")'
        )
        .or("instagram_url.not.is.null,facebook_url.not.is.null,linkedin_url.not.is.null")
        .order("lead_score", { ascending: false, nullsFirst: false })
        // Unique tiebreak: bulk imports share scores, and without it a paged
        // read can skip or repeat a prospect across page boundaries.
        .order("id", { ascending: true })
        .range(from, to);
      return (data ?? []) as ProspectRow[];
    },
    alreadyDmd,
    { need: DRAFT_LOOKUP }
  );

  // Only look up drafts for the slice we might actually render.
  const candidates = available.slice(0, DRAFT_LOOKUP);
  const ids = candidates.map((p) => p.id);

  type MessageRow = { id: string; prospect_id: string; channel: string; body: string };
  // CHUNKED. `ids` reaches DRAFT_LOOKUP (150) on every load, and every id is
  // serialised into the request URL at ~40 characters per UUID: measured, that
  // is a 6,070-byte URL, ~6.6KB with headers, against the usual 8KB proxy
  // ceiling. It fits today with roughly 43 ids of headroom — but selectAllRows
  // THROWS rather than truncating, so the moment it doesn't fit this page 500s
  // outright, and DRAFT_LOOKUP is a tuning constant on a list whose window has
  // already been widened twice to stop it starving.
  //
  // selectAllRowsByIds returns exactly the same rows at any size.
  const messages: MessageRow[] = await selectAllRowsByIds<MessageRow>(ids, (chunk) =>
    admin
      .from("ge_messages")
      .select("id, prospect_id, channel, body")
      .in("prospect_id", chunk)
      .eq("direction", "outbound")
      .in("channel", SOCIAL_CHANNELS)
      .eq("status", "draft")
      .order("id", { ascending: true })
  );

  const draftByKey = new Map<string, { id: string; body: string }>();
  for (const m of messages ?? []) {
    if (!draftByKey.has(`${m.prospect_id}:${m.channel}`)) {
      draftByKey.set(`${m.prospect_id}:${m.channel}`, { id: m.id, body: m.body });
    }
  }

  // Build EVERY ready item in the lookup window, then slice to a screenful.
  // The loop used to stop at MAX_ITEMS, which meant the page had no idea how
  // many more were genuinely ready — so the header counted un-DM'd prospects
  // instead, most of which have no message written and can never appear here.
  // Sanitising 150 short bodies in memory is nothing next to telling Jude the
  // wrong number. See summariseDmQueue.
  const ready: WorkItem[] = [];
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
    if (chosen) ready.push(chosen);
  }
  const items = ready.slice(0, MAX_ITEMS);

  const queue = summariseDmQueue({
    shown: items.length,
    ready: ready.length,
    available: available.length,
    lookupCapped: available.length > DRAFT_LOOKUP,
    // Not reaching the end of the list means both counts are floors.
    poolMaxedOut: !exhausted,
  });
  const plus = queue.approximate ? "+" : "";
  // Three genuinely different situations behind an empty list — "research
  // more prospects" is right for one of them and wrong for the other two.
  const emptyReason = dmEmptyReason({
    available: available.length,
    ready: ready.length,
    exhausted,
  });

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
            side — rip through them: <b>Copy &amp; open → paste → send → Mark sent</b>.
            One tap copies that prospect&apos;s message and opens their profile
            together, so you can never paste the last one&apos;s message by mistake.
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
            {emptyReason === "awaiting-drafts" ? (
              <>
                You&apos;ve DM&apos;d everyone who has a message ready.{" "}
                <strong>{queue.awaitingDraft}</strong>
                {plus} prospect
                {queue.awaitingDraft === 1 ? "" : "s"} with a profile link are
                still waiting on a DM draft — open one and generate it in the
                Studio, or run the overnight engine and they&apos;ll be written
                for you.{" "}
                <Link href="/growth/prospects?social=1&sort=score">See them →</Link>
              </>
            ) : emptyReason === "scan-limit" ? (
              /* The third case, and the one that used to give the WRONG
                 advice. Everyone in the stretch of the score order we read is
                 already DM'd — but we stopped before the end of the list, so
                 there are more below it. Telling him to research new prospects
                 here sends him off to do the one thing that cannot help. */
              <>
                Everyone in your top{" "}
                <strong>{MAX_POOL_PAGES * POOL_PAGE}</strong> by lead score has
                already been DM&apos;d — which is a good problem. There are more
                prospects below that, so this isn&apos;t the end of the list:
                archive the cold ones to bring the rest into range, or work{" "}
                <Link href="/growth/prospects?social=1&sort=score">the list by score</Link>{" "}
                directly.
              </>
            ) : (
              <>
                No DMs ready right now. This fills up as you research prospects
                that have an Instagram, Facebook or LinkedIn link —{" "}
                <Link href="/growth/prospects?social=1&sort=score">research some prospects</Link>{" "}
                and their DM drafts will appear here.
              </>
            )}
          </p>
        </div>
      ) : (
        <>
          <p style={{ fontSize: 13, color: "var(--faint)", margin: "0 0 12px" }}>
            {items.length} ready to send · highest score first
            {/* TWO numbers, because they are two different jobs. "More ready"
                really does load when these are marked sent. "Waiting on a
                draft" never will — those need the Studio or an overnight run,
                and lumping them into one "still to DM" figure both inflated it
                and promised something the page could not deliver. */}
            {queue.readyBeyond > 0 && (
              <>
                {" "}·{" "}
                <strong>
                  {queue.readyBeyond}
                  {plus} more ready
                </strong>{" "}
                — mark these sent and the next batch loads
              </>
            )}
            {queue.awaitingDraft > 0 && (
              <>
                {" "}·{" "}
                <strong>
                  {queue.awaitingDraft}
                  {plus}
                </strong>{" "}
                with a profile link still need a DM written —{" "}
                <Link href="/growth/prospects?social=1&sort=score">write them →</Link>
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
                    {/* One tap: copies THIS message and opens THIS profile, so
                        the clipboard and the open tab can never belong to two
                        different businesses. The plain Copy button stays beside
                        it for anyone who wants just the text. */}
                    <DmSendButton
                      text={it.body}
                      link={it.link}
                      platform={CHANNEL_META[it.channel].label}
                    />
                    <CopyButton text={it.body} label="Copy only" />
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
