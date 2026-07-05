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

export const DEFAULT_STL_SUBJECT = "Thanks {{name}} — we've got your enquiry";

export const DEFAULT_STL_TEMPLATE = `Hi {{name}},

Thanks for getting in touch with {{business}} — your message just landed with us and it's already in front of the team.

We'll come back to you personally as soon as possible, usually within the hour during working hours.

Talk soon,
{{business}}`;
