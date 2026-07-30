import { z } from "zod";

/**
 * The embeddable quote widget's configuration, carried in the URL.
 *
 * A hosted widget would normally need an account, a dashboard and a database
 * row per customer. Encoding the config in the embed URL means a business can
 * build one, paste the snippet into their site and be live in two minutes with
 * no signup at all — which is the only way "free" is actually free.
 *
 * The trade-off is honest and worth stating: the config is public (it's in the
 * URL) and anyone can edit it. That's fine, because it holds nothing but the
 * prices the business already publishes, and the widget only ever shows a
 * quote — it never takes money and never sends anything on their behalf.
 */

export const quoteConfigSchema = z.object({
  /** Business name shown on the widget. */
  b: z.string().trim().min(1).max(60),
  /** Where a completed quote should be emailed — used ONLY to build a mailto:
   *  link in the visitor's own mail client. Nothing is ever sent server-side. */
  e: z.string().trim().max(120).optional().default(""),
  /** Optional phone for the call-instead button. */
  p: z.string().trim().max(32).optional().default(""),
  /** Callout/base fee applied to every quote. */
  base: z.number().min(0).max(100000).optional().default(0),
  /** Services: name, price, and whether the price is per-unit or fixed. */
  s: z
    .array(
      z.object({
        n: z.string().trim().min(1).max(60),
        p: z.number().min(0).max(100000),
        /** "u" = priced per unit (per hour, per room, per metre), "f" = fixed. */
        k: z.enum(["u", "f"]).optional().default("f"),
        /** Unit label when k === "u". */
        u: z.string().trim().max(20).optional().default(""),
      })
    )
    .min(1)
    .max(12),
  /** Optional plus/minus percentage options (urgency, access, out of hours). */
  m: z
    .array(z.object({ n: z.string().trim().min(1).max(60), pct: z.number().min(-90).max(300) }))
    .max(6)
    .optional()
    .default([]),
  /** Shown under the total. Kept short. */
  note: z.string().trim().max(200).optional().default(""),
});

export type QuoteConfig = z.infer<typeof quoteConfigSchema>;

/** URL-safe base64 of the JSON. Not encryption — see the note above. */
export function encodeQuoteConfig(config: QuoteConfig): string {
  return Buffer.from(JSON.stringify(config)).toString("base64url");
}

export function decodeQuoteConfig(raw: string): QuoteConfig | null {
  try {
    // Cap the input before parsing: a giant string in a query param shouldn't
    // become a giant JSON.parse on every render of a public page.
    if (raw.length > 8000) return null;
    const json = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    const parsed = quoteConfigSchema.safeParse(json);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export const euro = (n: number) =>
  new Intl.NumberFormat("en-IE", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(Math.round(n));
