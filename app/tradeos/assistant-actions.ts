"use server";

import { revalidatePath } from "next/cache";
import { requireTradesAccount } from "@/lib/trades/data";
import { computeTotals, formatEuro, nextDocumentNumber, dueDateFrom } from "@/lib/trades/core";
import { aiComplete } from "@/lib/ai/complete";
import { NO_PROVIDER_MESSAGE } from "@/lib/ai/config";

export type TradesChatTurn = { role: "user" | "assistant"; text: string };

export type TradesAssistantResult =
  | { ok: true; answer: string }
  | { ok: false; error: string };

/** Structured response: what to say + (optionally) quotes to create. */
const ASSISTANT_SCHEMA = {
  type: "object",
  properties: {
    reply: { type: "string" },
    actions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          type: { type: "string" },
          customer: { type: "string" },
          notes: { type: "string" },
          items: {
            type: "array",
            items: {
              type: "object",
              properties: {
                description: { type: "string" },
                quantity: { type: "number" },
                unit_price: { type: "number" },
              },
              required: ["description", "quantity", "unit_price"],
              additionalProperties: false,
            },
          },
        },
        required: ["type", "customer", "notes", "items"],
        additionalProperties: false,
      },
    },
  },
  required: ["reply", "actions"],
  additionalProperties: false,
} as const;

type AssistantAction = {
  type: string;
  customer: string;
  notes: string;
  items: { description: string; quantity: number; unit_price: number }[];
};

/**
 * Executes ONE whitelisted assistant action. Deliberately narrow, mirroring
 * Jarvis: the assistant can CREATE A DRAFT QUOTE (never send anything) —
 * everything else it does is answering from the data snapshot. All writes go
 * through the caller's RLS client, so they can only ever touch their own rows.
 */
async function runAssistantAction(
  supabase: Awaited<ReturnType<typeof requireTradesAccount>>["supabase"],
  account: Awaited<ReturnType<typeof requireTradesAccount>>["account"],
  a: AssistantAction
): Promise<string> {
  if (a.type !== "create_quote") return `✗ ${a.type}: not something I can do`;
  const customerName = (a.customer ?? "").trim().slice(0, 160);
  if (!customerName) return "✗ quote: no customer name given";
  const items = (Array.isArray(a.items) ? a.items : [])
    .filter(
      (it) =>
        it &&
        typeof it.description === "string" &&
        Number.isFinite(Number(it.quantity)) &&
        Number.isFinite(Number(it.unit_price)) &&
        (it.description.trim() || Number(it.unit_price) > 0)
    )
    .slice(0, 20)
    .map((it) => ({
      description: String(it.description).trim().slice(0, 300),
      quantity: Number(it.quantity),
      unitPrice: Number(it.unit_price),
    }));
  if (items.length === 0) return `✗ ${customerName}: no line items to quote`;

  // Find the customer by name (case-insensitive, wildcards escaped) or create
  // them — same behaviour as the quote editor's typed-name path.
  const { data: existingCust } = await supabase
    .from("trades_customers")
    .select("id, name")
    .ilike("name", customerName.replace(/([%_\\])/g, "\\$1"))
    .limit(1)
    .maybeSingle();
  let customerId = existingCust?.id as string | undefined;
  if (!customerId) {
    const { data: created, error: custErr } = await supabase
      .from("trades_customers")
      .insert({ account_id: account.id, name: customerName })
      .select("id")
      .single();
    if (custErr || !created) return `✗ ${customerName}: couldn't save the customer`;
    customerId = created.id;
  }

  const totals = computeTotals(items, account.vat_rate);
  const { number, nextSeq } = nextDocumentNumber("quote", account.quote_seq);
  const today = new Date();
  const { data: doc, error: docErr } = await supabase
    .from("trades_documents")
    .insert({
      account_id: account.id,
      customer_id: customerId,
      kind: "quote",
      number,
      status: "draft",
      notes: (a.notes ?? "").trim().slice(0, 2000) || null,
      subtotal: totals.subtotal,
      vat_rate: account.vat_rate,
      vat_amount: totals.vatAmount,
      total: totals.total,
      issued_at: today.toISOString().slice(0, 10),
      due_at: dueDateFrom(today, account.payment_terms_days),
    })
    .select("id")
    .single();
  if (docErr || !doc) return `✗ ${customerName}: couldn't create the quote`;

  const { error: liErr } = await supabase.from("trades_line_items").insert(
    totals.lines.map((l, i) => ({
      document_id: doc.id,
      description: l.description.trim(),
      quantity: l.quantity,
      unit_price: l.unitPrice,
      amount: l.amount,
      position: i,
    }))
  );
  if (liErr) return `✗ ${customerName}: quote saved but the lines failed — open it and re-add them`;
  await supabase.from("trades_accounts").update({ quote_seq: nextSeq }).eq("id", account.id);

  revalidatePath("/tradeos");
  return `✓ Draft quote ${number} for ${existingCust?.name ?? customerName} — ${formatEuro(totals.total)} inc. VAT. Review & send: /tradeos/documents/${doc.id}`;
}

/**
 * The TradeOS assistant: a chat over the account's LIVE books. Every question
 * rebuilds a fresh snapshot (documents, customers, bills) through the caller's
 * RLS client, so answers only ever come from their own data — and money
 * figures only from real rows, never invented. It can also CREATE draft
 * quotes; sending anything stays with the tradesperson.
 */
export async function askTradesAssistant(
  history: TradesChatTurn[],
  question: string
): Promise<TradesAssistantResult> {
  const { supabase, account } = await requireTradesAccount();
  const q = (question ?? "").trim().slice(0, 2000);
  if (!q) return { ok: false, error: "Ask me something." };

  const today = new Date().toISOString().slice(0, 10);
  const [{ data: customers }, { data: documents }, { data: expenses }] = await Promise.all([
    supabase
      .from("trades_customers")
      .select("name, email, phone, address")
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("trades_documents")
      .select("kind, number, status, total, issued_at, due_at, trades_customers(name)")
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("trades_expenses")
      .select("direction, counterparty, total, status, due_at, category")
      .order("created_at", { ascending: false })
      .limit(100),
  ]);

  const customerLines = (customers ?? []).map((c) =>
    `- ${c.name}${c.phone ? ` | ☎ ${c.phone}` : ""}${c.email ? ` | ✉ ${c.email}` : ""}${c.address ? ` | ${c.address}` : ""}`
  );
  const docLines = (documents ?? []).map((d) => {
    const cust = (d.trades_customers as unknown as { name?: string } | null)?.name ?? "?";
    const overdue =
      d.kind === "invoice" && d.status !== "paid" && d.status !== "void" && d.due_at && d.due_at < today
        ? " OVERDUE"
        : "";
    return `- ${d.number} | ${d.kind} | ${cust} | ${formatEuro(Number(d.total))} | ${d.status}${overdue} | issued ${d.issued_at ?? "?"} due ${d.due_at ?? "?"}`;
  });
  const billLines = (expenses ?? [])
    .filter((e) => e.direction === "payable")
    .map((e) => `- ${e.counterparty} | ${e.category ?? "?"} | ${formatEuro(Number(e.total))} | ${e.status}${e.status === "unpaid" && e.due_at && e.due_at < today ? " OVERDUE" : ""}`);

  const invoices = (documents ?? []).filter((d) => d.kind === "invoice");
  const owedIn = invoices
    .filter((d) => d.status !== "paid" && d.status !== "void")
    .reduce((s, d) => s + Number(d.total), 0);
  const owedOut = (expenses ?? [])
    .filter((e) => e.direction === "payable" && e.status === "unpaid")
    .reduce((s, e) => s + Number(e.total), 0);

  const system = [
    `You are the AutomateIQ assistant inside TradeOS for "${account.business_name || "this business"}"${account.trade ? ` (${account.trade})` : ""}. You help run their quotes, invoices, customers and money — plain-spoken, fast, zero fluff.`,
    "HARD RULES:",
    "- Ground every answer in the DATA SNAPSHOT. Name real customers, documents and amounts from it. If the data doesn't hold the answer, say what's missing — never invent a number, price, or customer.",
    "- When asked for a customer's details, give exactly what's on file (phone/email/address) — and say plainly if a field is missing.",
    `- Money: VAT rate on new quotes is ${account.vat_rate}% (their setting). NEVER invent unit prices — if they didn't give a price for a line, ask for it instead of guessing.`,
    "- YOU CAN CREATE DRAFT QUOTES. When asked to draft/generate a quote and prices are given, add ONE action: {type:'create_quote', customer:'name', notes:'', items:[{description, quantity, unit_price}]} (unit_price ex-VAT). Say in `reply` what you're creating. Maximum 3 quotes per turn. Never anything else in actions; `actions` is [] for plain questions.",
    "- You never SEND anything — quotes are drafts they review and send themselves.",
    "FORMAT for a phone screen: short lines starting '• ', blank line between sections, **bold** for names and euro amounts. No tables, no headings.",
  ].join("\n");

  const convo = history
    .slice(-8)
    .map((t) => `${t.role === "user" ? "THEM" : "ASSISTANT"}: ${String(t.text).slice(0, 1200)}`)
    .join("\n");

  const prompt = [
    `TODAY: ${today}`,
    "",
    "DATA SNAPSHOT (live, just queried — their whole account):",
    `MONEY: owed to them ${formatEuro(owedIn)} (unpaid invoices) · bills to pay ${formatEuro(owedOut)}`,
    "",
    `CUSTOMERS (${customerLines.length}):`,
    customerLines.join("\n") || "(none yet)",
    "",
    `QUOTES & INVOICES (${docLines.length}, newest first):`,
    docLines.join("\n") || "(none yet)",
    "",
    `BILLS (${billLines.length}):`,
    billLines.join("\n") || "(none tracked)",
    "",
    convo ? `CONVERSATION SO FAR:\n${convo}\n` : "",
    `THEIR QUESTION: ${q}`,
    "",
    'Respond as JSON: {"reply": "...", "actions": [...]}.',
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const raw = (
      await aiComplete(system, prompt, 1200, {
        json: true,
        effort: "low",
        timeoutMs: 45_000,
        schema: ASSISTANT_SCHEMA as unknown as Record<string, unknown>,
      })
    ).trim();

    let reply = raw;
    let actions: AssistantAction[] = [];
    try {
      const stripped = raw.replace(/```json|```/g, "").trim();
      const start = stripped.indexOf("{");
      const end = stripped.lastIndexOf("}");
      const parsed = JSON.parse(stripped.slice(start, end + 1)) as {
        reply?: string;
        actions?: AssistantAction[];
      };
      if (typeof parsed.reply === "string" && parsed.reply.trim()) {
        reply = parsed.reply.trim();
        actions = Array.isArray(parsed.actions) ? parsed.actions.slice(0, 3) : [];
      }
    } catch {
      // Unparseable — treat the whole output as a plain reply.
    }

    if (actions.length > 0) {
      const results: string[] = [];
      for (const a of actions) {
        results.push(await runAssistantAction(supabase, account, a));
      }
      reply = `${reply}\n\n${results.join("\n")}`;
    }

    return { ok: true, answer: reply };
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    if (message === "NO_PROVIDER") return { ok: false, error: NO_PROVIDER_MESSAGE };
    if (message.startsWith("HTTP 429"))
      return { ok: false, error: "Hitting the AI rate limit — give it ~30 seconds and try again." };
    if (/^HTTP 5\d\d/.test(message))
      return { ok: false, error: "The AI service is briefly overloaded — try again in a minute." };
    return { ok: false, error: "Something went wrong answering that — ask again." };
  }
}
