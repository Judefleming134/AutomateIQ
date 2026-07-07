"use client";

import { useRef, useState, useTransition } from "react";
import { Send, Sparkles } from "lucide-react";
import { askJarvis, type JarvisTurn } from "@/app/growth/(app)/jarvis/actions";

const STARTERS = [
  "Who should I contact first today and why?",
  "Give me my plan for today, in order.",
  "How's my pipeline actually looking?",
  "Which industry and channel are working best?",
];

/**
 * The conversation lives in client state (a working session, not a record);
 * every question triggers a fresh server-side snapshot of the CRM, so Jarvis
 * always answers from live data.
 */
export function JarvisChat() {
  const [turns, setTurns] = useState<JarvisTurn[]>([]);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const scrollRef = useRef<HTMLDivElement>(null);

  function ask(raw: string) {
    const question = raw.trim();
    if (!question || pending) return;
    setError(null);
    setInput("");
    const history = turns;
    setTurns((t) => [...t, { role: "user", text: question }]);
    startTransition(async () => {
      const res = await askJarvis(history, question).catch(() => ({
        ok: false as const,
        error: "Network hiccup — ask again.",
      }));
      if (res.ok) {
        setTurns((t) => [...t, { role: "jarvis", text: res.answer }]);
      } else {
        setError(res.error);
        // Put the failed question back so one tap retries it.
        setTurns((t) => t.slice(0, -1));
        setInput(question);
      }
      requestAnimationFrame(() =>
        scrollRef.current?.scrollTo({ top: 99999, behavior: "smooth" })
      );
    });
  }

  return (
    <section className="panel panel-block" aria-label="Talk to Jarvis">
      <h2 className="panel-title">
        <Sparkles size={16} style={{ verticalAlign: "-3px" }} /> Talk to Jarvis
      </h2>
      <p style={{ fontSize: 12, color: "var(--faint)", marginTop: 0 }}>
        Ask anything about your pipeline — Jarvis pulls the live numbers every
        time it answers. It advises and preps; sending is still your finger on
        the button.
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
                  t.role === "user"
                    ? "var(--ac2, #3b82f6)"
                    : "rgba(255,255,255,.06)",
                color: t.role === "user" ? "#fff" : "inherit",
                border:
                  t.role === "user"
                    ? "none"
                    : "1px solid var(--line, rgba(255,255,255,.08))",
              }}
            >
              {t.text}
            </div>
          ))}
          {pending && (
            <div style={{ fontSize: 13, color: "var(--faint)" }}>
              Jarvis is checking the live numbers…
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
          placeholder="Ask Jarvis…"
          aria-label="Ask Jarvis"
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
