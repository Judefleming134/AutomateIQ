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

/**
 * URL-safe base64, implemented without Buffer. Not encryption — see the note
 * above.
 *
 * WHY NOT Buffer: `encodeQuoteConfig` is called from builder.tsx, which is a
 * "use client" component, so this runs in the browser. Node's Buffer supports
 * the "base64url" encoding; the polyfill bundlers substitute in the browser
 * does not, and threw
 *
 *     TypeError: Unknown encoding: base64url
 *
 * on hydration — which took the entire /freetools/quote-builder page down with
 * it. The tool was completely unusable and had been advertised as working.
 *
 * The output is byte-for-byte what Buffer produced, because base64url is just
 * base64 with `+`→`-`, `/`→`_` and the `=` padding dropped. That matters: the
 * embed snippets already pasted into customers' own websites carry strings
 * made by the old code, and `/embed/quote` has to keep reading them forever.
 */
function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  // Chunked: String.fromCharCode(...bytes) blows the argument limit on a large
  // config, and this runs on user input.
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToBytes(raw: string): Uint8Array {
  const b64 = raw.replace(/-/g, "+").replace(/_/g, "/");
  // atob rejects an unpadded string in some engines, so pad it back.
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export function encodeQuoteConfig(config: QuoteConfig): string {
  // TextEncoder, not charCodeAt: a business name like "Ó Briain Plumbing" is
  // multi-byte, and btoa alone only handles latin1.
  return bytesToBase64Url(new TextEncoder().encode(JSON.stringify(config)));
}

export function decodeQuoteConfig(raw: string): QuoteConfig | null {
  try {
    // Cap the input before parsing: a giant string in a query param shouldn't
    // become a giant JSON.parse on every render of a public page.
    if (raw.length > 8000) return null;
    const json = JSON.parse(new TextDecoder().decode(base64UrlToBytes(raw)));
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
