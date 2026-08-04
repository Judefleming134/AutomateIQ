import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { MARKETING_PRODUCTS, getMarketingProduct } from "./marketing";

/**
 * The public product pages may not promise something the code cannot do.
 *
 * /products/tradeiq claimed, under "Invoice and get paid":
 *
 *     "Quotes become invoices in one step, WITH ONLINE CARD PAYMENT ON THE
 *      LINK. Chasing is automatic rather than a job for a Sunday evening."
 *
 * Nothing in this codebase takes a card. The public invoice page states the
 * amount owed and says to pay "using the details {business} gave you, quoting
 * {number}"; app/tradeiq/actions.ts answers any attempt with "Online payment
 * isn't switched on yet — pay by the usual method." The claim was carried on
 * the register in docs/OUTSTANDING.md as unbacked for weeks.
 *
 * This is not a cosmetic copy bug. A prospect who buys on that sentence finds
 * out it is false the first time they send an invoice — and while AutomateIQ
 * has one customer, that customer is also the only reference, the only case
 * study and the only source of referrals. It is the one lie there is no
 * recovering from.
 *
 * So: no marketing bullet may assert card/online payment until something in
 * the app actually takes one. If card payment IS built later, the check below
 * for a real implementation is what unlocks the claim — it is a gate, not a
 * ban.
 */

const ROOT = path.resolve(import.meta.dirname, "..", "..");

/** Every word of prose the marketing pages render for a product. */
const prose = (p: (typeof MARKETING_PRODUCTS)[number]) =>
  [p.headline, p.sub, p.who, ...p.does.flatMap((d) => [d.title, d.body])].join(" ");

/**
 * Does anything customer-facing actually take a card for a quote or invoice?
 * Deliberately narrow: the Stripe code that exists is for AutomateIQ's OWN
 * subscription billing (lib/billing), not for a trade's customer paying an
 * invoice — which is what the bullet was promising.
 */
function invoicePaymentIsBuilt(): boolean {
  const invoicePage = readFileSync(
    path.join(ROOT, "app", "i", "[token]", "page.tsx"),
    "utf8"
  );
  const quotePage = readFileSync(
    path.join(ROOT, "app", "q", "[token]", "page.tsx"),
    "utf8"
  );
  return /stripe|checkout\.session|payment_intent|createCheckout/i.test(
    invoicePage + quotePage
  );
}

const CARD_CLAIM =
  /\b(card payment|pay by card|pay online|online payment|online card|take(?:s)? (?:a )?card|card on the link)\b/i;

describe("no marketing bullet promises a payment rail that isn't built", () => {
  it("the exact TradeIQ claim is gone", () => {
    const tradeiq = getMarketingProduct("tradeiq");
    expect(tradeiq).toBeDefined();
    expect(prose(tradeiq!)).not.toMatch(/online card payment on the link/i);
  });

  it("no product claims card or online payment while none is implemented", () => {
    if (invoicePaymentIsBuilt()) {
      // Someone built it — the claim is now allowed, and this test stops
      // guarding. Delete it or narrow it then; do not weaken it before.
      return;
    }
    const offenders = MARKETING_PRODUCTS.filter((p) => CARD_CLAIM.test(prose(p))).map(
      (p) => p.slug
    );
    expect(
      offenders,
      `these promise card/online payment, but nothing in /i or /q takes one: ${offenders.join(", ")}`
    ).toEqual([]);
  });

  it("the app itself is still honest about it", () => {
    // The one place that mentions it says it is NOT on — that sentence is the
    // reason the marketing claim was a contradiction, so it has to stay true.
    const actions = readFileSync(
      path.join(ROOT, "app", "tradeiq", "actions.ts"),
      "utf8"
    );
    expect(actions).toContain("Online payment isn't switched on yet");
  });

  it("the public invoice page still tells the customer how to actually pay", () => {
    const invoicePage = readFileSync(
      path.join(ROOT, "app", "i", "[token]", "page.tsx"),
      "utf8"
    );
    expect(invoicePage).toContain("using the details");
    expect(invoicePage).toContain("quoting");
  });
});

describe("what replaced it is all real", () => {
  const tradeiq = getMarketingProduct("tradeiq")!;
  const bullet = tradeiq.does.find((d) => /invoice/i.test(d.title));

  it("there is still an invoicing bullet — nothing was deleted from the page", () => {
    expect(bullet).toBeDefined();
  });

  it("the per-invoice link it claims exists", () => {
    expect(bullet!.body).toMatch(/link/i);
    // app/i/[token] is that link.
    expect(
      readFileSync(path.join(ROOT, "app", "i", "[token]", "page.tsx"), "utf8")
    ).toContain("invoice.number");
  });

  it("the part-payment display it claims exists", () => {
    expect(bullet!.body).toMatch(/part payment/i);
    const invoicePage = readFileSync(
      path.join(ROOT, "app", "i", "[token]", "page.tsx"),
      "utf8"
    );
    expect(invoicePage).toContain("Already paid");
    expect(invoicePage).toContain("Still due");
  });

  it("the automatic overdue reminders it claims exist", () => {
    expect(bullet!.body).toMatch(/reminders? go out on their own|overdue/i);
    const chaser = readFileSync(
      path.join(ROOT, "lib", "cron", "invoice-chaser.ts"),
      "utf8"
    );
    expect(chaser).toContain("chase_count");
    expect(chaser).toContain("resend.emails.send");
  });

  it("quote → invoice in one step is still claimed, and still true", () => {
    expect(bullet!.body).toMatch(/quotes? become invoices in one step/i);
    // The action that does it: reads the quote, writes the invoice, keyed on
    // quote_id so one quote can only ever raise one invoice.
    const invoiceActions = readFileSync(
      path.join(ROOT, "app", "portal", "instant-quote-agent", "invoice-actions.ts"),
      "utf8"
    );
    expect(invoiceActions).toContain('.from("qa_quotes")');
    expect(invoiceActions).toContain('.from("qa_invoices")');
    expect(invoiceActions).toContain('.eq("quote_id", quoteId)');
  });
});
