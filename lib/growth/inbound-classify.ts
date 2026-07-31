/**
 * What KIND of inbound message just arrived.
 *
 * Every inbound reply was treated as a human reply: status → "replied",
 * follow-up reset to +1 day, the chase sequence stopped, and a paid AI call
 * made to draft a suggested response. That is right for a person writing back
 * and wrong for the two things that dominate cold-email inboxes at volume:
 *
 * 1. **Out-of-office auto-replies.** At 250 sends a day, a meaningful slice of
 *    every batch is on holiday. Each one silently dropped a live lead out of
 *    the automation — the chase stopped, the prospect sat in the inbox as
 *    "Reply due" forever waiting for an answer to a robot, and Jude paid for
 *    an AI draft replying to "I am currently away from my desk."
 * 2. **Opt-outs.** "Remove me from your list" stopped the chase (because it
 *    became a reply) but never set `do_not_contact`, so the prospect stayed in
 *    the active pipeline and could be contacted again. That is an ePrivacy
 *    obligation, not a nicety.
 *
 * The classifier is deliberately conservative: when it isn't sure, it says
 * "human", which is exactly the behaviour that shipped before this file
 * existed. Nothing is ever discarded either way — the message row is always
 * written and always visible; what changes is whether it moves the prospect.
 */

export type InboundKind = "human" | "auto_reply" | "opt_out";

export type InboundClassification = {
  kind: InboundKind;
  /** The signals that fired, for the activity log. A wrong call must be
   *  visible in the timeline, never silent. */
  reason: string | null;
  /** When an auto-reply told us the date they're back (YYYY-MM-DD, Irish
   *  calendar). Null when it didn't say, or said it in a shape we don't read. */
  returnsOn: string | null;
};

const HUMAN: InboundClassification = { kind: "human", reason: null, returnsOn: null };

/**
 * Removes the quoted original message. Our own outreach carries no unsubscribe
 * footer, but THEIR corporate signature might, and a quoted thread would drag
 * one into every reply — turning a friendly "sounds good" into a false opt-out.
 */
export function stripQuoted(body: string): string {
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (/^>/.test(t)) continue;
    if (/^-{2,}\s*original message\s*-{2,}$/i.test(t)) break;
    if (/^_{10,}$/.test(t)) break;
    if (/^on .{4,80}\bwrote:$/i.test(t)) break;
    if (/^from:\s/i.test(t) && out.length > 0) break;
    out.push(line);
  }
  return out.join("\n").trim();
}

/** Subject lines that are, on their own, conclusive. */
const SUBJECT_MARKERS: [RegExp, string][] = [
  [/\bautomatic(?:\s+|-)repl(?:y|ies)\b/i, "subject: automatic reply"],
  [/\bauto(?:\s*|-)?repl(?:y|ies)\b/i, "subject: auto-reply"],
  [/\bout of (?:the )?office\b/i, "subject: out of office"],
  [/^\s*(?:re:\s*)*(?:auto|ooo)\s*[:|-]/i, "subject: auto/OOO prefix"],
  [/\bautomated response\b/i, "subject: automated response"],
  [/\bundeliverable\b/i, "subject: undeliverable"],
  [/\bdelivery (?:status notification|has failed|failure)\b/i, "subject: delivery failure"],
  [/\bmail delivery (?:failed|subsystem)\b/i, "subject: delivery failure"],
  [/\breturned mail\b/i, "subject: returned mail"],
  [/\bmessage blocked\b/i, "subject: message blocked"],
];

/**
 * Body phrases, grouped into FAMILIES. Two distinct families classify; two
 * phrases from the same family do not.
 *
 * The grouping is the whole trick. Scoring each phrase separately looked fine
 * until "I'm out of office next week but this sounds relevant — can we talk
 * after?" scored two points off a single clause (one marker for "I'm out of",
 * another for "out of office") and parked a warm human lead. They aren't two
 * signals; they're two spellings of one. An auto-responder reliably says
 * several *different* things — where it is, when it's back, who to ask
 * instead — and a person mentioning their holiday says one.
 */
type Family = "absence" | "automated" | "unreachable" | "redirect" | "departed" | "returns";

const BODY_MARKERS: [RegExp, string, Family][] = [
  [/\b(?:i am|i'm|am) (?:currently )?(?:out of|away from)\b/i, "I am currently away", "absence"],
  [/\bout of (?:the )?office\b/i, "out of the office", "absence"],
  [/\b(?:on|taking) (?:annual |maternity |paternity |parental |sick )?leave\b/i, "on leave", "absence"],
  [/\bon (?:holiday|holidays|vacation|annual leave)\b/i, "on holiday", "absence"],
  [/\bthis is an automat(?:ed|ic)\b/i, "automated response", "automated"],
  [/\bauto(?:matically)?[- ]generated\b/i, "auto-generated", "automated"],
  [/\b(?:please )?do not reply to this (?:e-?mail|message)\b/i, "do not reply", "automated"],
  [/\blimited access to (?:my )?e-?mail\b/i, "limited email access", "unreachable"],
  [/\b(?:not|won't|will not) be (?:checking|reading|monitoring) (?:my )?e-?mail\b/i, "not checking email", "unreachable"],
  [/\bfor (?:anything )?urgent(?:\s+matters?|\s+enquiries|\s+queries)?\b/i, "for urgent matters", "redirect"],
  [/\bin my absence\b/i, "in my absence", "redirect"],
  [/\bno longer (?:works?|with|employed)\b/i, "no longer with the company", "departed"],
  [/\b(?:back|returning|will return|i return|be back) (?:to |in )?(?:the office )?(?:on|from)?\s*\d/i, "return date", "returns"],
  [/\buntil\s+(?:the\s+)?\d/i, "until a date", "returns"],
  [/\buntil\s+(?:mon|tues|wednes|thurs|fri|satur|sun)day\b/i, "until a weekday", "returns"],
];

/**
 * Opt-outs. Any single match is enough — these phrases don't appear by
 * accident in a warm reply, and getting this wrong in the safe direction
 * (stopping when they didn't ask) costs one lead, while getting it wrong the
 * other way means emailing someone who told us to stop.
 */
const OPT_OUT_MARKERS: [RegExp, string][] = [
  [/\bunsubscribe\s+me\b/i, "unsubscribe me"],
  [/\b(?:please|kindly)\s+unsubscribe\b/i, "please unsubscribe"],
  [/\bunsubscribe\s+(?:me\s+)?from\b/i, "unsubscribe from"],
  [/\bremove\s+(?:me|my (?:details|email|address|name)|us)\b/i, "remove me"],
  [/\btake\s+(?:me|us|my (?:email|name|details))\s+off\b/i, "take me off"],
  [/\bstop\s+(?:e-?mailing|contacting|sending|messaging)\b/i, "stop emailing"],
  [/\b(?:do not|don'?t|please don'?t)\s+(?:contact|e-?mail|message)\s+(?:me|us)\b/i, "do not contact me"],
  [/\bno longer wish to (?:receive|be contacted)\b/i, "no longer wish to receive"],
  [/\bopt(?:\s+me)?\s+out\b/i, "opt out"],
  [/\b(?:delete|erase)\s+my\s+(?:data|details|information|record)\b/i, "erase my data"],
  [/\bnot interested,?\s*(?:please\s*)?(?:remove|stop|unsubscribe)\b/i, "not interested — remove"],
];

/** A bare one-word "unsubscribe" is unambiguous; inside an essay it isn't. */
const BARE_OPT_OUT = /^\s*(?:unsubscribe|remove|stop)\s*[.!]?\s*$/i;

const MONTHS = [
  "jan", "feb", "mar", "apr", "may", "jun",
  "jul", "aug", "sep", "oct", "nov", "dec",
];

/** YYYY-MM-DD for a UTC-anchored date, matching how dublinDate() renders. */
function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Reads "back on 12 August" / "until 3rd Sept" / "until 12/08" out of an
 * auto-reply, resolving to the NEXT such date within 90 days.
 *
 * Deliberately narrow: only explicit day/month shapes. Weekday names ("back
 * Monday") are skipped rather than guessed, because a wrong guess quietly
 * moves a real chase and nobody would ever see why. Day-first on the numeric
 * form — Irish convention.
 */
export function parseReturnDate(body: string, now = new Date()): string | null {
  const window = body.slice(0, 2000);
  const cue =
    /\b(?:back|return(?:ing|s)?|will return|be back|available again|until|till|til)\b[^.\n]{0,40}?/i;
  const monthName = MONTHS.join("|");

  const candidates: Date[] = [];
  const push = (day: number, month: number, year?: number) => {
    if (day < 1 || day > 31 || month < 1 || month > 12) return;
    const base = year
      ? new Date(Date.UTC(year, month - 1, day))
      : new Date(Date.UTC(now.getUTCFullYear(), month - 1, day));
    if (Number.isNaN(base.getTime())) return;
    // No year given and the date already passed → they mean next year.
    if (!year && base.getTime() < now.getTime() - 24 * 60 * 60 * 1000) {
      base.setUTCFullYear(base.getUTCFullYear() + 1);
    }
    candidates.push(base);
  };

  // "12 August" / "3rd Sept 2026"
  const dm = new RegExp(
    `${cue.source}(\\d{1,2})(?:st|nd|rd|th)?\\s+(${monthName})[a-z]*\\.?(?:\\s+(\\d{4}))?`,
    "gi"
  );
  // "August 12" / "Sept 3rd, 2026"
  const md = new RegExp(
    `${cue.source}(${monthName})[a-z]*\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?`,
    "gi"
  );
  // "12/08" / "12-08-2026"
  const numeric = new RegExp(
    `${cue.source}(\\d{1,2})[/.-](\\d{1,2})(?:[/.-](\\d{2,4}))?`,
    "gi"
  );

  for (const m of window.matchAll(dm)) {
    push(Number(m[1]), MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()) + 1, m[3] ? Number(m[3]) : undefined);
  }
  for (const m of window.matchAll(md)) {
    push(Number(m[2]), MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) + 1, m[3] ? Number(m[3]) : undefined);
  }
  for (const m of window.matchAll(numeric)) {
    const yr = m[3] ? Number(m[3].length === 2 ? `20${m[3]}` : m[3]) : undefined;
    push(Number(m[1]), Number(m[2]), yr);
  }

  const horizon = now.getTime() + 90 * 24 * 60 * 60 * 1000;
  const future = candidates
    .filter((d) => d.getTime() > now.getTime() && d.getTime() <= horizon)
    .sort((a, b) => a.getTime() - b.getTime());
  return future.length ? isoDay(future[0]) : null;
}

/**
 * Classifies an inbound message.
 *
 * `headers` is optional and only used when the forwarder happens to pass them:
 * RFC 3834's `auto-submitted` and Microsoft's `x-auto-response-suppress` are
 * definitive when present, and cost nothing to honour.
 */
export function classifyInbound(
  subject: string,
  body: string,
  headers?: Record<string, unknown> | null
): InboundClassification {
  const clean = stripQuoted(body || "");
  const subj = subject || "";
  const reasons: string[] = [];
  let score = 0;

  // Headers first — when a forwarder passes them, they're not a heuristic.
  if (headers) {
    const lower: Record<string, string> = {};
    for (const [k, v] of Object.entries(headers)) {
      if (typeof v === "string") lower[k.toLowerCase()] = v;
    }
    const autoSubmitted = lower["auto-submitted"];
    if (autoSubmitted && autoSubmitted.trim().toLowerCase() !== "no") {
      return {
        kind: "auto_reply",
        reason: `header: auto-submitted: ${autoSubmitted.trim().slice(0, 40)}`,
        returnsOn: parseReturnDate(clean),
      };
    }
    if (lower["x-autoreply"] || lower["x-auto-response-suppress"] || lower["x-autorespond"]) {
      return {
        kind: "auto_reply",
        reason: "header: auto-response",
        returnsOn: parseReturnDate(clean),
      };
    }
  }

  for (const [re, label] of SUBJECT_MARKERS) {
    if (re.test(subj)) {
      reasons.push(label);
      score += 2;
      break;
    }
  }
  // Auto-replies lead with the notice; a long thread that mentions holidays
  // halfway down is a person talking, not a robot.
  const head = clean.slice(0, 1200);
  const seen = new Set<Family>();
  for (const [re, label, family] of BODY_MARKERS) {
    if (seen.has(family) || !re.test(head)) continue;
    seen.add(family);
    reasons.push(`body: ${label}`);
    score += 1;
  }

  // Two independent signals. One alone is how a HUMAN writes ("I'm out of
  // office next week — can we talk after?"), and misreading that would park a
  // warm lead. Two is how an auto-responder writes.
  if (score >= 2) {
    return {
      kind: "auto_reply",
      reason: reasons.slice(0, 4).join(", "),
      returnsOn: parseReturnDate(clean),
    };
  }

  // Opt-out is checked AFTER auto-reply on purpose: plenty of corporate
  // auto-replies carry a marketing footer with the word "unsubscribe" in it,
  // and marking every holidaying prospect do-not-contact would be a disaster
  // that looks exactly like the bug this file fixes.
  if (BARE_OPT_OUT.test(clean)) {
    return { kind: "opt_out", reason: `opt-out: "${clean.trim().slice(0, 20)}"`, returnsOn: null };
  }
  for (const [re, label] of OPT_OUT_MARKERS) {
    if (re.test(clean)) {
      return { kind: "opt_out", reason: `opt-out: ${label}`, returnsOn: null };
    }
  }

  return HUMAN;
}
