"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Send, Sparkles } from "lucide-react";
import {
  askTradesAssistant,
  type TradesChatTurn,
} from "@/app/tradeos/assistant-actions";

/** Inline text with **bold** honoured and /tradeos/... or https links tappable. */
function TextWithLinks({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s<>"']+|\/tradeos\/[^\s<>"']+)/g);
  return (
    <>
      {parts.map((part, i) => {
        if (/^(https?:\/\/|\/tradeos\/)/.test(part)) {
          const m = /^(.*?)([.,;:!?)]*)$/.exec(part)!;
          return (
            <span key={i}>
              <a
                href={m[1]}
                style={{ color: "var(--ac2, #3b82f6)", textDecoration: "underline", wordBreak: "break-all" }}
              >
                {m[1]}
              </a>
              {m[2]}
            </span>
          );
        }
        return part.split(/(\*\*[^*]+\*\*)/g).map((seg, j) =>
          seg.startsWith("**") && seg.endsWith("**") ? (
            <strong key={`${i}-${j}`}>{seg.slice(2, -2)}</strong>
          ) : (
            <span key={`${i}-${j}`}>{seg}</span>
          )
        );
      })}
    </>
  );
}

/** Bullets as indented rows, blank lines as spacing — same as Jarvis chat. */
function MessageBody({ text }: { text: string }) {
  return (
    <div style={{ display: "grid", gap: 2 }}>
      {text.split("\n").map((line, i) => {
        const trimmed = line.trim();
        if (!trimmed) return <div key={i} style={{ height: 8 }} />;
        const bullet = /^([•·]|-|✓|✗|\d+[.)])\s+(.*)$/.exec(trimmed);
        if (bullet) {
          return (
            <div key={i} style={{ display: "flex", gap: 7, paddingLeft: 4 }}>
              <span style={{ flexShrink: 0, color: "var(--faint)" }}>
                {/^[•·-]$/.test(bullet[1]) ? "•" : bullet[1]}
              </span>
              <span style={{ minWidth: 0 }}>
                <TextWithLinks text={bullet[2]} />
              </span>
            </div>
          );
        }
        return (
          <div key={i}>
            <TextWithLinks text={trimmed} />
          </div>
        );
      })}
    </div>
  );
}

const STARTERS = [
  "Who owes me money right now?",
  "Draft a quote for John Murphy — 8 hours labour at €65/hr and €120 materials",
  "Pull up a customer's phone number and email",
  "What did I invoice this month?",
];

// Conversation survives refresh/navigation in this browser only.
const MEMORY_KEY = "aiq-tradeos-assistant";

/**
 * The TradeOS assistant chat: ask about the books, pull customer details,
 * or have it create a draft quote — every answer from the account's live
 * data, nothing ever sent without the tradesperson.
 */
export function TradesAssistant() {
  const [turns, setTurns] = useState<TradesChatTurn[]>([]);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const scrollRef = useRef<HTMLDivElement>(null);

  function scrollToBottom(behavior: ScrollBehavior = "smooth") {
    requestAnimationFrame(() =>
      scrollRef.current?.scrollTo({ top: 99999, behavior })
    );
  }

  useEffect(() => {
    try {
      const saved = localStorage.getItem(MEMORY_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as TradesChatTurn[];
        if (Array.isArray(parsed) && parsed.length > 0) {
          setTurns(parsed.slice(-40));
          scrollToBottom("auto");
        }
      }
    } catch {
      /* corrupt/blocked storage — start fresh */
    }
  }, []);

  useEffect(() => {
    try {
      if (turns.length > 0) {
        localStorage.setItem(MEMORY_KEY, JSON.stringify(turns.slice(-40)));
      }
    } catch {
      /* storage full/blocked — chat still works in-memory */
    }
  }, [turns]);

  function ask(raw: string) {
    const question = raw.trim();
    if (!question || pending) return;
    setError(null);
    setInput("");
    const history = turns;
    setTurns((t) => [...t, { role: "user", text: question }]);
    scrollToBottom();
    startTransition(async () => {
      const res = await askTradesAssistant(history, question).catch(() => ({
        ok: false as const,
        error: "Network hiccup — ask again.",
      }));
      if (res.ok) {
        setTurns((t) => [...t, { role: "assistant", text: res.answer }]);
      } else {
        setError(res.error);
        // Roll the failed question back (and out of storage) so one tap retries.
        setTurns((t) => {
          const next = t.slice(0, -1);
          try {
            if (next.length > 0) {
              localStorage.setItem(MEMORY_KEY, JSON.stringify(next.slice(-40)));
            } else {
              localStorage.removeItem(MEMORY_KEY);
            }
          } catch {
            /* storage blocked */
          }
          return next;
        });
        setInput(question);
      }
      scrollToBottom();
    });
  }

  return (
    <section className="panel panel-block" aria-label="Assistant">
      <h2 className="panel-title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ flex: 1 }}>
          <Sparkles size={16} style={{ verticalAlign: "-3px" }} /> Ask your assistant
        </span>
        {turns.length > 0 && (
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => {
              setTurns([]);
              try {
                localStorage.removeItem(MEMORY_KEY);
              } catch {
                /* ignore */
              }
            }}
            title="Clear this saved conversation"
          >
            Clear
          </button>
        )}
      </h2>
      <p style={{ fontSize: 12, color: "var(--faint)", marginTop: 0 }}>
        It reads your live quotes, invoices, customers and bills on every
        answer — and it can draft a quote for you. Nothing is ever sent
        without you.
      </p>

      {turns.length === 0 && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
          {STARTERS.map((s) => (
            <button
              key={s}
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => ask(s)}
              disabled={pending}
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {turns.length > 0 && (
        <div
          ref={scrollRef}
          style={{
            display: "grid",
            gap: 10,
            maxHeight: 460,
            overflowY: "auto",
            marginBottom: 12,
            paddingRight: 4,
          }}
        >
          {turns.map((t, i) => (
            <div
              key={i}
              style={{
                justifySelf: t.role === "user" ? "end" : "start",
                maxWidth: "85%",
                padding: "10px 14px",
                borderRadius: 12,
                fontSize: 14,
                whiteSpace: "pre-wrap",
                background:
                  t.role === "user" ? "var(--ac2, #3b82f6)" : "rgba(255,255,255,.06)",
                color: t.role === "user" ? "#fff" : "inherit",
                border:
                  t.role === "user" ? "none" : "1px solid var(--line, rgba(255,255,255,.08))",
              }}
            >
              {t.role === "assistant" ? <MessageBody text={t.text} /> : t.text}
            </div>
          ))}
          {pending && (
            <div style={{ fontSize: 13, color: "var(--faint)" }}>
              Checking your books…
            </div>
          )}
        </div>
      )}

      {error && (
        <p style={{ fontSize: 13, color: "var(--orange, #fb923c)", margin: "0 0 8px" }}>
          {error}
        </p>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          ask(input);
        }}
        style={{ display: "flex", gap: 8 }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about a customer, a quote, who owes you…"
          aria-label="Ask the assistant"
          maxLength={2000}
          style={{ flex: 1, margin: 0 }}
          disabled={pending}
        />
        <button type="submit" className="btn btn-primary" disabled={pending || !input.trim()}>
          <Send size={14} /> {pending ? "Thinking…" : "Ask"}
        </button>
      </form>
    </section>
  );
}
