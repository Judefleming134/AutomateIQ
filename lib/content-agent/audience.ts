/**
 * Who a piece of ContentIQ content actually goes to.
 *
 * ContentIQ generated a post and offered "Mark published" — a checkbox that
 * set a status and published NOTHING. A product whose entire purpose is
 * producing content had no way to deliver any.
 *
 * Publishing now means: send it to your customer list. Which makes THIS file
 * the most dangerous code in the product, because it decides who receives an
 * email on a customer's behalf. Everything here is pure so the decisions can
 * be examined without a mail provider anywhere near them.
 *
 * The standing rule: it is always better to send to nobody than to send to
 * the wrong person. Every ambiguity below resolves to exclusion.
 */

export type AudienceContact = {
  id: string;
  name: string | null;
  email: string | null;
  stage?: string | null;
};

export type AudienceMember = { id: string; name: string; email: string };

export type AudienceResult = {
  /** Who will actually be emailed. */
  recipients: AudienceMember[];
  /** Why the others were left out — shown before anything sends. */
  excluded: { reason: string; count: number }[];
  /** True when the list was cut short by the cap. */
  capped: boolean;
};

/**
 * Hard ceiling on one send.
 *
 * Not a technical limit — a blast radius. If something is wrong with the
 * content, the audience or the template, this is the number of real people who
 * find out before anyone can stop it. Deliberately small enough that a mistake
 * is embarrassing rather than terminal.
 */
export const MAX_RECIPIENTS = 200;

/** Loose but real: enough to reject the shapes that are certainly not emails. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Stages that must never receive marketing.
 *
 * 'lost' is the important one. Someone who told you no is the single worst
 * person to send a promotional email to — it is the difference between a
 * customer you might win back and a spam complaint against the sending
 * domain that also carries the 07:00 outreach.
 */
const NEVER_MARKET_TO = new Set(["lost"]);

/**
 * Builds the recipient list from CRM contacts.
 *
 * @param alreadySent addresses this exact content has already gone to, so a
 *   retry or a resumed batch never doubles up. Matched case-insensitively,
 *   the same way the database's unique index does.
 */
export function buildAudience(
  contacts: AudienceContact[],
  alreadySent: string[] = []
): AudienceResult {
  const sent = new Set(alreadySent.map((e) => e.trim().toLowerCase()).filter(Boolean));

  // Every address that appears on ANY contact marked lost — computed up front,
  // over the whole list, before a single recipient is chosen.
  //
  // The same person routinely has two records: an old enquiry that went
  // nowhere and a newer one. Checking each row's own stage as we walked the
  // list would send to the address purely because the not-lost copy happened
  // to come first. One record saying "this person told us no" is the answer
  // for that address, whatever the other records say.
  const lost = new Set<string>();
  for (const c of contacts) {
    if (c.stage && NEVER_MARKET_TO.has(c.stage)) {
      const key = (c.email ?? "").trim().toLowerCase();
      if (key) lost.add(key);
    }
  }

  const seen = new Set<string>();
  const recipients: AudienceMember[] = [];
  const counts = new Map<string, number>();
  const exclude = (reason: string) => counts.set(reason, (counts.get(reason) ?? 0) + 1);

  for (const c of contacts) {
    const email = (c.email ?? "").trim();
    if (!email) {
      exclude("no email address");
      continue;
    }
    if (!EMAIL_RE.test(email)) {
      exclude("email address looks invalid");
      continue;
    }
    const key = email.toLowerCase();
    if (sent.has(key)) {
      exclude("already sent this");
      continue;
    }
    // Checked ahead of the duplicate rule so the lost record is the one that
    // decides, not whichever copy the query happened to return first.
    if (lost.has(key)) {
      exclude("marked lost — not marketed to");
      continue;
    }
    // The same person can legitimately appear twice in a CRM. They must not
    // receive the same thing twice because of it.
    if (seen.has(key)) {
      exclude("duplicate in your list");
      continue;
    }
    seen.add(key);
    if (recipients.length >= MAX_RECIPIENTS) {
      exclude(`over the ${MAX_RECIPIENTS}-recipient limit for one send`);
      continue;
    }
    recipients.push({ id: c.id, name: (c.name ?? "").trim() || "there", email });
  }

  return {
    recipients,
    excluded: [...counts.entries()]
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count),
    capped: (counts.get(`over the ${MAX_RECIPIENTS}-recipient limit for one send`) ?? 0) > 0,
  };
}

/**
 * The sentence shown BEFORE anything is sent.
 *
 * Sending to a list is irreversible. The one thing that makes it safe is that
 * the person pressing the button knows exactly how many real people are about
 * to receive it, and who is being left out and why.
 */
export function audienceSummary(a: AudienceResult): string {
  if (a.recipients.length === 0) {
    const why = a.excluded.map((e) => `${e.count} ${e.reason}`).join(", ");
    return why
      ? `Nobody to send to — ${why}.`
      : "Nobody to send to — there are no contacts with an email address yet.";
  }
  const head = `${a.recipients.length} recipient${a.recipients.length === 1 ? "" : "s"}`;
  const tail = a.excluded.length
    ? ` · skipping ${a.excluded.map((e) => `${e.count} ${e.reason}`).join(", ")}`
    : "";
  const cap = a.capped
    ? ` · capped at ${MAX_RECIPIENTS} for one send, so run it again for the rest`
    : "";
  return `${head}${tail}${cap}`;
}

/**
 * Personalises the body. Same two tokens LeadIQ uses, for the same reason —
 * one convention across the platform means one thing to learn.
 *
 * ONE pass, with a replacer function, deliberately.
 *
 * Chained `replaceAll` calls with string replacements have two teeth in them:
 * `$&` and friends in the replacement are expanded as patterns, and a value
 * substituted by the first call is re-scanned by the second. A customer named
 * `O'Brien & Sons ($&)` — or a business whose name a colleague typed a token
 * into — would come out mangled in an email to a real person.
 */
export function personalise(
  body: string,
  vars: { name: string; business: string }
): string {
  return body.replace(/\{\{(name|business)\}\}/g, (_match, token: string) =>
    token === "name" ? vars.name : vars.business
  );
}
