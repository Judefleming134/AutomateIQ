"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Send, Zap } from "lucide-react";
import { sendAssistantMessage } from "./actions";
import { ACTION_PREFIX } from "./shared";

type Message = { role: "user" | "assistant"; content: string };

/**
 * Minimal markdown-lite renderer for assistant replies — handles **bold**,
 * `code`, and "- " bullet lines without any dependency or raw HTML.
 * Everything is built as React nodes, so there's no injection surface.
 */
function renderInline(text: string, keyBase: string): React.ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={`${keyBase}-${i}`}>{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      return <code key={`${keyBase}-${i}`}>{part.slice(1, -1)}</code>;
    }
    return part;
  });
}

function MessageBody({ content }: { content: string }) {
  const lines = content.split("\n");
  return (
    <>
      {lines.map((line, i) => {
        const bullet = /^\s*[-*]\s+/.test(line);
        const text = bullet ? line.replace(/^\s*[-*]\s+/, "") : line;
        return (
          <span key={i} className={bullet ? "chat-line chat-bullet" : "chat-line"}>
            {renderInline(text, `l${i}`)}
          </span>
        );
      })}
    </>
  );
}

export function AssistantChat({
  initialConversationId,
  initialMessages,
  suggestions,
}: {
  initialConversationId: string | null;
  initialMessages: Message[];
  suggestions: string[];
}) {
  const router = useRouter();
  const [conversationId, setConversationId] = useState(initialConversationId);
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, pending]);

  async function submit(text: string) {
    if (!text || pending) return;

    setError(null);
    setInput("");
    setMessages((m) => [...m, { role: "user", content: text }]);
    setPending(true);

    const result = await sendAssistantMessage(conversationId, text);
    setPending(false);

    if (result.ok) {
      const isFirstMessage = !conversationId;
      setConversationId(result.conversationId);
      // First message of a fresh thread: sync the URL to the new
      // conversation id so the history sidebar picks it up. Every message
      // is already persisted server-side before this returns, so the
      // server re-render shows the full thread.
      if (isFirstMessage) {
        router.replace(`/portal/ai-assistant?c=${result.conversationId}`, {
          scroll: false,
        });
      }
      setMessages((m) => [
        ...m,
        // Action chips first (what it did), then the reply itself —
        // matching exactly what was persisted.
        ...result.actions.map((a) => ({
          role: "assistant" as const,
          content: `${ACTION_PREFIX}${a.agent} · ${a.tool.replace(/_/g, " ")}`,
        })),
        { role: "assistant", content: result.reply },
      ]);
    } else {
      setError(result.error);
    }
  }

  function handleSend(e: React.FormEvent) {
    e.preventDefault();
    void submit(input.trim());
  }

  return (
    <div className="panel panel-block chat-panel">
      <div className="chat-messages" ref={scrollRef}>
        {messages.length === 0 && !pending ? (
          <div className="chat-empty">
            <div>
              <p style={{ margin: "0 0 12px", color: "var(--body)" }}>
                Ask your assistant anything — or start with one of these:
              </p>
              <div className="chat-suggest">
                {suggestions.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => void submit(p)}
                    disabled={pending}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          messages.map((m, i) =>
            m.content.startsWith(ACTION_PREFIX) ? (
              <div key={i} className="chat-action-chip">
                <Zap size={12} />
                {m.content.slice(ACTION_PREFIX.length)}
              </div>
            ) : (
              <div
                key={i}
                className={`chat-msg ${m.role === "user" ? "is-user" : "is-assistant"}`}
              >
                <MessageBody content={m.content} />
              </div>
            )
          )
        )}
        {pending && (
          <div className="chat-msg is-assistant is-typing">Working on it…</div>
        )}
      </div>

      {error && <p className="login-error">{error}</p>}

      <form onSubmit={handleSend} className="chat-input-row">
        <input
          type="text"
          placeholder="Ask AutomateIQ to do something…"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={pending}
        />
        <button type="submit" disabled={pending || !input.trim()} aria-label="Send">
          <Send size={16} />
        </button>
      </form>
    </div>
  );
}
