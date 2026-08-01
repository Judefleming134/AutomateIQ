/**
 * Speed-to-Lead reply template substitution. Placeholders: {{name}} (the
 * lead's name) and {{business}} (the business name). Shared by the settings
 * preview and the lead-capture route so what the customer previews is
 * exactly what gets sent.
 */
export function renderTemplate(
  template: string,
  vars: { name: string; business: string }
): string {
  return template
    .replaceAll("{{name}}", vars.name)
    .replaceAll("{{business}}", vars.business);
}

/** The only variables that get filled in. Anything else survives to the lead. */
export const SUPPORTED_VARS = ["name", "business"] as const;

/**
 * Placeholders in a template that will NOT be substituted.
 *
 * renderTemplate replaces exactly two tokens. Anything else — `{{first_name}}`,
 * `{{Name}}`, `{{company}}`, a typo — is left completely untouched and goes out
 * verbatim in an email to a real customer:
 *
 *     Hi {{first_name}}, thanks for contacting {{business}}
 *
 * The Growth Engine already refuses to SEND on exactly this (draftLooksBroken
 * flags an unfilled {{placeholder}} before an email can reach a prospect).
 * LeadIQ had no equivalent, and it is the worse place for it: this template is
 * saved once and then sent to EVERY lead, unattended, until somebody notices.
 *
 * Returned in first-appearance order, de-duplicated, so the message can name
 * them without repeating itself.
 */
export function unknownPlaceholders(template: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const match of template.matchAll(/\{\{\s*([^}]*?)\s*\}\}/g)) {
    const token = match[1];
    if ((SUPPORTED_VARS as readonly string[]).includes(token)) continue;
    if (seen.has(token)) continue;
    seen.add(token);
    out.push(token);
  }
  return out;
}

/**
 * The sentence shown when a template contains something that won't be filled.
 *
 * Names the offenders and the two that do work, because "invalid placeholder"
 * on its own leaves the customer guessing at the spelling — and a wrong guess
 * here is not a validation error, it is an email to a stranger.
 *
 * Suggests the right token when the mistake is only casing or a near-miss,
 * which is what a typo actually looks like.
 */
export function placeholderProblem(template: string): string | null {
  const unknown = unknownPlaceholders(template);
  if (unknown.length === 0) return null;
  const named = unknown.map((u) => {
    const lower = u.toLowerCase();
    // BEST match, not the first one that happens to fit. Scanning in
    // declaration order suggested {{name}} for "business_name", because
    // "business_name".includes("name") is true — the more specific candidate
    // has to win or the hint sends them to the wrong variable.
    const guess = (SUPPORTED_VARS as readonly string[])
      .filter((v) => v === lower || lower.includes(v))
      .sort((a, b) => {
        if (a === lower) return -1;
        if (b === lower) return 1;
        return b.length - a.length;
      })[0];
    return guess ? `{{${u}}} (did you mean {{${guess}}}?)` : `{{${u}}}`;
  });
  return `${named.join(", ")} ${unknown.length === 1 ? "isn't" : "aren't"} filled in automatically, so ${unknown.length === 1 ? "it" : "they"} would be sent to your customer exactly as written. Only {{name}} and {{business}} are replaced.`;
}

/** Sample values for the preview — obviously a sample, never a real lead. */
export const PREVIEW_VARS = { name: "Sarah", business: "your business" };

export const DEFAULT_STL_SUBJECT = "Thanks {{name}} — we've got your enquiry";

export const DEFAULT_STL_TEMPLATE = `Hi {{name}},

Thanks for getting in touch with {{business}} — your message just landed with us and it's already in front of the team.

We'll come back to you personally as soon as possible, usually within the hour during working hours.

Talk soon,
{{business}}`;
