/**
 * Shared vocabulary for the Growth Engine — statuses, channels and labels
 * used by both server actions and client components (no server-only here).
 * Badge classes map onto the existing design-system badges in globals.css.
 */

export type ProspectStatus =
  | "new"
  | "researching"
  | "research_complete"
  | "contacted"
  | "replied"
  | "qualified"
  | "meeting_booked"
  | "proposal_sent"
  | "won"
  | "lost"
  | "do_not_contact";

export const PROSPECT_STATUS_META: Record<
  ProspectStatus,
  { label: string; badge: string }
> = {
  new: { label: "New", badge: "badge-blue" },
  researching: { label: "Researching", badge: "badge-blue" },
  research_complete: { label: "Research complete", badge: "badge-blue" },
  contacted: { label: "Contacted", badge: "badge-orange" },
  replied: { label: "Replied", badge: "badge-green" },
  qualified: { label: "Qualified", badge: "badge-green" },
  meeting_booked: { label: "Meeting booked", badge: "badge-green" },
  proposal_sent: { label: "Proposal sent", badge: "badge-orange" },
  won: { label: "Won", badge: "badge-green" },
  lost: { label: "Lost", badge: "badge-red" },
  do_not_contact: { label: "Do not contact", badge: "badge-gray" },
};

export const PROSPECT_STATUSES = Object.keys(
  PROSPECT_STATUS_META
) as ProspectStatus[];

export type Channel = "linkedin" | "instagram" | "email" | "sms";

export const CHANNEL_META: Record<Channel, { label: string }> = {
  linkedin: { label: "LinkedIn" },
  instagram: { label: "Instagram" },
  email: { label: "Email" },
  sms: { label: "SMS" },
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
  | "thank_you";

export const PURPOSE_META: Record<MessagePurpose, { label: string }> = {
  first: { label: "First message" },
  follow_up: { label: "Follow-up" },
  second_follow_up: { label: "Second follow-up" },
  meeting_confirmation: { label: "Meeting confirmation" },
  thank_you: { label: "Thank-you" },
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
  const values: Record<string, string | undefined> = {
    first_name: firstName,
    contact_name: prospect.contact_name ?? undefined,
    company: prospect.company ?? undefined,
    industry: prospect.industry ?? undefined,
    location: prospect.location ?? undefined,
    booking_url: bookingUrl,
  };
  return text.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (match, key: string) =>
    values[key] !== undefined ? values[key]! : match
  );
}
