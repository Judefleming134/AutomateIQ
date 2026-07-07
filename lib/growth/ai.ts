import "server-only";
import { aiComplete } from "@/lib/ai/complete";
import type {
  Channel,
  MessageObjective,
  MessagePurpose,
  StudioTransform,
  Tone,
} from "@/lib/growth/constants";
import type { ResearchReport } from "@/lib/growth/research";

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
  facebook:
    "Facebook page message. No subject line. 2–4 sentences, plain-spoken and local in feel — you're messaging a small business's page, so sound like a person, not a marketing department.",
  email:
    "Email. MUST start with a subject line in the exact format 'SUBJECT: ...' on the first line, then a blank line, then the body. SUBJECT RULES (open rate is everything): 3–6 words, under 40 characters, lowercase except proper nouns, name ONE specific thing about THIS business (their missed calls, their reviews, their trade + area, having no website) — it must read like a note from someone they know, never like marketing. Banned in subjects: exclamation marks, 'free', 'offer', 'deal', 'opportunity', 'boost', ALL-CAPS words. Good shapes: 'your after-hours calls', 'question about {company}', '{trade} enquiries in {area}', 'your Google reviews'. Body 80–150 words, short paragraphs, sign off as 'Jude, AutomateIQ'.",
  sms: "SMS. No subject line. Maximum 320 characters, one clear call to action, sign as AutomateIQ.",
  call: [
    "PHONE CALL SCRIPT to be read/spoken by the caller — not a message to send. Short spoken sentences, zero jargon.",
    "Structure it with these labelled sections:",
    "OPENER — 10 seconds, name + company + permission to take 30 seconds.",
    "WHY I'M CALLING YOU — one specific, research-grounded observation about their business.",
    "THE VALUE — one concrete thing AutomateIQ could take off their plate.",
    "THE ASK — a free, no-obligation 30-minute AI Strategy Session.",
    "IF THEY SAY... — the 3 most likely objections for this business, each with a one-line spoken response.",
    "VOICEMAIL VERSION — a 25-second version to leave if no answer.",
  ].join(" "),
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

  // effort "low": short sales messages need speed, not deep reasoning.
  const raw = (
    await aiComplete(system, lines.join("\n"), 1024, { effort: "low" })
  ).trim();

  if (params.channel === "email") {
    const match = /^SUBJECT:\s*(.+)\n+([\s\S]+)$/.exec(raw);
    if (match) {
      return { subject: match[1].trim(), body: match[2].trim() };
    }
    // Model skipped the SUBJECT line — keep the text, supply a fallback.
    return { subject: `question about ${prospect.company}`, body: raw };
  }
  return { subject: null, body: raw };
}

const PURPOSE_RULES: Record<MessagePurpose, string> = {
  first:
    "First touch. Open with something genuinely specific from the research, connect it to ONE concrete way AutomateIQ could help, close with a soft, low-pressure question.",
  follow_up:
    "First follow-up after no reply. Brief, add one NEW angle or piece of value from the research (don't repeat the first message), easy to answer.",
  second_follow_up:
    "Second and final follow-up. Very short, gracious, zero pressure — leave the door open and make clear you won't keep chasing.",
  meeting_confirmation:
    "They're ready to book. Warmly confirm, give them the booking link with one line on what the free AI Strategy Session covers.",
  thank_you:
    "Thank them after a meeting or positive exchange. Reference the conversation genuinely, confirm the agreed next step.",
};

const TRANSFORM_RULES: Record<StudioTransform, string> = {
  improve:
    "Improve this draft: tighter, more specific, more likely to get a reply. Keep the same structure, length and intent.",
  rewrite:
    "Rewrite this draft from scratch with a different opening and angle, same objective and roughly the same length.",
  shorten: "Cut this draft to roughly half its length without losing the core point or the call to action.",
  expand:
    "Expand this draft with one extra sentence or two of relevant, research-grounded substance. Never pad.",
};

function researchContext(report: ResearchReport | null): string {
  if (!report?.overview) return "";
  return [
    "COMPANY RESEARCH (use this — it's what makes the message personal):",
    `- Overview: ${report.overview}`,
    report.services.length ? `- Services: ${report.services.join("; ")}` : "",
    report.manual_processes.length
      ? `- Likely manual processes: ${report.manual_processes.join("; ")}`
      : "",
    report.ai_opportunities.length
      ? `- AI opportunities: ${report.ai_opportunities.join("; ")}`
      : "",
    report.proposal_angle ? `- Strongest angle: ${report.proposal_angle}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Message Studio drafting: purpose-driven generation and one-click
 * transforms (improve / rewrite / shorten / expand), grounded in the saved
 * company research. Output is always an editable draft — never sent by AI.
 */
export async function draftStudioMessage(
  prospect: ProspectContext,
  report: ResearchReport | null,
  params: {
    channel: Channel;
    purpose: MessagePurpose;
    tone: Tone;
    currentText?: string;
    transform?: StudioTransform;
  },
  bookingUrl: string,
  /** Price-book lines — the ONLY money figures the model may ever use. */
  pricing: string[] = []
): Promise<{ subject: string | null; body: string }> {
  const system = [
    "You are the senior sales development writer for AutomateIQ, an Irish AI-automation agency (automateiq.ie) whose goal is booking free 30-minute AI Strategy Sessions.",
    "Hard rules: be truthful — never invent statistics, client names, mutual connections or specifics not in the data provided. Write like one busy professional to another: no hype, no 'I hope this finds you well'.",
    "MONEY: if PRICING lines are provided they are the only figures you may use, framed as founding-customer rates — locked for the first 10 customers only, then rising (true scarcity, use it honestly when quoting). Bring price up ONLY when the task calls for it (answering a price question, a call script's objection section) — cold first messages never lead with price.",
    "Output ONLY the message itself — no preamble, options or commentary.",
  ].join("\n");

  const lines = [
    `CHANNEL: ${CHANNEL_RULES[params.channel]}`,
    params.transform && params.currentText
      ? `TASK: ${TRANSFORM_RULES[params.transform]}`
      : `TASK (${params.purpose.replace(/_/g, " ")}): ${PURPOSE_RULES[params.purpose]}`,
    `TONE: ${params.tone}`,
    "",
    "PROSPECT:",
    `- Contact: ${prospect.contact_name}${prospect.job_title ? `, ${prospect.job_title}` : ""}`,
    `- Company: ${prospect.company}`,
  ];
  if (prospect.industry) lines.push(`- Industry: ${prospect.industry}`);
  if (prospect.location) lines.push(`- Location: ${prospect.location}`);
  if (prospect.notes) {
    lines.push(
      `- Salesperson's field notes (weigh heavily — first-hand observations): ${prospect.notes}`
    );
  }
  const context = researchContext(report);
  if (context) lines.push("", context);
  if (pricing.length > 0) {
    lines.push("", "PRICING (founding-customer rates — the only figures permitted):", ...pricing);
  }
  if (params.purpose === "meeting_confirmation" || params.purpose === "thank_you") {
    lines.push("", `BOOKING LINK (free AI Strategy Session): ${bookingUrl}`);
  }
  if (params.transform && params.currentText) {
    lines.push("", "CURRENT DRAFT:", params.currentText.slice(0, 6000));
  }
  lines.push("", "Write the message now.");

  // effort "low": studio drafts/rewrites should come back in seconds.
  const raw = (
    await aiComplete(system, lines.join("\n"), 1500, { effort: "low" })
  ).trim();

  if (params.channel === "email") {
    const match = /^SUBJECT:\s*(.+)\n+([\s\S]+)$/.exec(raw);
    if (match) return { subject: match[1].trim(), body: match[2].trim() };
    return { subject: `question about ${prospect.company}`, body: raw };
  }
  return { subject: null, body: raw };
}
