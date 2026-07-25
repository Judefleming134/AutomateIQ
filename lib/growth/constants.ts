/**
 * Shared vocabulary for the Growth Engine — statuses, channels and labels
 * used by both server actions and client components (no server-only here).
 * Badge classes map onto the existing design-system badges in globals.css.
 */

export type ProspectStatus =
  | "new"
  | "researching"
  | "research_failed"
  | "research_complete"
  | "outreach_ready"
  | "contacted"
  | "follow_up_sent"
  | "replied"
  | "qualified"
  | "meeting_booked"
  | "proposal_in_progress"
  | "proposal_sent"
  | "negotiation"
  | "won"
  | "lost"
  | "future_opportunity"
  | "do_not_contact"
  | "archived";

// Pipeline order. "Follow-up due" is deliberately NOT a status — it's the
// derived state next_follow_up_at <= today, which the dashboard reminders
// already surface; storing it would fight that automation.
export const PROSPECT_STATUS_META: Record<
  ProspectStatus,
  { label: string; badge: string }
> = {
  new: { label: "New", badge: "badge-blue" },
  researching: { label: "Researching", badge: "badge-blue" },
  research_failed: { label: "Research failed", badge: "badge-red" },
  research_complete: { label: "Research complete", badge: "badge-blue" },
  outreach_ready: { label: "Outreach ready", badge: "badge-blue" },
  contacted: { label: "Contacted", badge: "badge-orange" },
  follow_up_sent: { label: "Follow-up sent", badge: "badge-orange" },
  replied: { label: "Replied", badge: "badge-green" },
  qualified: { label: "Qualified", badge: "badge-green" },
  meeting_booked: { label: "Meeting booked", badge: "badge-green" },
  proposal_in_progress: { label: "Proposal in progress", badge: "badge-orange" },
  proposal_sent: { label: "Proposal sent", badge: "badge-orange" },
  negotiation: { label: "Negotiation", badge: "badge-orange" },
  won: { label: "Won", badge: "badge-green" },
  lost: { label: "Lost", badge: "badge-red" },
  future_opportunity: { label: "Future opportunity", badge: "badge-gray" },
  do_not_contact: { label: "Do not contact", badge: "badge-gray" },
  archived: { label: "Archived", badge: "badge-gray" },
};

/** Stages where the prospect is out of active play (reminders cleared,
 *  except future_opportunity which keeps its long-dated re-engagement). */
export const CLOSED_STATUSES: ProspectStatus[] = [
  "won",
  "lost",
  "do_not_contact",
  "archived",
];

export const PROSPECT_STATUSES = Object.keys(
  PROSPECT_STATUS_META
) as ProspectStatus[];

export type Channel = "linkedin" | "instagram" | "facebook" | "email" | "sms" | "call";

export const CHANNEL_META: Record<Channel, { label: string }> = {
  linkedin: { label: "LinkedIn" },
  instagram: { label: "Instagram" },
  facebook: { label: "Facebook" },
  email: { label: "Email" },
  sms: { label: "SMS" },
  call: { label: "Phone call" },
};

export const CHANNELS = Object.keys(CHANNEL_META) as Channel[];

export type CampaignStatus = "draft" | "active" | "paused" | "completed";

export const CAMPAIGN_STATUS_META: Record<
  CampaignStatus,
  { label: string; badge: string }
> = {
  draft: { label: "Draft", badge: "badge-gray" },
  active: { label: "Active", badge: "badge-green" },
  paused: { label: "Paused", badge: "badge-orange" },
  completed: { label: "Completed", badge: "badge-blue" },
};

export const CAMPAIGN_STATUSES = Object.keys(
  CAMPAIGN_STATUS_META
) as CampaignStatus[];

export type MessageObjective =
  | "initial"
  | "follow_up"
  | "re_engagement"
  | "confirmation"
  | "reply";

export const OBJECTIVE_META: Record<MessageObjective, { label: string }> = {
  initial: { label: "Initial outreach" },
  follow_up: { label: "Follow-up" },
  re_engagement: { label: "Re-engagement" },
  confirmation: { label: "Meeting confirmation / booking invite" },
  reply: { label: "Reply to their message" },
};

export const OBJECTIVES = Object.keys(OBJECTIVE_META) as MessageObjective[];

export const TONES = [
  "professional",
  "friendly",
  "executive",
  "consultative",
  "direct",
] as const;
export type Tone = (typeof TONES)[number];

/** The Message Studio's five draft types per channel. */
export type MessagePurpose =
  | "first"
  | "follow_up"
  | "second_follow_up"
  | "meeting_confirmation"
  | "thank_you"
  | "reply";

export const PURPOSE_META: Record<MessagePurpose, { label: string }> = {
  first: { label: "First message" },
  follow_up: { label: "Follow-up" },
  second_follow_up: { label: "Second follow-up" },
  meeting_confirmation: { label: "Meeting confirmation" },
  thank_you: { label: "Thank-you" },
  reply: { label: "Reply" },
};

export const PURPOSES = Object.keys(PURPOSE_META) as MessagePurpose[];

/** Message Studio transform buttons. */
export type StudioTransform = "improve" | "rewrite" | "shorten" | "expand";

export type Sentiment = "positive" | "neutral" | "negative";

export const SENTIMENT_META: Record<Sentiment, { label: string; badge: string }> = {
  positive: { label: "Positive", badge: "badge-green" },
  neutral: { label: "Neutral", badge: "badge-gray" },
  negative: { label: "Negative", badge: "badge-red" },
};

export type MessageStatus = "draft" | "queued" | "sent" | "failed" | "received";

export const MESSAGE_STATUS_META: Record<
  MessageStatus,
  { label: string; badge: string }
> = {
  draft: { label: "Draft", badge: "badge-gray" },
  queued: { label: "Queued", badge: "badge-orange" },
  sent: { label: "Sent", badge: "badge-blue" },
  failed: { label: "Failed", badge: "badge-red" },
  received: { label: "Received", badge: "badge-green" },
};

export type QualificationStatus =
  | "unqualified"
  | "in_review"
  | "qualified"
  | "disqualified";

export const QUALIFICATION_META: Record<
  QualificationStatus,
  { label: string; badge: string }
> = {
  unqualified: { label: "Unqualified", badge: "badge-gray" },
  in_review: { label: "In review", badge: "badge-orange" },
  qualified: { label: "Qualified", badge: "badge-green" },
  disqualified: { label: "Disqualified", badge: "badge-red" },
};

export type MeetingStatus = "booked" | "completed" | "cancelled" | "no_show";

export const MEETING_STATUS_META: Record<
  MeetingStatus,
  { label: string; badge: string }
> = {
  booked: { label: "Booked", badge: "badge-blue" },
  completed: { label: "Completed", badge: "badge-green" },
  cancelled: { label: "Cancelled", badge: "badge-gray" },
  no_show: { label: "No-show", badge: "badge-red" },
};

/**
 * Fills the {{placeholders}} used by message templates. Unknown placeholders
 * are left intact so the sender notices them instead of sending "undefined".
 */
export function fillTemplate(
  text: string,
  prospect: {
    contact_name?: string | null;
    company?: string | null;
    industry?: string | null;
    location?: string | null;
  },
  bookingUrl: string
): string {
  const firstName = (prospect.contact_name ?? "").trim().split(/\s+/)[0] || "there";
  // Every advertised placeholder gets a real fallback, so a KNOWN key never
  // leaks a literal "{{contact_name}}" into the message when the field is empty
  // — which is common for company-only leads and would otherwise show to the
  // customer (or trip the send gate's {{…}} check and hold the email). An
  // absent contact name reads as "there"; the other blanks drop out cleanly.
  // Unknown keys are left as-is so a genuine typo stays visible to catch.
  const values: Record<string, string> = {
    first_name: firstName,
    contact_name: (prospect.contact_name ?? "").trim() || firstName,
    company: (prospect.company ?? "").trim(),
    industry: (prospect.industry ?? "").trim(),
    location: (prospect.location ?? "").trim(),
    booking_url: bookingUrl,
  };
  return text.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (match, key: string) =>
    key in values ? values[key] : match
  );
}
