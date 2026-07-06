import "server-only";
import { aiComplete } from "@/lib/ai/complete";
import type { Channel, MessageObjective, Tone } from "@/lib/growth/constants";

export type ProspectContext = {
  company: string;
  contact_name: string;
  job_title?: string | null;
  industry?: string | null;
  website?: string | null;
  location?: string | null;
  notes?: string | null;
};

export type DraftParams = {
  channel: Channel;
  objective: MessageObjective;
  tone: Tone;
  instructions?: string;
  /** The prospect's inbound message, when objective = 'reply'. */
  replyContext?: string;
};

const CHANNEL_RULES: Record<Channel, string> = {
  linkedin:
    "LinkedIn direct message. No subject line. Under 500 characters. Conversational, no heavy formatting, no links unless asked to include the booking link.",
  instagram:
    "Instagram DM. No subject line. Short (2–4 sentences), warm and informal, no corporate jargon.",
  email:
    "Email. MUST start with a subject line in the exact format 'SUBJECT: ...' on the first line, then a blank line, then the body. Body 80–150 words, short paragraphs, sign off as 'AutomateIQ'.",
  sms: "SMS. No subject line. Maximum 320 characters, one clear call to action, sign as AutomateIQ.",
};

const OBJECTIVE_RULES: Record<MessageObjective, string> = {
  initial:
    "First touch. Open with something genuinely specific to their business, connect it to one concrete way AutomateIQ could help, and close with a soft, low-pressure question.",
  follow_up:
    "Polite follow-up to a message that got no reply. Brief, add one new angle or piece of value, make it easy to say yes or no. Never guilt-trip.",
  re_engagement:
    "Re-engaging a prospect who went quiet a while ago. Acknowledge time has passed, mention something new AutomateIQ now offers, and invite a fresh conversation.",
  confirmation:
    "The prospect is ready to book a free AI Strategy Session. Warmly confirm interest and give them the booking link (provided below) with a one-line description of what the session covers.",
  reply:
    "Reply to the prospect's message quoted below. Answer their question directly and honestly first, then move the conversation one step toward booking a free AI Strategy Session only if it fits naturally.",
};

/**
 * Drafts a personalised outreach message for review — nothing generated here
 * is ever sent without a human reading and editing it first. Returns a
 * subject only for email; other channels have none.
 */
export async function draftOutreach(
  prospect: ProspectContext,
  params: DraftParams,
  bookingUrl: string
): Promise<{ subject: string | null; body: string }> {
  const system = [
    "You are the senior sales development writer for AutomateIQ, an Irish AI-automation agency (automateiq.ie).",
    "AutomateIQ builds practical AI systems for small and mid-sized businesses: review collection, instant quoting, lead response within seconds, AI assistants, content generation and custom automation.",
    "The commercial goal of all outreach is to earn a free, no-obligation 30-minute AI Strategy Session.",
    "Hard rules: be truthful — never invent statistics, client names, mutual connections or specifics about the prospect that are not in the data provided. If a detail is unknown, stay general rather than guessing.",
    "Write like one busy professional to another: no hype, no emoji walls, no 'I hope this finds you well'. Output ONLY the message itself — no preamble, options, or commentary.",
  ].join("\n");

  const lines = [
    `CHANNEL: ${CHANNEL_RULES[params.channel]}`,
    `OBJECTIVE: ${OBJECTIVE_RULES[params.objective]}`,
    `TONE: ${params.tone}`,
    "",
    "PROSPECT:",
    `- Contact: ${prospect.contact_name}${prospect.job_title ? `, ${prospect.job_title}` : ""}`,
    `- Company: ${prospect.company}`,
  ];
  if (prospect.industry) lines.push(`- Industry: ${prospect.industry}`);
  if (prospect.location) lines.push(`- Location: ${prospect.location}`);
  if (prospect.website) lines.push(`- Website: ${prospect.website}`);
  if (prospect.notes) lines.push(`- Notes from our team: ${prospect.notes}`);
  if (params.objective === "confirmation" || params.objective === "reply") {
    lines.push("", `BOOKING LINK (free AI Strategy Session): ${bookingUrl}`);
  }
  if (params.replyContext) {
    lines.push("", "THEIR MESSAGE TO US:", params.replyContext);
  }
  if (params.instructions) {
    lines.push("", `EXTRA INSTRUCTIONS FROM THE SENDER: ${params.instructions}`);
  }
  lines.push("", "Write the message now.");

  const raw = (await aiComplete(system, lines.join("\n"), 1024)).trim();

  if (params.channel === "email") {
    const match = /^SUBJECT:\s*(.+)\n+([\s\S]+)$/.exec(raw);
    if (match) {
      return { subject: match[1].trim(), body: match[2].trim() };
    }
    // Model skipped the SUBJECT line — keep the text, supply a fallback.
    return { subject: `A quick idea for ${prospect.company}`, body: raw };
  }
  return { subject: null, body: raw };
}
